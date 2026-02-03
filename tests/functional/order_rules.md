# Règles de Validation des Commandes (Order Rules)

Ce document liste l'ensemble des règles de validation implémentées dans l'API de commande, regroupées par lot fonctionnel.

## Vision "Validation Centralisée"
L'objectif est de garantir l'intégrité des données logistiques à travers le `LogisticsService` tout en offrant de la flexibilité via l'auto-correction ("Resilience") dans les services unitaires (`ActionService`).

---

## Lot 1 : Structure & Schéma (Payload Validation)

Ces règles sont vérifiées à l'entrée de l'API (via VineJS) ou lors du mapping initial.

| Règle | Description | Sévérité |
| :--- | :--- | :--- |
| **Champs Requis** | Une adresse doit contenir au minimum une `street` (ou `lat`/`lng` pour un bypass de géocodage). | **ERROR** |
| **Cohérence ID** | Si un objet `transit_item` est fourni AVEC un `transit_item_id` dans une action, les deux ID doivent correspondre. | **ERROR** |
| **Format ID** | Les IDs fournis par le client sont mappés vers des UUIDs système uniques via `PayloadMapper`. | **Info** |

---

## Lot 2 : Logistique & Viabilité (LogisticsService)

Ces règles vérifient la cohérence physique et temporelle de la mission.

| Règle | Description | Sévérité |
| :--- | :--- | :--- |
| **Flux Négatif (Running Balance)** | Le solde cumulé d'un item ne peut jamais être négatif. <br> *Exemple Flux (Eau/Colis vrac) :* `+3` -> `-2` -> `+4` -> `-5` est **VALIDE** (Solde: 3, 1, 5, 0). <br> *Exemple Bloc (Unique) :* `+1` -> `-1`. | **ERROR** |
| **Mission Incomplète** | À la fin de la séquence, le solde doit être exactement à **0** (tout ce qui monte doit descendre). | **WARNING** (Bloque Submit/Push) |
| **Objet Orphelin** | Un `TransitItem` est déclaré mais jamais utilisé. | **WARNING** |
| **Séquence Temporelle** | Une livraison ne peut pas avoir lieu si la quantité nécessaire n'est pas déjà dans le véhicule (via le Flux Négatif). | **ERROR** |
| **Viabilité des Étapes** | La validation est séquentielle : chaque étape doit être valide compte tenu de l'état laissé par la précédente. | **ERROR** |

---

## Lot 3 : Logique Métier (ActionService)

Ces règles s'appliquent lors de la création ou modification d'une action spécifique.

| Règle | Description | Sévérité / Comportement |
| :--- | :--- | :--- |
| **Type "SERVICE"** | Une action de type `SERVICE` (ex: Installation) doit avoir une `quantity` de **0**. | **Auto-Correction** (Force 0) |
| **Type "TRANSPORT"** | Une action `PICKUP` ou `DELIVERY` doit avoir une `quantity` **> 0**. | **Auto-Correction** (Force 1 si 0) |
| **Existence Objet** | Si on référence un `transit_item_id` sans fournir l'objet complet, cet ID **doit exister**. | **ERROR** ("Transit item not found") |
| **Création Inline** | Si on fournit un objet `transit_item` complet, il est créé/mis à jour (Résilience via `addTransitItem`). | **Succès** |
| **Multi-Actions** | Un seul Stop peut contenir plusieurs actions (Pickup A, Delivery B, Service C). | **Info** |

---

## Lot 4 : Règles Opérationnelles & Shadow (Modification)

Règles pour la modification de commandes en cours ("Draft-in-Place").

| Règle | Description | Sévérité |
| :--- | :--- | :--- |
| **Immutabilité du Passé** | Impossible de modifier une Entité (Step/Stop/Action) avec statut `EXECUTED` ou `IN_PROGRESS`. | **ERROR** (Locked) |
| **Shadow Copy** | Toute modification sur une commande active crée un clone `is_pending_change=true` invisible pour le chauffeur. | **Info** (Mécanisme) |
| **Insertion Temporelle** | On ne peut pas insérer un nouveau Step avec un index antérieur à un Step déjà terminé. | **ERROR** |
| **Fusion (Push)** | L'appel à `/push-updates` valide l'intégrité, fusionne les shadows, et recalcule la route. | **Process** |

---

## Lot 5 : Structure de la Mission & VROOM

| Règle | Description | Sévérité |
| :--- | :--- | :--- |
| **Hiérarchie** | **Step** (Ordre strict) > **Stop** (Lieu géographique) > **Action** (Tâche unitaire). | **Structure** |
| **Liaison (Linked)** | Les Steps marqués `linked: true` doivent être exécutés à la suite par le même chauffeur. | **Logistique** |
| **Capacité** | VROOM respecte la capacité du véhicule par défaut, sauf si l'option "Surcharge Autorisée" est active. | **Optimisation** |

---

## Lot 6 : Exécution & Preuve (Driver App)

| Règle | Description | Sévérité |
| :--- | :--- | :--- |
| **Validation Unitaire** | Chaque action (Photo, Signature, Code) doit être validée individuellement par le chauffeur. | **Bloquant App** |
| **Preuve Obligatoire** | Si une action requiert une preuve (ex: `photo: true`), l'action ne peut passer à `COMPLETED` sans l'upload de la preuve. | **Bloquant App** |
| **Verrouillage** | Une action terminée (`COMPLETED` ou `FAILED`) ne peut plus être modifiée par le chauffeur (sauf via support/admin). | **Métier** |

---

## Note sur `addTransitItem`

La méthode `addTransitItem` est **essentielle** pour la règle "Création Inline" (Lot 3). Elle permet une API résiliente où l'utilisateur n'est pas obligé de pré-créer tous les items s'il souhaite ajouter une action complexe en une seule requête. Cela respecte la vision d'une API flexible ("Omettez les détails stricts, nous gérons") tant que la cohérence logistique finale (Lot 2) est respectée.
