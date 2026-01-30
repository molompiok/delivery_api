# Flux: Gestion des Horaires & Bascule de Mode (ETP)

## 🎯 Vue d'ensemble

Ce document décrit le flux de gestion des horaires de travail pour les entreprises (ETP) et le mécanisme de bascule automatique entre les modes **IDEP** (Indépendant) et **ETP** (Entreprise) pour les chauffeurs.

L'objectif est de garantir qu'un chauffeur bascule automatiquement en mode entreprise lorsqu'un shift commence, tout en assurant une transition fluide qui ne perturbe pas les missions en cours.

---

## 📋 Table des Matières

1. [Architecture des Horaires](#1-architecture-des-horaires)
2. [Flux de Création & Assignation](#2-flux-de-création--assignation)
3. [Flux de Bascule Automatique (Lifecycle)](#3-flux-de-bascule-automatique-lifecycle)
4. [Bascule Manuelle (Force Mode)](#4-bascule-manuelle-force-mode)
5. [Endpoints API](#5-endpoints-api)
6. [Règles de Priorité & Résolution](#6-règles-de-priorité--résolution)

---

## 1. Architecture des Horaires

Les horaires sont gérés de manière polymorphique par le modèle `Schedule`. Pour les entreprises, ils sont liés au `CompanyId` mais filtrés par les utilisateurs assignés (`assignedUsers`).

### Types de Récurrence
- **WEEKLY** : Répétition hebdomadaire (Ex: Tous les lundis).
- **DATE_RANGE** : Période spécifique (Ex: Semaine de Ramadan).
- **SPECIFIC_DATE** : Date unique (Ex: Jour férié).
- **MANUAL_OVERRIDE** : Forçage manuel (Priorité absolue).

---

## 2. Flux de Création & Assignation

```
┌─────────────┐                    ┌──────────────┐                   ┌─────────────┐
│   Manager   │                    │   Backend    │                   │   Driver    │
│  Dashboard  │                    │     API      │                   │  (Mobile)   │
└──────┬──────┘                    └──────┬───────┘                   └──────┬──────┘
       │                                  │                                  │
       │ 1. Création Horaires             │                                  │
       │    POST /v1/schedules            │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 2. Assignation Drivers           │                                  │
       │    POST /schedules/:id/assign    │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ 3. Hook Sync SQL -> Redis        │
       │                                  │    (Mise à jour Snapshot "Hot")  │
       │                                  │                                  │
       │                                  │ 4. Notification Push/SMS         │
       │                                  │    "Nouveau shift assigné"       │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ 5. GET /driver/me                │
       │                                  │<─────────────────────────────────│
       │                                  │    (Voit son nouveau planning)   │
       │                                  │                                  │
```

---

## 3. Flux de Bascule Automatique (Lifecycle)

Le système vérifie chaque minute les bascules nécessaires via le `ShiftWorker`.

### Scénario: Début de Shift (IDEP ➔ ETP)

1. **Vérification** : Le Worker détecte que Driver X a un shift `WORK` qui commence à 08:00.
2. **Contrôle Mission** :
   - **Si pas de mission** : Passage immédiat en mode `ETP`.
   - **Si mission IDEP en cours** : Passage en mode `IDEP_TO_ETP`. Le driver finit sa course mais ne reçoit plus de nouvelles offres IDEP.
3. **Finalisation** : Dès que la mission se termine, le service détecte l'état `IDEP_TO_ETP` et bascule le driver en `ETP`.
4. **Notification** : "Votre shift a commencé. Vous êtes maintenant en mode Entreprise."

### Scénario: Fin de Shift (ETP ➔ IDEP)

1. **Vérification** : Le Worker détecte que le shift se termine à 18:00.
2. **Contrôle Mission** :
   - **Si pas de mission** : Passage immédiat en mode `IDEP`.
   - **Si mission ETP en cours** : Passage en mode `ETP_TO_IDEP`. Il finit sa livraison pour l'entreprise.
3. **Finalisation** : Mission finie -> Passage en `IDEP`.
4. **Notification** : "Shift terminé. Retour en mode Indépendant."

---

## 4. Bascule Manuelle (Force Mode)

Utilisé par les managers pour les urgences (chauffeur resté bloqué, besoin immédiat).

```
┌─────────────┐                    ┌──────────────┐                   ┌─────────────┐
│   Manager   │                    │   Shift      │                   │   Driver    │
│  Dashboard  │                    │   Service    │                   │  (Mobile)   │
└──────┬──────┘                    └──────┬───────┘                   └──────┬──────┘
       │                                  │                                  │
       │ 1. Force Mode (ETP)              │                                  │
       │    POST /company/drivers/:id/force-mode
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ 2. Crée MANUAL_OVERRIDE (P=200)  │
       │                                  │                                  │
       │                                  │ 3. Update Redis Snapshot         │
       │                                  │                                  │
       │                                  │ 4. Trigger Sync Immédiat         │
       │                                  │                                  │
       │                                  │ 5. Notification Critique         │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
```

---

## 📱 Application Mobile: États Visuels

Le développeur mobile doit gérer 4 états basés sur `currentMode` reçu via le profil ou le snapshot Redis :

| Mode | Affichage / Thème | Actions Possibles |
|------|-------------------|-------------------|
| `IDEP` | Thème Standard (ex: Bleu) | Peut prendre des courses libres. |
| `ETP` | Thème Entreprise (ex: Orange) | Ne voit que les courses de son ETP. |
| `IDEP_TO_ETP` | **Bannière Transition** | Doit finir sa course IDEP. Bloqué pour nouvelles offres IDEP. |
| `ETP_TO_IDEP` | **Bannière Transition** | Doit finir sa course ETP. Pas encore libre pour IDEP. |

**Recommandation UX** : Afficher un compte à rebours ou une alerte 15 minutes avant le début d'un shift ETP pour éviter que le chauffeur ne s'engage dans une longue course personnelle.

---

## 5. Endpoints API

### 5.1. Gestion des Horaires (Core)
- `GET /v1/schedules` : Liste les horaires (Filtres: ownerType, ownerId).
- `POST /v1/schedules` : Crée un horaire (Weekly, SpecificDate, etc.).
- `PUT /v1/schedules/:id` : Modifie un horaire.
- `POST /v1/schedules/:id/assign-users` : Assigne des drivers.

### 5.2. Bascule & Force Mode
- `POST /v1/company/drivers/:driverId/force-mode`
  - Body: `{ mode: "IDEP" | "ETP" }`
  - *Note: Nécessite d'être Manager de la compagnie.*

### 5.3. Tracking & Position (Haute Fréquence)
- `POST /v1/driver/location`
  - Body: `{ lat, lng, heading? }`
  - *Note: Met à jour le snaphot Redis et le geo-set pour le dispatch.*

---

## 6. Règles de Priorité & Résolution

En cas de superposition d'horaires, l'algorithme de résolution (`ScheduleService.getEffectiveSchedule`) suit cet ordre :

1. **MANUAL_OVERRIDE** (Prio: 200) : Toujours gagnant.
2. **SPECIFIC_DATE** (Prio: 100) : Jours fériés, événements.
3. **DATE_RANGE** (Prio: 50) : Périodes de vacances, ramadan.
4. **WEEKLY** (Prio: 10) : Planning de base.

**Départage** : Si deux horaires ont la même priorité, c'est celui avec la date de mise à jour (`updatedAt`) la plus récente qui l'emporte.

**Timezone** : L'heure du shift est comparée en utilisant la timezone spécifiée dans l'horaire (par défaut `Africa/Abidjan`), garantissant que le shift commence à la bonne heure locale peu importe la zone du serveur.
