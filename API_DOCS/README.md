# Sublymus Delivery API - Documentation des Flux Métier

> 📋 **Objectif** : Documentation exhaustive des flux métier pour faciliter l'implémentation par l'équipe externe (Mobile App).
> 
> Cette documentation couvre l'architecture, les flux de données, les endpoints API et les règles métier de la plateforme Sublymus.

---

## 📚 Table des Matières

### 🎯 Flux Métier Détaillés

1. **[Flux d'Invitation & Onboarding Driver](./FLUX_INVITATION.md)**
   - Processus complet d'invitation d'un driver par une entreprise
   - Acceptation, upload de documents, validation
   - Endpoints API, modèles de données, règles métier
   - 7 endpoints détaillés avec exemples

2. **[Gestion des Zones (Company & Driver)](./FLUX_ZONE.md)**
   - Zones d'intervention des entreprises
   - Zones personnelles des drivers IDEP
   - Assignation de drivers, types de géométrie (cercle, polygone, rectangle)
   - Algorithme de matching zone-commande

3. **[Gestion des Horaires (ETP)](./FLUX_HORAIRES.md)**
   - Définition des horaires de travail
   - Assignation de drivers aux créneaux
   - Bascule automatique IDEP ↔ ETP
   - Système de priorité (SPECIFIC_DATE > DATE_RANGE > WEEKLY)

4. **[Documents de Vérification Globale](./FLUX_DOCUMENTS.md)**
   - Validation par Sublymus Admin
   - Documents obligatoires vs personnalisés
   - Workflow de validation en deux étapes
   - Gestion des expirations et re-soumissions

---

## 🚀 Démarrage Rapide

### Prérequis
- Node.js 20+
- PostgreSQL 14+
- pnpm 8+

### Installation
```bash
# Cloner le repo
git clone <repo-url>

# Installer les dépendances
pnpm install

# Configurer l'environnement
cp .env.example .env

# Lancer les migrations
node ace migration:run

# Seed la base de données
node ace db:seed

# Démarrer le serveur
pnpm dev
```

### API Base URL
```
Development: http://localhost:3333/api/v1
Production: https://api.sublymus.com/api/v1
```

---

## 🔐 Authentification

Tous les endpoints (sauf `/auth/*`) requièrent un token Bearer :

```http
Authorization: Bearer {token}
```

Pour les endpoints nécessitant un contexte entreprise :
```http
X-Manager-Id: {company_id}
```

---

## 📖 Documentation par Rôle

### Pour les Développeurs Mobile (Flutter)
- Commencez par **[Flux d'Invitation](./FLUX_INVITATION.md)** pour comprendre l'onboarding
- Consultez **[Gestion des Zones](./FLUX_ZONE.md)** pour implémenter la carte interactive
- Voir **[Horaires](./FLUX_HORAIRES.md)** pour la bascule automatique IDEP/ETP
- Référez-vous à **[Documents](./FLUX_DOCUMENTS.md)** pour l'upload et la vérification

### Pour les Managers d'Entreprise
- **[Gestion des Zones](./FLUX_ZONE.md)** - Définir vos zones de service
- **[Horaires](./FLUX_HORAIRES.md)** - Planifier vos équipes
- **[Invitation](./FLUX_INVITATION.md)** - Recruter des drivers

### Pour les Admins Sublymus
- **[Documents de Vérification](./FLUX_DOCUMENTS.md)** - Validation globale
- **[Architecture Globale](#architecture-globale)** - Vue système complète

---

## 🛠️ Stack Technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Backend | AdonisJS | 6.x |
| Database | PostgreSQL | 14+ |
| ORM | Lucid | 20.x |
| Auth | @adonisjs/auth | 9.x |
| Validation | VineJS | 2.x |
| Real-time | Socket.io | 4.x |

---

## 📝 Conventions

### IDs (NanoID)
Tous les identifiants utilisent le format : `{prefix}_{nanoid}`

| Entité | Prefix | Exemple |
|--------|--------|---------|
| User | `usr` | `usr_abc123xyz` |
| Company | `cmp` | `cmp_xyz789abc` |
| Zone | `zn` | `zn_def456ghi` |
| Schedule | `sch` | `sch_jkl012mno` |
| Invitation | `inv` | `inv_pqr345stu` |
| File | `file` | `file_vwx678yza` |
| DriverSetting | `ds` | `ds_abc123def` |
| CompanyDriverSetting | `cds` | `cds_ghi456jkl` |

### Codes HTTP
- `200 OK` - Succès
- `201 Created` - Ressource créée
- `204 No Content` - Succès sans contenu
- `400 Bad Request` - Erreur de validation
- `401 Unauthorized` - Non authentifié
- `403 Forbidden` - Non autorisé
- `404 Not Found` - Ressource introuvable
- `500 Internal Server Error` - Erreur serveur

---

## 🗂️ Architecture Globale

### Modèles de Données Principaux

```
┌─────────────────────────────────────────────────────────────┐
│                     ENTITÉS PRINCIPALES                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User                    Company                            │
│  ├─ DriverSetting        ├─ Zones (ownerType=Company)      │
│  ├─ Zones (ownerType=User)                                 │
│  ├─ Schedules (via assignments)                            │
│  └─ Files (polymorphic)  └─ Files (polymorphic)            │
│                                                             │
│  Zone                    Schedule                           │
│  ├─ Drivers (M2M)        ├─ AssignedUsers (M2M)            │
│  └─ Geometry             └─ Recurrence rules                │
│                                                             │
│  Invitation              CompanyDriverSetting               │
│  ├─ Company              ├─ Company                         │
│  ├─ Token                ├─ Driver                          │
│  └─ Status               └─ Documents + Status              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Relations Clés

```typescript
// User ↔ Company
User.companyId → Company.id                    // Driver appartient à une entreprise
User.currentCompanyManaged → Company.id        // Manager gère une entreprise

// Zone ↔ Driver (M2M)
Zone.drivers ↔ User (via zone_drivers)

// Schedule ↔ Driver (M2M)
Schedule.assignedUsers ↔ User (via schedule_assignments)

// Invitation → Company
Invitation.companyId → Company.id

// CompanyDriverSetting → Company + Driver
CompanyDriverSetting.companyId → Company.id
CompanyDriverSetting.userId → User.id

// Files (Polymorphic)
File.tableName = 'User' | 'Company' | 'Zone' | ...
File.tableId → Entity.id
```

---

## 🔗 Liens Utiles

- [PRD Complet](../bmad-delivery/_bmad-output/planning-artifacts/prd.md)
- [Architecture Decisions](../bmad-delivery/_bmad-output/planning-artifacts/architecture.md)
- [Epics & Stories](../bmad-delivery/_bmad-output/planning-artifacts/epics.md)
- [Postman Collection](#) _(à venir)_

---

## 📊 Vue d'Ensemble des Flux

### Flux 1: Onboarding Driver
```
Driver S'inscrit → Upload Docs → Admin Valide → Driver VERIFIED
→ Accepte Invitation Entreprise → Manager Valide → Driver APPROVED
→ Peut Commencer Missions
```

### Flux 2: Gestion Zones
```
Manager Crée Zone → Assigne Drivers → Drivers Voient Zone (Read-Only)
Driver IDEP Crée Zone Perso → Définit Zone d'Action → Reçoit Commandes Globales
```

### Flux 3: Gestion Horaires
```
Manager Crée Horaires → Assigne Drivers → Système Vérifie Horaires (Cron)
→ 08:00 Shift Start → Bascule IDEP→ETP → Notification Driver
→ 18:00 Shift End → Bascule ETP→IDEP → Notification Driver
```

### Flux 4: Validation Documents
```
Driver Upload Docs → Admin Review → VERIFIED (Global)
→ Driver Rejoint Entreprise → Docs Pré-chargés (PENDING)
→ Manager Review → APPROVED (Spécifique) → Driver Activé
```

---

## 🎯 Points d'Attention pour l'Implémentation Mobile

### 1. Gestion des États
- **Mode Driver** : IDEP vs ETP (changement de thème)
- **Statut Vérification** : PENDING, VERIFIED, REJECTED
- **Statut Documents** : Par document individuel
- **Zones Actives** : Filtrage des commandes

### 2. Synchronisation Temps Réel
- **Socket.io** pour :
  - Notifications de missions
  - Changements de statut
  - Bascule de mode
  - Messages du manager

### 3. Gestion Offline
- **Cache local** pour :
  - Zones assignées
  - Horaires de la semaine
  - Documents uploadés (retry si échec)

### 4. Permissions
- **Vérifier** :
  - Driver peut créer/modifier ses zones IDEP
  - Driver peut **voir** mais **pas modifier** zones entreprise
  - Driver peut **voir** ses horaires mais **pas les modifier**

---

## 📞 Support

Pour toute question :
- **Email** : dev@sublymus.com
- **Slack** : #sublymus-dev
- **Issues** : GitHub Issues

---

## 📝 Changelog

### 2026-01-18
- ✅ Documentation complète des 4 flux principaux
- ✅ Diagrammes de séquence pour chaque flux
- ✅ Exemples de requêtes/réponses API
- ✅ Cas d'usage détaillés
- ✅ Guide d'implémentation Flutter

---

**Dernière mise à jour** : 2026-01-18
