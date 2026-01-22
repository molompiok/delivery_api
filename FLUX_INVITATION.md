# Flux d'Invitation & Onboarding Driver

## 🎯 Vue d'ensemble

Ce document décrit le flux complet d'invitation et d'onboarding d'un driver par une entreprise (ETP) dans Sublymus. Le processus se déroule en plusieurs étapes, depuis l'authentification du driver jusqu'à son intégration complète dans la flotte de l'entreprise.

---

## 📋 Table des Matières

1. [Authentification & Connexion](#1-authentification--connexion)
2. [Flux d'Invitation Complet](#2-flux-dinvitation-complet)
3. [Endpoints API](#3-endpoints-api)
4. [Modèles de Données](#4-modèles-de-données)
5. [États et Transitions](#5-états-et-transitions)
6. [Application Mobile - Vue Driver](#6-application-mobile---vue-driver)

---

## 1. Authentification & Connexion

### 1.1. Flux de Connexion OTP

```
┌─────────────┐                    ┌──────────────┐
│   Driver    │                    │   Backend    │
│   Mobile    │                    │     API      │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │ 1. Demande OTP                   │
       │  POST /v1/auth/phone/otp/send    │
       │  { phone: "+2250XXXXXXXXX" }     │
       │─────────────────────────────────>│
       │                                  │
       │                                  │ 2. Envoi SMS OTP (6 digits)
       │                                  │
       │ 3. Confirmation envoi            │
       │  { message: "OTP sent" }         │
       │<─────────────────────────────────│
       │                                  │
       │ [Driver reçoit le code SMS]      │
       │                                  │
       │ 4. Vérification OTP              │
       │  POST /v1/auth/phone/otp/verify  │
       │  { phone: "+225...", otp: "123456" }
       │─────────────────────────────────>│
       │                                  │
       │                                  │ 5. Validation du code
       │                                  │    - Si nouveau: créer User
       │                                  │    - Générer token JWT
       │                                  │
       │ 6. Retour Token + User           │
       │  {                               │
       │    token: "eyJhbG...",            │
       │    user: {                        │
       │      id, email, fullName,         │
       │      isDriver, isAdmin            │
       │    }                              │
       │  }                                │
       │<─────────────────────────────────│
       │                                  │
       │ 7. Stockage local du token       │
       │    (AsyncStorage/SecureStore)    │
       │                                  │
```

### 1.2. Règles d'Authentification

- **Délai de réessai** : 30 secondes entre deux demandes d'OTP pour le même numéro
- **Rate limiting** : Protection anti-spam intégrée
- **Format téléphone** : Regex `/^\+[0-9]{8,15}$/` (format international obligatoire)
- **Codes OTP** : 6 chiffres, validité de 10 minutes
- **Création automatique** : Si le numéro n'existe pas, un compte `User` est créé automatiquement

### 1.3. Endpoints d'Authentification

#### Demander un OTP
```http
POST /v1/auth/phone/otp/send
Content-Type: application/json

{
  "phone": "+2250700000000"
}

Response: 200 OK
{
  "message": "SMS OTP sent",
  "otp": "123456"  // Uniquement en dev/test
}
```

#### Vérifier un OTP
```http
POST /v1/auth/phone/otp/verify
Content-Type: application/json

{
  "phone": "+2250700000000",
  "otp": "123456"
}

Response: 200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_abc123",
    "email": null,
    "fullName": null,
    "phone": "+2250700000000",
    "isDriver": false,
    "isAdmin": false,
    "isActive": true
  }
}
```

---

## 2. Flux d'Invitation & Recrutement

### 2.1. Les Deux Flux de Documents (Double Flux)

Le système sépare les documents en deux catégories pour protéger la vie privée du chauffeur tout en assurant la conformité des entreprises.

1.  **Flux Chauffeur (User Flux)** : Documents personnels enregistrés sur le profil global du chauffeur. Ils sont validés par Sublymus.
2.  **Flux Entreprise (Company Flux)** : Documents spécifiques à une relation de travail. Ils doivent être validés par le manager de l'entreprise.

### 2.2. Diagramme de Flux Global

```
┌─────────────┐                    ┌──────────────┐                   ┌─────────────┐
│   ETP       │                    │   Backend    │                   │   Driver    │
│  Manager    │                    │     API      │                   │  (Mobile)   │
└──────┬──────┘                    └──────┬───────┘                   └──────┬──────┘
       │                                  │                                  │
       │ ÉTAPE 1: Envoi demande d'accès   │                                  │
       │ POST /company/drivers/invite     │                                  │
       │ { phone: "+225..." }             │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ Création/Mise à jour:            │
       │                                  │ - User (si nouveau)              │
       │                                  │ - CompanyDriverSetting           │
       │                                  │   (status: PENDING_ACCESS)       │
       │                                  │ - Sync auto des docs requis      │
       │                                  │   (depuis standards ETP)         │
       │                                  │                                  │
       │                                  │ ÉTAPE 2: SMS d'invitation        │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ ÉTAPE 3: Driver reçoit SMS       │
       │                                  │ "L'entreprise X souhaite accéder │
       │                                  │ à vos documents..."              │
       │                                  │                                  │
       │                                  │ 3a. Driver ouvre app/web         │
       │                                  │                                  │
       │                                  │ 3b. Connexion OTP                │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 3c. Si !isDriver:                │
       │                                  │     POST /driver/register        │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 3d. GET /driver/invitations      │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 3e. Liste des demandes           │
       │                                  │─────────────────────────────────>│
       │                                  │     [{company, status, ...}]     │
       │                                  │                                  │
       │                                  │ ÉTAPE 4: Acceptation demande     │
       │                                  │ POST /invitations/:id/accept-access
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ - Status: ACCESS_ACCEPTED        │
       │                                  │ - Copie des docs User->CDS       │
       │                                  │   (status: PENDING)              │
       │                                  │ - Miroir des fichiers physiques  │
       │                                  │                                  │
       │ ÉTAPE 5: Notification Manager    │                                  │
       │ "Driver a accepté"               │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ [OPTIONNEL] Mise à jour docs     │                                  │
       │ POST /company/requirements       │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ ÉTAPE 6: Driver fournit les docs │                                  │
       │                                  │ 6a. Upload global (Profil)       │
       │                                  │ POST /driver/documents/upload    │
       │                                  │ (status: SUBMITTED sur User)     │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 6b. Soumission à l'ETP           │
       │                                  │ PATCH /documents/:docId/submit   │
       │                                  │ { fileId: "fil_xxx" }            │
       │                                  │ (status: SUBMITTED sur CDS)      │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │ ÉTAPE 7: Manager valide/rejette  │                                  │
       │ POST /documents/:id/validate     │                                  │
       │ { status: "APPROVED/REJECTED",   │                                  │
       │   comment: "..." }               │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ - Mise à jour Document.status    │
       │                                  │ - Sync docsStatus global         │
       │                                  │                                  │
       │                                  │ ÉTAPE 8: Notif Driver            │
       │                                  │ (si REJECTED: re-soumettre)      │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │ [Boucle 6-8 jusqu'à tout APPROVED]                                  │
       │                                  │                                  │
       │ ÉTAPE 9: Invitation finale       │                                  │
       │ POST /drivers/:id/invite-to-fleet│                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ - Vérif: tous docs APPROVED      │
       │                                  │ - Status: PENDING_FLEET          │
       │                                  │                                  │
       │                                  │ ÉTAPE 10: SMS final              │
       │                                  │ "Félicitations ! Docs validés..."│
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ ÉTAPE 11: Driver accepte         │
       │                                  │ POST /invitations/:id/accept-fleet
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ - Status: ACCEPTED               │
       │                                  │ - Driver rejoint la flotte !     │
       │                                  │                                  │
```

### 2.3. Description Détaillée des Étapes

#### ÉTAPE 1: Manager envoie une demande d'accès
- **Action** : Le manager de l'ETP saisit le numéro de téléphone du driver
- **Backend** :
  - Crée ou trouve le `User`.
  - Crée `CompanyDriverSetting` avec `status: 'PENDING_ACCESS'`.
  - **Auto-Sync** : Copie les documents requis depuis les **Standards de l'Entreprise** (`metaData.documentRequirements`).
  - Envoie un SMS d'invitation au driver

#### ÉTAPE 2-3: Driver reçoit le SMS et ouvre l'app
- **SMS** : Contient un lien vers `driver.sublymus.com/invitation`
- **Actions du driver** :
  - Ouvre l'application (ou télécharge si nouveau)
  - Se connecte via OTP (voir section 1)

#### ÉTAPE 3c: Enregistrement comme driver (si nécessaire)
- **Condition** : Si `user.isDriver === false`
- **Action** : `POST /v1/driver/register`
- **Données requises** : `vehicleType`, `vehiclePlate`
- **Résultat** : Création de `DriverSetting` + `user.isDriver = true`

#### ÉTAPE 3d-3e: Récupération des demandes d'accès
- **Action** : `GET /v1/driver/invitations`
- **Retour** : Liste des `CompanyDriverSetting` avec status `PENDING_ACCESS`, `PENDING_FLEET`
- **Affichage** : Cards avec infos de l'entreprise (nom, logo, description)

#### ÉTAPE 4: Acceptation de la demande d'accès
- **Action** : Driver clique sur "Accepter" pour une invitation
- **Endpoint** : `POST /v1/driver/invitations/:invitationId/accept-access`
- **Backend** :
  - Change status à `ACCESS_ACCEPTED`.
  - **Mirroring** : Si le chauffeur possède déjà ces documents validés sur son profil global, ils sont liés à la relation entreprise.
  - **IMPORTANT** : Un "hard-link" du fichier est créé et les permissions sont mises à jour pour que le manager de l'entreprise puisse voir le fichier.

#### ÉTAPE 5: Notification Manager
- **Action** : Le manager reçoit une notification que le driver a accepté la demande d'accès.

#### ÉTAPE 6: Fourniture des documents (Double Flux)
Un document manquant doit suivre deux étapes :
1.  **Upload Global** (`POST /v1/driver/documents/upload`) : Ajoute le fichier au profil du chauffeur.
2.  **Soumission Ciblée** (`PATCH /v1/documents/:docId/submit`) : Lie ce fichier spécifique à la demande de l'entreprise.

#### ÉTAPE 7: Manager valide ou rejette
- **Endpoint** : `POST /v1/company/documents/:id/validate`
- **Données** : `{ status: "APPROVED" | "REJECTED", comment: "Photo floue" }`
- **Backend** :
  - Met à jour `Document.status`
  - Recalcule `CompanyDriverSetting.docsStatus` (global)
  - Notifie le driver

#### ÉTAPE 8: Notification Driver
- **Action** : Le driver est notifié du statut de ses documents. Si rejeté, il doit re-soumettre.

#### ÉTAPE 9: Invitation finale à la flotte
- **Condition** : Tous les documents requis sont `APPROVED`
- **Endpoint** : `POST /v1/company/drivers/:driverId/invite-to-fleet`
- **Backend** :
  - Vérifie que tous les docs sont validés
  - Change status à `PENDING_FLEET`
  - Envoie SMS de félicitations au driver

#### ÉTAPE 10: SMS final
- **Action** : Le driver reçoit un SMS de félicitations.

#### ÉTAPE 11: Driver accepte l'invitation finale
- **Endpoint** : `POST /v1/driver/invitations/:invitationId/accept-fleet`
- **Backend** :
  - Change status à `ACCEPTED`
  - Met à jour `DriverSetting.currentCompanyId`
  - **Le driver fait maintenant partie de la flotte !**

#### Gestion des Standards de l'Entreprise
Les entreprises peuvent définir une liste de documents standards via les paramètres du dashboard.
- **Modification** : `POST /v1/company/requirements`
- **Synchronisation** : Pour mettre à jour un chauffeur déjà existant, utiliser `POST /v1/company/drivers/:driverId/sync-requirements`.

---

## 3. Endpoints API

### 3.1. Authentification

Voir [Section 1.3](#13-endpoints-dauthentification)

### 3.2. Driver - Gestion du Profil

#### S'enregistrer comme driver
```http
POST /v1/driver/register
Authorization: Bearer {token}
Content-Type: application/json

{
  "vehicleType": "MOTORCYCLE" | "CAR" | "VAN" | "TRUCK",
  "vehiclePlate": "AA-1234-CI"
}

Response: 201 Created
{
  "message": "Successfully registered as driver",
  "driverSetting": {
    "id": "ds_xxx",
    "userId": "usr_xxx",
    "vehicleType": "MOTORCYCLE",
    "vehiclePlate": "AA-1234-CI",
    "currentCompanyId": null
  }
}
```

#### Récupérer mon profil driver
```http
GET /v1/driver/me
Authorization: Bearer {token}

Response: 200 OK
{
  "id": "ds_xxx",
  "userId": "usr_xxx",
  "vehicleType": "MOTORCYCLE",
  "vehiclePlate": "AA-1234-CI",
  "currentCompanyId": "cmp_yyy",
  "currentCompany": {
    "id": "cmp_yyy",
    "name": "Transport Express CI",
    "logo": "https://..."
  }
}
```

### 3.3. Driver - Invitations

#### Récupérer mes invitations
```http
GET /v1/driver/invitations
Authorization: Bearer {token}

Response: 200 OK
[
  {
    "id": "cds_abc123",
    "status": "PENDING_ACCESS",
    "invitedAt": "2026-01-18T10:00:00Z",
    "docsStatus": null,
    "company": {
      "id": "cmp_xyz789",
      "name": "Transport Express CI",
      "logo": "https://...",
      "description": "Entreprise de livraison rapide"
    }
  },
  {
    "id": "cds_def456",
    "status": "PENDING_FLEET",
    "invitedAt": "2026-01-15T14:30:00Z",
    "docsStatus": "APPROVED",
    "company": {
      "id": "cmp_licy123",
      "name": "Licy Express",
      "logo": "https://..."
    }
  }
]
```

#### Accepter une demande d'accès
```http
POST /v1/driver/invitations/:invitationId/accept-access
Authorization: Bearer {token}

Response: 200 OK
{
  "message": "Access granted successfully",
  "invitation": {
    "id": "cds_abc123",
    "status": "ACCESS_ACCEPTED",
    "companyId": "cmp_xyz789",
    "driverId": "usr_driver123"
  }
}
```

#### Accepter l'invitation finale à la flotte
```http
POST /v1/driver/invitations/:invitationId/accept-fleet
Authorization: Bearer {token}

Response: 200 OK
{
  "message": "Joined company fleet successfully",
  "invitation": {
    "id": "cds_abc123",
    "status": "ACCEPTED",
    "acceptedAt": "2026-01-18T16:00:00Z"
  }
}
```

#### Rejeter une invitation
```http
POST /v1/driver/invitations/:invitationId/reject
Authorization: Bearer {token}

Response: 200 OK
{
  "message": "Request rejected"
}
```

### 3.4. Driver - Mes Entreprises

#### Récupérer toutes mes entreprises
```http
GET /v1/driver/companies
Authorization: Bearer {token}

Response: 200 OK
[
  {
    "id": "cds_current",
    "status": "ACCEPTED",
    "invitedAt": "2026-01-10T09:00:00Z",
    "acceptedAt": "2026-01-12T14:00:00Z",
    "docsStatus": "APPROVED",
    "company": {
      "id": "cmp_xyz789",
      "name": "Transport Express CI",
      "logo": "https://...",
      "description": "..."
    }
  },
  {
    "id": "cds_old",
    "status": "REMOVED",
    "invitedAt": "2025-12-01T08:00:00Z",
    "acceptedAt": "2025-12-02T10:00:00Z",
    "company": {
      "id": "cmp_old123",
      "name": "Ancienne ETP",
      "logo": "https://..."
    }
  }
]
```

**Notes importantes** :
- La **première entreprise** dans la liste est celle avec laquelle le driver travaille actuellement (status: `ACCEPTED`, `currentCompanyId`)
- Les entreprises avec `status: REMOVED` sont les anciennes collaborations

### 3.5. Company - Gestion des Drivers

#### Inviter un driver
```http
POST /v1/company/drivers/invite
Authorization: Bearer {token}
Content-Type: application/json

{
  "phone": "+2250700000000"
}

Response: 200 OK
{
  "message": "Driver invited successfully",
  "invitation": {
    "id": "cds_abc123",
    "companyId": "cmp_xyz789",
    "driverId": "usr_driver123",
    "status": "PENDING_ACCESS",
    "invitedAt": "2026-01-18T10:00:00Z"
  }
}
```

#### Lister mes drivers
```http
GET /v1/company/drivers?status=ACCEPTED
Authorization: Bearer {token}

Response: 200 OK
[
  {
    "id": "cds_abc123",
    "status": "ACCEPTED",
    "docsStatus": "APPROVED",
    "invitedAt": "2026-01-10T09:00:00Z",
    "acceptedAt": "2026-01-12T14:00:00Z",
    "driver": {
      "id": "usr_driver123",
      "fullName": "Jean Dupont",
      "phone": "+2250700000000",
      "email": "jean@example.com",
      "driverSetting": {
        "vehicleType": "MOTORCYCLE",
        "vehiclePlate": "AA-1234-CI"
      }
    }
  }
]
```

**Filtres disponibles** :
- `?status=PENDING_ACCESS` : Demandes en attente
- `?status=ACCESS_ACCEPTED` : Accès accepté, en cours de validation docs
- `?status=PENDING_FLEET` : Invitation finale envoyée
- `?status=ACCEPTED` : Drivers actifs dans la flotte
- `?name=Jean` : Recherche par nom
- `?phone=0700` : Recherche par téléphone

#### Définir les documents requis
```http
POST /v1/company/drivers/:driverId/required-docs
Authorization: Bearer {token}
Content-Type: application/json

{
  "docTypeIds": [
    "dct_drivers_license",
    "dct_id_card",
    "dct_vaccine_card"
  ]
}

Response: 200 OK
{
  "message": "Required documents set successfully",
  "relation": {
    "id": "cds_abc123",
    "requiredDocTypes": ["dct_drivers_license", "dct_id_card", "dct_vaccine_card"],
    "docsStatus": "PENDING"
  }
}
```

#### Valider/Rejeter un document
```http
POST /v1/company/documents/:fileId/validate
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "APPROVED",
  "comment": "Document valide"
}

// OU

{
  "status": "REJECTED",
  "comment": "Photo trop floue, veuillez re-télécharger"
}

Response: 200 OK
{
  "message": "Document validation updated",
  "file": {
    "id": "doc_xxx",
    "documentType": "drivers_license",
    "status": "APPROVED",
    "validationComment": "Document valide"
  }
}
```

#### Envoyer l'invitation finale à la flotte
```http
POST /v1/company/drivers/:driverId/invite-to-fleet
Authorization: Bearer {token}

Response: 200 OK
{
  "message": "Fleet invitation sent successfully",
  "relation": {
    "id": "cds_abc123",
    "status": "PENDING_FLEET",
    "docsStatus": "APPROVED",
    "documents": [
      {
        "documentType": "drivers_license",
        "status": "APPROVED"
      },
      {
        "documentType": "id_card",
        "status": "APPROVED"
      }
    ]
  }
}
```

---

## 4. Modèles de Données

### 4.1. User
```typescript
{
  id: string,                    // NanoID: usr_xxxxx
  email: string | null,
  fullName: string | null,
  phone: string,                 // Format international: +225...
  isDriver: boolean,             // true si enregistré comme driver
  isAdmin: boolean,
  isActive: boolean,
  companyId: string | null,      // Si l'utilisateur possède une entreprise
  currentCompanyManaged: string | null,
  lastLoginAt: DateTime,
  createdAt: DateTime,
  updatedAt: DateTime
}
```

### 4.2. DriverSetting
```typescript
{
  id: string,                    // NanoID: ds_xxxxx
  userId: string,                // Référence vers User
  vehicleType: 'MOTORCYCLE' | 'CAR' | 'VAN' | 'TRUCK',
  vehiclePlate: string,
  currentCompanyId: string | null, // Entreprise actuelle (flotte principale)
  createdAt: DateTime,
  updatedAt: DateTime,
  
  // Relations
  user: User,
  currentCompany: Company | null
}
```

### 4.3. CompanyDriverSetting (Relation pivot)
```typescript
{
  id: string,                    // NanoID: cds_xxxxx
  companyId: string,             // Référence vers Company
  driverId: string,              // Référence vers User (driver)
  
  // États du processus
  status: 'PENDING_ACCESS' | 'ACCESS_ACCEPTED' | 'PENDING_FLEET' | 'ACCEPTED' | 'REJECTED' | 'REMOVED',
  
  // Documents
  requiredDocTypes: string[],    // Ex: ["dct_drivers_license", "dct_id_card"]
  docsStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null,
  
  // Dates
  invitedAt: DateTime | null,
  acceptedAt: DateTime | null,
  createdAt: DateTime,
  updatedAt: DateTime,
  
  // Relations
  company: Company,
  driver: User,
  documents: Document[]          // Liste des documents requis
}
```

### 4.4. Document
```typescript
{
  id: string,                    // NanoID: doc_xxxxx
  
  // Relation polymorphique
  tableName: string,             // Ex: "User", "CompanyDriverSetting"
  tableId: string,               // ID de l'entité parente
  
  // Type et fichier
  documentType: string,          // Ex: "drivers_license", "id_card"
  fileId: string | null,         // Référence vers File (si uploadé)
  
  // Validation
  status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
  validationComment: string | null,
  
  // Ownership
  ownerId: string,               // ID de la Company ou User
  ownerType: 'Company' | 'User',
  
  // Soft delete
  isDeleted: boolean,
  
  // Métadonnées
  metadata: {
    history: Array<{
      action: string,
      userId: string,
      timestamp: string,
      data: any
    }>
  },
  
  createdAt: DateTime,
  updatedAt: DateTime,
  
  // Relations
  file: File | null
}
```

### 4.5. File
```typescript
{
  id: string,                    // NanoID: file_xxxxx
  path: string,                  // Chemin physique: /volumes/...
  name: string,                  // Nom original
  mimeType: string,
  size: number,                  // Taille en bytes
  
  // Relation polymorphique
  tableName: string,
  tableColumn: string,
  tableId: string,
  
  // Sécurité
  allowedCompanyIds: string[],   // Companies autorisées à voir ce fichier
  
  // Métadonnées
  metadata: any,
  
  createdAt: DateTime,
  updatedAt: DateTime
}
```

---

## 5. États et Transitions

### 5.1. CompanyDriverSetting.status

```
┌────────────────┐
│ PENDING_ACCESS │  (Manager envoie demande d'accès)
└────────┬───────┘
         │
         │ Driver accepte
         ▼
┌────────────────┐
│ACCESS_ACCEPTED │  (Driver a accepté, docs en cours de validation)
└────────┬───────┘
         │
         │ Manager envoie invitation finale
         │ (tous les docs APPROVED)
         ▼
┌────────────────┐
│ PENDING_FLEET  │  (Invitation finale envoyée, en attente d'acceptation)
└────────┬───────┘
         │
         │ Driver accepte
         ▼
┌────────────────┐
│   ACCEPTED     │  (Driver fait partie de la flotte)
└────────┬───────┘
         │
         │ Manager retire le driver
         ▼
┌────────────────┐
│    REMOVED     │  (Ancien membre de la flotte)
└────────────────┘

        ┌────────────────┐
        │   REJECTED     │  (Driver ou Manager a rejeté)
        └────────────────┘
```

### 5.2. Document.status

```
┌─────────┐
│ PENDING │  (Document requis mais pas encore uploadé)
└────┬────┘
     │
     │ Driver upload fichier
     ▼
┌───────────┐
│ SUBMITTED │  (En attente de validation manager)
└────┬──────┘
     │
     ├─────> APPROVED  (Manager valide)
     │
     └─────> REJECTED  (Manager rejette)
              │
              │ Driver re-upload
              └────> SUBMITTED
```

### 5.3. CompanyDriverSetting.docsStatus (Global)

Calculé automatiquement en fonction de l'état de tous les documents requis :

- **`PENDING`** : Au moins un document est `PENDING` ou `SUBMITTED`
- **`REJECTED`** : Au moins un document est `REJECTED`
- **`APPROVED`** : Tous les documents requis sont `APPROVED`
- **`null`** : Aucun document requis défini

---

## 6. Application Mobile - Vue Driver

### 6.1. Écrans Principaux

#### a) Écran de Login
- Champ téléphone (format international)
- Bouton "Recevoir le code"
- Champ OTP (6 chiffres)
- Bouton "Se connecter"
- Timer de 30s pour re-demander un code

#### b) Écran d'Enregistrement Driver (si !isDriver)
- **Titre** : "Devenez livreur"
- **Champs** :
  - Type de véhicule (sélecteur: Moto, Voiture, Van, Camion)
  - Plaque d'immatriculation
- **Bouton** : "Valider"

#### c) Écran "Mes Invitations"
- **Liste** des `CompanyDriverSetting` avec status `PENDING_ACCESS` ou `PENDING_FLEET`
- Pour chaque invitation :
  - Logo de l'entreprise
  - Nom de l'entreprise
  - Description
  - Badge de status (En attente / Documents validés)
  - Bouton "Accepter" / "Refuser"

#### d) Écran "Mes Entreprises"
**Section 1: Entreprise Actuelle** (priorité visuelle)
```
┌────────────────────────────────────────┐
│  🏢 Transport Express CI               │
│  ✅ Actif depuis le 12/01/2026         │
│                                        │
│  📋 Documents         🚗 Véhicule      │
│  💰 Wallet            📦 Commandes     │
│  📅 Horaires          🗺️ Zones        │
└────────────────────────────────────────┘
```

**Section 2: Historique des Entreprises**
```
┌────────────────────────────────────────┐
│  🏢 Licy Express                       │
│  ⏸️ Inactif (retiré le 15/12/2025)    │
│  [Voir détails]                        │
└────────────────────────────────────────┘
│  🏢 Agri-Flow                          │
│  ⏸️ Inactif (terminé le 30/11/2025)   │
│  [Voir détails]                        │
└────────────────────────────────────────┘
```

#### e) Écran "Détails Entreprise"
Quand on clique sur une entreprise, on affiche :

**Onglets** :
1. **📋 Documents**
   - Liste des documents requis
   - Status de chaque document (Validé/En attente/Rejeté)
   - Bouton "Upload" si rejeté ou manquant
   - Commentaires du manager si rejeté

2. **💰 Wallet** (Données mockées pour le moment)
   - Solde disponible
   - Solde en attente
   - Historique des transactions (liste vue)

3. **📦 Transactions** (Données mockées)
   - Liste des transactions financières
   - Filtres par date, type

4. **🚗 Missions/Commandes** (Données mockées)
   - Historique des courses effectuées pour cette entreprise
   - Statistiques (nb courses, km parcourus)

5. **🚙 Véhicule Assigné** (**Uniquement pour l'entreprise actuelle**)
   - Détails du véhicule assigné
   - Photos
   - Documents du véhicule (assurance, visite technique)

6. **🗺️ Zone Assignée** (**Uniquement pour l'entreprise actuelle**)
   - Carte avec la zone attribuée
   - Nom de la zone
   - Secteur

7. **📅 Horaires Assignés** (**Uniquement pour l'entreprise actuelle**)
   - Planning hebdomadaire
   - Heures de début/fin par jour

**Règle importante** :
- Les onglets **Véhicule, Zone, Horaires** sont **masqués** pour les entreprises inactives (status != ACCEPTED)
- Seule l'entreprise avec laquelle le driver travaille actuellement affiche ces informations

### 6.2. États UI à Gérer

```typescript
// État de l'utilisateur
interface UserState {
  id: string
  phone: string
  fullName: string | null
  isDriver: boolean
  isAuthenticated: boolean
  token: string | null
}

// État des invitations
interface InvitationsState {
  pending: CompanyDriverSetting[]
  isLoading: boolean
}

// État des entreprises
interface CompaniesState {
  current: CompanyDriverSetting | null  // Entreprise actuelle
  history: CompanyDriverSetting[]       // Anciennes entreprises
  isLoading: boolean
}

// État d'une relation entreprise-driver
interface CompanyDriverSetting {
  id: string
  status: 'PENDING_ACCESS' | 'ACCESS_ACCEPTED' | 'PENDING_FLEET' | 'ACCEPTED' | 'REMOVED'
  docsStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  invitedAt: string
  acceptedAt: string | null
  company: {
    id: string
    name: string
    logo: string
    description: string
  }
}
```

### 6.3. Notifications Push

L'application mobile doit gérer ces notifications :

1. **Nouvelle demande d'accès** (status → PENDING_ACCESS)
   - Titre : "Nouvelle invitation"
   - Message : "L'entreprise {company.name} souhaite accéder à vos documents"

2. **Document rejeté** (Document.status → REJECTED)
   - Titre : "Document à revoir"
   - Message : "{documentType} rejeté : {validationComment}"

3. **Invitation finale** (status → PENDING_FLEET)
   - Titre : "Félicitations !"
   - Message : "Vos documents ont été validés par {company.name}. Rejoignez la flotte !"

4. **Accepté dans la flotte** (status → ACCEPTED)
   - Titre : "Bienvenue chez {company.name} !"
   - Message : "Vous faites maintenant partie de la flotte."

---

## 7. Cas d'Usage & Exemples

### Cas 1 : Nouveau Driver (jamais enregistré)

**Étapes** :
1. Manager crée invitation → SMS envoyé
2. Driver ouvre app → Login OTP
3. Driver s'enregistre comme driver (vehicleType, vehiclePlate)
4. Driver voit l'invitation, accepte
5. Status → `ACCESS_ACCEPTED`, documents miroirs créés
6. Manager définit docs requis
7. Driver upload documents
8. Manager valide tous les documents
9. Manager envoie invitation finale → Status `PENDING_FLEET`
10. Driver accepte → Status `ACCEPTED`, rejoint la flotte !

### Cas 2 : Driver Existant (déjà validé par Sublymus)

**Étapes** :
1. Manager crée invitation → Driver existant trouvé
2. Driver reçoit SMS, accepte via l'app
3. **Documents pré-chargés** : Copie automatique de User → CompanyDriverSetting
4. **MAIS** : Tous les docs ont status `PENDING` (manager doit re-valider)
5. Manager revoit et valide les documents
6. Manager envoie invitation finale
7. Driver accepte → Rejoint la flotte

**Note** : Les documents déjà validés par Sublymus Admin ont une note dans l'historique, mais le manager **doit** les re-valider pour sa propre conformité.

### Cas 3 : Document Rejeté - Re-soumission

**Étapes** :
1. Driver upload permis de conduire
2. Manager rejette : "Photo floue"
3. Driver reçoit notification avec raison
4. Driver re-upload nouveau fichier
5. Ancien fichier conservé dans l'historique (soft delete)
6. Manager valide le nouveau fichier
7. Document status → `APPROVED`
8. `docsStatus` global recalculé

---

## 8. Règles Métier Importantes

### 8.1. Pré-chargement des Données (FR3)
- Quand un driver **existant** accepte une invitation, ses documents déjà dans `User` sont **copiés** vers `CompanyDriverSetting`
- **Tous** les documents copiés ont `status: PENDING` par défaut
- Le manager **doit** valider chaque document, même s'ils ont été validés par Sublymus Admin
- Cela garantit que chaque entreprise fait sa propre vérification

### 8.2. Documents Personnalisés (FR4)
- Chaque entreprise peut définir des documents requis spécifiques (ex: carnet de vaccination)
- Les documents standards (permis, ID) sont souvent requis par défaut
- Le manager peut ajouter/retirer des types de documents à tout moment
- Si un document est retiré des requis, il est soft-deleted (conservé dans l'historique)

### 8.3. Validation en Deux Étapes
- **Étape 1** : Validation par Sublymus Admin (documents globaux, stockés sur `User`)
- **Étape 2** : Validation par Manager ETP (documents spécifiques, stockés sur `CompanyDriverSetting`)
- Les deux validations sont **indépendantes** pour respecter la responsabilité de chaque acteur

### 8.4. Isolation Multi-tenant
- Un manager ne voit **que** les drivers de sa propre entreprise
- Les documents sont filtrés par `allowedCompanyIds` dans le modèle `File`
- Header `X-Manager-Id` utilisé pour l'isolation (si implémenté)

### 8.5. Notification
- Driver notifié à chaque changement de statut de document
- Manager notifié quand tous les documents sont soumis
- SMS envoyés aux moments clés (invitation initiale, invitation finale)

---

## 9. Sécurité & Performance

### 9.1. Authentification
- **JWT Token** stocké en local (AsyncStorage/SecureStore)
- Inclus dans header `Authorization: Bearer {token}` pour toutes les requêtes protégées
- Expiration du token géré par AdonisJS

### 9.2. Protection des Fichiers
- Fichiers chiffrés sur le serveur (AdonisJS encryption)
- Accès contrôlé par `allowedCompanyIds`
- Pas d'accès direct aux fichiers sans vérification d'autorisation

### 9.3. Rate Limiting
- Protection anti-spam sur les endpoints OTP (30s de délai)
- Limitation des uploads de fichiers (taille, fréquence)

### 9.4. Performance
- Les listes de drivers/invitations sont paginées si nécessaire
- Preload des relations pour éviter les N+1 queries
- Cache des documents requis pour réduire les calculs

---

## 10. Tests & Validation

### 10.1. Scénarios de Tests Manuels

**Test 1 : Nouveau Driver**
- [ ] Login OTP fonctionne
- [ ] Enregistrement driver crée `DriverSetting`
- [ ] Invitation visible dans la liste
- [ ] Acceptation change le status
- [ ] Documents copiés correctement

**Test 2 : Driver Existant**
- [ ] Documents pré-chargés depuis User
- [ ] Status des documents = PENDING
- [ ] Manager peut re-valider

**Test 3 : Rejet de Document**
- [ ] Driver reçoit notification
- [ ] Re-upload possible
- [ ] Ancien fichier conservé
- [ ] Status recalculé correctement

**Test 4 : Invitation Finale**
- [ ] Bloqué si docs non validés
- [ ] SMS envoyé au driver
- [ ] Acceptation met à jour `currentCompanyId`

### 10.2. Endpoints à Tester avec cURL

Voir les exemples dans la section 3 (Endpoints API)

---

## Fin du Document

Ce document décrit le flux complet d'invitation et d'onboarding des drivers dans Sublymus. Il est basé sur l'implémentation réelle du backend (AdonisJS) et doit être maintenu à jour en cas d'évolution du code.

**Dernière mise à jour** : 2026-01-18
