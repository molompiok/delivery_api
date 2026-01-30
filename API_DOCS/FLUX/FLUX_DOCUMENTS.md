# Flux de Validation des Documents (Sublymus Admin)

## 🎯 Vue d'ensemble

Ce document décrit le flux complet de validation des documents des drivers par les administrateurs **Sublymus Admin**. Ce flux est distinct de la validation par les managers ETP (décrite dans FLUX_INVITATION.md).

### Différence clé : Validation Sublymus vs Validation ETP

- **Validation Sublymus Admin** : Valide les documents **globaux** du driver (stockés sur la table `User`)
- **Validation ETP Manager** : Valide les documents **spécifiques** pour l'entreprise (stockés sur `CompanyDriverSetting`)

Les deux validations sont **indépendantes** et **obligatoires**.

---

## 📋 Table des Matières

1. [Architecture des Documents](#1-architecture-des-documents)
2. [Flux Complet](#2-flux-complet)
3. [Endpoints API](#3-endpoints-api)
4. [Modèles de Données](#4-modèles-de-données)
5. [États et Transitions](#5-états-et-transitions)
6. [Synchronisation Automatique](#6-synchronisation-automatique)
7. [Exemples cURL](#7-exemples-curl)

---

## 1. Architecture des Documents

### 1.1. Structure Polymorphique

Les documents dans Sublymus utilisent une architecture polymorphique :

```typescript
{
  tableName: 'User' | 'CompanyDriverSetting' | 'Vehicle',
  tableId: string,  // ID de l'entité parente
  documentType: string,  // Type de document
  ownerId: string,  // ID du propriétaire (User ou Company)
  ownerType: 'User' | 'Company'
}
```

### 1.2. Types de Documents Drivers (User)

Documents requis pour les drivers indépendants ou pour validation globale Sublymus :

- `PERMIS_CONDUIRE` - Permis de conduire
- `CARTE_IDENTITE` - Carte d'identité nationale
- `ASSURANCE_VEHICULE` - Assurance du véhicule
- `CARTE_GRISE` - Certificat d'immatriculation
- `PHOTO_PROFIL` - Photo de profil
- Autres documents personnalisés selon les besoins

---

## 2. Flux Complet

### 2.1. Diagramme de Flux Global

```
┌─────────────┐                    ┌──────────────┐                   ┌─────────────┐
│   Driver    │                    │   Backend    │                   │   Admin     │
│  (Mobile)   │                    │     API      │                   │ Sublymus    │
└──────┬──────┘                    └──────┬───────┘                   └──────┬──────┘
       │                                  │                                  │
       │ 1. Connexion OTP                 │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 2. Token retourné                │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ 3. S'enregistrer comme driver    │                                  │
       │  POST /driver/register           │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ Création DriverSetting           │
       │                                  │ (verificationStatus: PENDING)    │
       │                                  │                                  │
       │ 4. GET /driver/documents         │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 5. Liste des documents requis                                      │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ 6. Upload fichier physique       │                                  │
       │  POST /v1/files/upload           │                                  │
       │  (retourne fileId)               │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 7. Liaison au document           │                                  │
       │  PATCH /v1/documents/:id/submit  │                                  │
       │  {fileId: "fil_xxx"}             │                                  │
       │ 7. Vérifier mes documents        │                                  │
       │  GET /driver/documents           │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 8. Documents visibles (PENDING)  │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │                                  │ 9. Admin: Connexion OTP          │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 10. Token admin                  │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ 11. Liste drivers en attente     │
       │                                  │  GET /admin/drivers/pending      │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 12. Liste retournée              │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ 13. Voir docs d'un driver        │
       │                                  │  GET /admin/drivers/:id/documents│
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 14. Documents du driver          │
       │                                  │─────────────────────────────────>│
       │                                  │                                  │
       │                                  │ 15. Valider document 1           │
       │                                  │  POST /admin/drivers/documents/  │
       │                                  │       :docId/validate            │
       │                                  │  {status: APPROVED}              │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ Doc1: APPROVED                   │
       │                                  │ Auto-sync driver status          │
       │                                  │                                  │
       │                                  │ 16. Valider document 2           │
       │                                  │  {status: APPROVED}              │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ 17. Rejeter document 3           │
       │                                  │  {status: REJECTED,              │
       │                                  │   comment: "Expiré"}             │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ Doc3: REJECTED                   │
       │                                  │ verificationStatus: REJECTED     │
       │                                  │                                  │
       │ 18. Notification: Document rejeté                                   │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ 19. Voir mes documents           │                                  │
       │  GET /driver/documents           │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │ 20. Documents avec statuts       │                                  │
       │  (2 APPROVED, 1 REJECTED)        │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ 21. Re-upload document rejeté    │                                  │
       │  POST /files/upload              │                                  │
       │─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ Doc remis en PENDING             │
       │                                  │ verificationStatus: PENDING      │
       │                                  │                                  │
       │                                  │ 22. Admin re-valide              │
       │                                  │  {status: APPROVED}              │
       │                                  │<─────────────────────────────────│
       │                                  │                                  │
       │                                  │ Tous docs APPROVED               │
       │                                  │ verificationStatus: VERIFIED     │
       │                                  │                                  │
       │ 23. Notification: Compte vérifié │                                  │
       │<─────────────────────────────────│                                  │
       │                                  │                                  │
       │ 24. Driver peut recevoir commandes                                  │
       │                                  │                                  │
```

### 2.2. Description Étape par Étape

#### **Phase 1: Enregistrement Driver**
1. **Driver se connecte** via OTP SMS
2. **Driver s'enregistre** comme driver (vehicleType, vehiclePlate)
3. **DriverSetting créé** avec `verificationStatus: PENDING`
4. **Placeholders de Documents créés** automatiquement pour le driver (Permis, CNI, etc.)

#### **Phase 2: Soumission Documents**
5. **Driver upload le fichier physique** sur `/v1/files/upload` et reçoit un `fileId`
6. **Driver lie le fichier au document** via `PATCH /v1/documents/:docId/submit`
7. Le `Document` passe en `status: PENDING`
8. Driver peut voir ses documents et leur statut

#### **Phase 3: Validation Admin**
7. **Admin se connecte** via OTP
8. **Admin liste les drivers** en attente (`GET /admin/drivers/pending`)
9. **Admin sélectionne un driver** et visualise ses documents
10. **Admin valide ou rejette** chaque document individuellement :
    - **APPROVED** : Document accepté
    - **REJECTED** : Document refusé avec commentaire obligatoire

#### **Phase 4: Synchronisation Automatique**
11. Après chaque validation/rejet, le système **recalcule automatiquement** le `DriverSetting.verificationStatus` :
    - **Tous APPROVED** → `verificationStatus: VERIFIED`
    - **Au moins un REJECTED** → `verificationStatus: REJECTED`
    - **Au moins un PENDING** → `verificationStatus: PENDING`

#### **Phase 5: Re-soumission (si rejet)**
12. Driver voit les documents rejetés avec commentaires
13. Driver **re-upload** les documents rejetés
14. Document passe en `PENDING`, driver repasse en `PENDING`
15. Admin re-valide
16. Si tous docs validés → Driver `VERIFIED`

---

## 3. Endpoints API

### 3.1. Endpoints Driver

#### Voir mes documents
```http
GET /v1/driver/documents
Authorization: Bearer {driver_token}

Response: 200 OK
{
  "documents": [
    {
      "id": "doc_xxx",
      "documentType": "PERMIS_CONDUIRE",
      "status": "APPROVED",
      "fileId": "file_yyy",
      "file": {
        "id": "file_yyy",
        "name": "permis.pdf",
        "mimeType": "application/pdf",
        "size": 245678
      },
      "validationComment": "Permis valide",
      "expireAt": null,
      "createdAt": "2026-01-18T10:00:00Z",
      "updatedAt": "2026-01-18T12:00:00Z"
    },
    {
      "id": "doc_zzz",
      "documentType": "ASSURANCE_VEHICULE",
      "status": "REJECTED",
      "fileId": "file_aaa",
      "file": {...},
      "validationComment": "Assurance expirée, veuillez fournir une version à jour",
      "expireAt": null,
      "createdAt": "2026-01-18T10:05:00Z",
      "updatedAt": "2026-01-18T12:10:00Z"
    }
  ]
}
```

#### Voir mon profil driver
```http
GET /v1/driver/me
Authorization: Bearer {driver_token}

Response: 200 OK
{
  "id": "ds_xxx",
  "userId": "usr_yyy",
  "vehicleType": "MOTORCYCLE",
  "vehiclePlate": "AA-1234-CI",
  "verificationStatus": "PENDING" | "VERIFIED" | "REJECTED",
  "status": "ONLINE" | "OFFLINE" | "BUSY" | "PAUSE",
  ...
}
```

### 3.2. Endpoints Admin

#### Liste des drivers en attente
```http
GET /v1/admin/drivers/pending
Authorization: Bearer {admin_token}

Response: 200 OK
[
  {
    "id": "ds_xxx",
    "userId": "usr_yyy",
    "vehicleType": "MOTORCYCLE",
    "vehiclePlate": "AA-1234-CI",
    "verificationStatus": "PENDING",
    "user": {
      "id": "usr_yyy",
      "fullName": "Jean Dupont",
      "email": "jean@example.com",
      "phone": "+2250700000000",
      "isDriver": true
    }
  },
  ...
]
```

#### Voir les documents d'un driver
```http
GET /v1/admin/drivers/:driverId/documents
Authorization: Bearer {admin_token}

Response: 200 OK
{
  "driver": {
    "id": "usr_yyy",
    "fullName": "Jean Dupont",
    "email": "jean@example.com",
    "phone": "+2250700000000"
  },
  "documents": [
    {
      "id": "doc_xxx",
      "documentType": "PERMIS_CONDUIRE",
      "status": "PENDING",
      "fileId": "file_yyy",
      "file": {
        "id": "file_yyy",
        "name": "permis.pdf",
        "mimeType": "application/pdf",
        "size": 245678
      },
      "validationComment": null,
      "expireAt": null,
      "createdAt": "2026-01-18T10:00:00Z",
      "updatedAt": "2026-01-18T10:00:00Z"
    },
    ...
  ]
}
```

#### Valider ou rejeter un document
```http
POST /v1/admin/drivers/documents/:docId/validate
Authorization: Bearer {admin_token}
Content-Type: application/json

# Pour APPROUVER
{
  "status": "APPROVED",
  "comment": "Document conforme"  // Optionnel
}

# Pour REJETER
{
  "status": "REJECTED",
  "comment": "Photo floue, veuillez re-télécharger"  // Requis
}

Response: 200 OK
{
  "message": "Document approved" | "Document rejected",
  "document": {
    "id": "doc_xxx",
    "documentType": "PERMIS_CONDUIRE",
    "status": "APPROVED",
    "validationComment": "Document conforme",
    "metadata": {
      "history": [
        {
          "timestamp": "2026-01-18T10:00:00Z",
          "action": "CREATED_FOR_TEST",
          "actorId": "system",
          "actorTable": "System"
        },
        {
          "timestamp": "2026-01-18T12:00:00Z",
          "action": "ADMIN_VALIDATION",
          "actorId": "usr_admin",
          "actorTable": "User",
          "status": "APPROVED",
          "comment": "Document conforme"
        }
      ]
    },
    ...
  }
}
```

#### Vérifier un driver globalement (optionnel)
```http
POST /v1/admin/drivers/:driverId/verify
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "status": "VERIFIED" | "REJECTED"
}

Response: 200 OK
{
  "message": "Driver status updated to VERIFIED",
  "driverSetting": {
    "id": "ds_xxx",
    "verificationStatus": "VERIFIED",
    ...
  }
}
```

**Note** : Cette route permet de forcer manuellement le statut, mais normalement le statut est calculé automatiquement basé sur les documents.

---

## 4. Modèles de Données

### 4.1. Document

```typescript
{
  id: string,                    // NanoID: doc_xxxxx
  
  // Relation polymorphique
  tableName: string,             // 'User', 'CompanyDriverSetting', 'Vehicle'
  tableId: string,               // ID de l'entité parente
  
  // Type et fichier
  documentType: string,          // 'PERMIS_CONDUIRE', 'CARTE_IDENTITE', etc.
  fileId: string | null,         // Référence vers File
  
  // Validation
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
  validationComment: string | null,
  
  // Ownership
  ownerId: string,               // ID du propriétaire (User ou Company)
  ownerType: 'User' | 'Company',
  
  // Soft delete
  isDeleted: boolean,
  
  // Expiration (optionnel)
  expireAt: DateTime | null,
  
  // Métadonnées et historique
  metadata: {
    history: Array<{
      timestamp: string,
      action: string,           // 'CREATED', 'ADMIN_VALIDATION', 'FILE_UPLOADED', etc.
      actorId: string,
      actorTable: string,
      status?: string,
      comment?: string,
      ...
    }>
  },
  
  createdAt: DateTime,
  updatedAt: DateTime,
  
  // Relations
  file?: File
}
```

### 4.2. DriverSetting

```typescript
{
  id: string,                    // NanoID: ds_xxxxx
  userId: string,                // Référence vers User
  
  vehicleType: 'MOTORCYCLE' | 'CAR' | 'VAN' | 'TRUCK',
  vehiclePlate: string,
  
  // Statut de vérification (calculé automatiquement)
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED',
  
  // Statut opérationnel
  status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE',
  
  // Company actuelle
  currentCompanyId: string | null,
  
  // Position GPS actuelle
  currentLat: number | null,
  currentLng: number | null,
  
  // Statistiques
  mileage: number,
  
  createdAt: DateTime,
  updatedAt: DateTime,
  
  // Relations
  user: User,
  currentCompany?: Company
}
```

### 4.3. File

```typescript
{
  id: string,                    // NanoID: file_xxxxx
  path: string,                  // Chemin physique du fichier
  name: string,                  // Nom original
  mimeType: string,              // Type MIME
  size: number,                  // Taille en bytes
  
  // Relation polymorphique
  tableName: string,
  tableColumn: string,
  tableId: string,
  
  // Sécurité
  allowedUserIds: string[],
  allowedCompanyIds: string[],
  
  // Métadonnées
  metadata: any,
  
  createdAt: DateTime,
  updatedAt: DateTime
}
```

---

## 5. États et Transitions

### 5.1. Document.status

```
┌─────────┐
│ PENDING │  (Document créé mais pas encore validé)
└────┬────┘
     │
     ├────> APPROVED  (Admin valide)
     │
     └────> REJECTED  (Admin rejette)
             │
             │ Re-upload
             └────> PENDING
                    │
                    └────> APPROVED (Admin re-valide)
```

### 5.2. DriverSetting.verificationStatus

```
┌─────────┐
│ PENDING │  (En attente de validation)
└────┬────┘
     │
     │ Tous documents APPROVED
     ├────> VERIFIED
     │
     │ Au moins un document REJECTED
     ├────> REJECTED
     │        │
     │        │ Document re-soumis et PENDING
     │        └────> PENDING
     │               │
     │               │ Tous documents APPROVED
     │               └────> VERIFIED
     │
     │ Document expiré
     └────> REJECTED
            │
            │ Document renouvelé et APPROVED
            └────> VERIFIED
```

### 5.3. Règles de Synchronisation

La synchronisation automatique du `verificationStatus` se fait selon ces règles :

1. **Si au moins un document est REJECTED** → `REJECTED`
2. **Sinon, si au moins un document est PENDING** → `PENDING`
3. **Sinon, si tous les documents sont APPROVED** → `VERIFIED`
4. **Si aucun document** → `PENDING`

Cette logique est implémentée dans `VerificationService.syncDriverVerificationStatus()`.

---

## 6. Synchronisation Automatique

### 6.1. Déclencheurs

La synchronisation automatique du statut driver est déclenchée après :

- ✅ Validation d'un document par un admin
- ✅ Rejet d'un document par un admin
- ✅ Upload d'un nouveau document par le driver
- ✅ Expiration d'un document (via job planifié)

### 6.2. Implémentation

```typescript
// services/verification_service.ts

async syncDriverVerificationStatus(userId: string) {
    const documents = await Document.query()
        .where('tableName', 'User')
        .where('tableId', userId)
        .where('isDeleted', false)

    if (documents.length === 0) {
        // Pas de documents, reste PENDING
        return
    }

    const allApproved = documents.every(doc => doc.status === 'APPROVED')
    const anyRejected = documents.some(doc => doc.status === 'REJECTED')
    const anyPending = documents.some(doc => doc.status === 'PENDING')

    const driverSetting = await DriverSetting.query()
        .where('userId', userId)
        .first()

    if (!driverSetting) return

    if (allApproved) {
        driverSetting.verificationStatus = 'VERIFIED'
    } else if (anyRejected) {
        driverSetting.verificationStatus = 'REJECTED'
    } else if (anyPending) {
        driverSetting.verificationStatus = 'PENDING'
    }

    await driverSetting.save()
    return driverSetting
}
```

### 6.3. Notifications

Après chaque changement de statut, des notifications doivent être envoyées :

| Événement | Destinataire | Message |
|-----------|--------------|---------|
| Document APPROVED | Driver | "Votre {documentType} a été validé" |
| Document REJECTED | Driver | "Votre {documentType} a été rejeté : {comment}" |
| Tous docs APPROVED | Driver | "🎉 Votre compte est maintenant vérifié ! Vous pouvez recevoir des commandes." |
| verificationStatus → REJECTED | Driver | "⚠️ Votre compte nécessite une action : certains documents doivent être re-soumis." |

---

## 7. Exemples cURL

### 7.1. Scénario Complet

#### Étape 1: Driver se connecte
```bash
# Demander OTP
curl -X POST http://localhost:3333/v1/auth/phone/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2250700000302"}'

# Response: {"message": "SMS OTP sent", "otp": "152247"}

# Vérifier OTP
curl -X POST http://localhost:3333/v1/auth/phone/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2250700000302", "otp": "152247"}'

# Response: {"token": "oat_xxx...", "user": {...}}
# Sauvegarder le token: DRIVER_TOKEN
```

#### Étape 2: Driver s'enregistre
```bash
curl -X POST http://localhost:3333/v1/driver/register \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vehicleType": "MOTORCYCLE", "vehiclePlate": "AA-1234-CI"}'
```

#### Étape 3: Driver voit ses documents (vide au début)
```bash
curl -X GET http://localhost:3333/v1/driver/documents \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# Response: {"documents": []}
```

#### Étape 4: Admin se connecte
```bash
# Demander OTP admin
curl -X POST http://localhost:3333/v1/auth/phone/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2250759929515"}'

# Vérifier OTP
curl -X POST http://localhost:3333/v1/auth/phone/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+2250759929515", "otp": "598447"}'

# Sauvegarder le token: ADMIN_TOKEN
```

#### Étape 5: Admin liste les drivers en attente
```bash
curl -X GET http://localhost:3333/v1/admin/drivers/pending \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Étape 6: Admin voit les documents d'un driver
```bash
curl -X GET http://localhost:3333/v1/admin/drivers/usr_uurbrqyccqh2imucta/documents \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Étape 7: Admin valide un document
```bash
curl -X POST http://localhost:3333/v1/admin/drivers/documents/doc_xxx/validate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "APPROVED", "comment": "Permis valide"}'
```

#### Étape 8: Admin rejette un document
```bash
curl -X POST http://localhost:3333/v1/admin/drivers/documents/doc_yyy/validate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "REJECTED", "comment": "Assurance expirée, veuillez soumettre une version à jour"}'
```

#### Étape 9: Driver vérifie le statut
```bash
curl -X GET http://localhost:3333/v1/driver/me \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# verificationStatus: "REJECTED" (car au moins un doc rejeté)
```

#### Étape 10: Driver voit les documents
```bash
curl -X GET http://localhost:3333/v1/driver/documents \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# Documents avec statuts APPROVED/REJECTED et commentaires
```

---

## 8. Cas d'Usage Détaillés

### Cas 1: Nouveau Driver - Tous Documents Approuvés

**Scénario** : Jean s'inscrit comme driver, upload ses documents, admin valide tout.

1. Jean se connecte via OTP → Token reçu
2. Jean s'enregistre comme driver → `verificationStatus: PENDING`
3. Jean upload 3 documents (permis, CNI, assurance) → Tous `status: PENDING`
4. Admin Opus voit Jean dans la liste des drivers en attente
5. Admin vérifie les 3 documents
6. Admin valide les 3 documents → Tous `status: APPROVED`
7. **Automatiquement** : `verificationStatus: VERIFIED`
8. Jean reçoit notification "Compte vérifié !"
9. Jean peut maintenant recevoir des commandes

### Cas 2: Driver avec Document Rejeté

**Scénario** : Marie upload des documents, l'admin en rejette un.

1. Marie upload 3 documents
2. Admin valide permis et CNI → `APPROVED`
3. Admin rejette assurance → `REJECTED` avec commentaire "Assurance expirée"
4. **Automatiquement** : `verificationStatus: REJECTED`
5. Marie reçoit notification avec le commentaire
6. Marie voit dans l'app quel document est rejeté et pourquoi
7. Marie re-upload une nouvelle assurance
8. Document assurance repasse en `PENDING`
9. **Automatiquement** : `verificationStatus: PENDING`
10. Admin re-valide l'assurance → `APPROVED`
11. **Automatiquement** : `verificationStatus: VERIFIED`

### Cas 3: Document Expiré (Futur)

**Scénario** : Un driver vérifié a un document qui expire.

1. Driver est `VERIFIED`, tous documents `APPROVED`
2. Job planifié détecte que l'assurance expire dans 7 jours
3. Notification envoyée au driver "Votre assurance expire bientôt"
4. À l'expiration : Document passe en `REJECTED`
5. **Automatiquement** : `verificationStatus: REJECTED`
6. Driver ne peut plus recevoir de commandes
7. Driver upload nouvelle assurance
8. Admin valide
9. **Automatiquement** : `verificationStatus: VERIFIED`
10. Driver peut à nouveau recevoir des commandes

---

## 9. Sécurité et Permissions

### 9.1. Règles d'Accès

| Endpoint | Rôle requis | Conditions |
|----------|-------------|------------|
| `GET /driver/documents` | Driver (isDriver) | Voir uniquement ses propres documents |
| `GET /driver/me` | Driver (isDriver) | Voir uniquement son profil |
| `GET /admin/drivers/pending` | Admin (isAdmin) | Accès complet |
| `GET /admin/drivers/:id/documents` | Admin (isAdmin) | Voir documents de n'importe quel driver |
| `POST /admin/drivers/documents/:id/validate` | Admin (isAdmin) | Valider uniquement documents User (tableName='User') |

### 9.2. Isolation des Données

- Les documents d'un driver (table `User`) sont **visibles** par :
  - Le driver lui-même
  - Tous les admins Sublymus
  
- Les documents d'un driver pour une entreprise (table `CompanyDriverSetting`) sont **visibles** par :
  - Le driver
  - Le manager de l'entreprise concernée
  - Tous les admins Sublymus

### 9.3. Historique Immuable

Toutes les validations sont enregistrées dans `metadata.history` avec :
- Timestamp exact
- ID de l'acteur (admin)
- Action effectuée
- Commentaire éventuel

Cet historique est **immuable** et sert d'audit trail.

---

## 10. Tests

### 10.1. Tests Unitaires Requis

```typescript
// tests/unit/verification_service.test.ts

test('syncDriverVerificationStatus - tous approuvés', async () => {
  // Créer driver avec 3 documents APPROVED
  // Appeler syncDriverVerificationStatus
  // Assert: verificationStatus === 'VERIFIED'
})

test('syncDriverVerificationStatus - un rejeté', async () => {
  // Créer driver avec 2 APPROVED, 1 REJECTED
  // Appeler syncDriverVerificationStatus
  // Assert: verificationStatus === 'REJECTED'
})

test('syncDriverVerificationStatus - un pending', async () => {
  // Créer driver avec 2 APPROVED, 1 PENDING
  // Appeler syncDriverVerificationStatus
  // Assert: verificationStatus === 'PENDING'
})
```

### 10.2. Tests d'Intégration

Voir le test complet effectué dans ce document (section Tests cURL).

---

## 11. Évolutions Futures

### 11.1. Priorité 1 (MVP 0)

- ✅ Validation manuelle par admin
- ✅ Synchronisation automatique du statut
- ✅ Historique des validations
- ⏳ Upload réel de fichiers (multipart/form-data)
- ⏳ Visualisation des fichiers dans le dashboard admin
- ⏳ Notifications push/SMS au driver

### 11.2. Priorité 2 (Growth)

- ⏳ Gestion d'expiration automatique des documents
- ⏳ Job planifié pour vérifier les expirations
- ⏳ Validation semi-automatique par IA (détection OCR)
- ⏳ Webhooks pour notifier les systèmes externes

### 11.3. Priorité 3 (Scale)

- ⏳ Workflow d'approbation multi-niveaux
- ⏳ Délégation de validation à des validateurs non-admin
- ⏳ Analytics et reporting sur les documents
- ⏳ Archivage automatique des anciens documents

---

## Fin du Document

Ce document décrit le flux complet de validation des documents des drivers par Sublymus Admin. Il est basé sur l'implémentation réelle testée le 2026-01-18.

**Dernière mise à jour** : 2026-01-18  
**Version** : 1.0  
**Testé** : ✅ Oui (voir section Tests cURL)
