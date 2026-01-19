# Flux: Gestion des Véhicules

## 🎯 Objectif du Flux

Permettre la gestion des **véhicules de livraison** avec une approche hybride similaire aux zones :

| Type de Véhicule | Propriétaire | Description |
|------------------|--------------|-------------|
| **User** | Driver (IDEP) | Véhicules personnels du chauffeur |
| **Company** | Entreprise (ETP) | Véhicules de la flotte de l'entreprise |

> **Principe clé** : Un seul véhicule actif par driver et par mode (IDEP/ETP)

---

## 🏗️ Architecture

### 📊 Modèle de Propriété

```
┌─────────────────────────────────────────────────────────────┐
│                    VÉHICULES                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   IDEP (Driver)                    ETP (Company)            │
│   ─────────────                    ─────────────            │
│                                                             │
│   Vehicle                          Vehicle                  │
│   ownerType: 'User'                ownerType: 'Company'     │
│   ownerId: user.id                 ownerId: company.id      │
│         │                                │                  │
│         ▼                                ▼                  │
│   DriverSetting                    CompanyDriverSetting     │
│   .activeVehicleId                 .activeVehicleId         │
│         │                                │                  │
│         ▼                                ▼                  │
│   ┌──────────────┐                 ┌──────────────┐         │
│   │ Driver IDEP  │                 │ Driver ETP   │         │
│   │ utilise son  │                 │ avec véhicule│         │
│   │ véhicule     │                 │ de la flotte │         │
│   └──────────────┘                 └──────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 📊 Documents Véhicule

```
┌─────────────────────────────────────────────────────────────┐
│                DOCUMENTS VÉHICULE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   IDEP (Driver Perso)              ETP (Company)            │
│   ─────────────────                ─────────────            │
│                                                             │
│   Driver upload docs               Manager upload docs      │
│         │                                │                  │
│         ▼                                ▼                  │
│   status: PENDING                  L'entreprise gère        │
│         │                          ses propres docs         │
│         ▼                          (responsable des         │
│   Admin Sublymus                   vérifications)           │
│   valide/rejette                                            │
│         │                                                   │
│         ▼                                                   │
│   status: APPROVED/REJECTED                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 Modèles de Données

### Vehicle

```typescript
export type VehicleOwnerType = 'User' | 'Company'
export type VehicleType = 'MOTO' | 'CAR_SEDAN' | 'VAN' | 'TRUCK' | 'BICYCLE'
export type VehicleEnergy = 'GASOLINE' | 'DIESEL' | 'ELECTRIC' | 'HYBRID'
export type VehicleStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

class Vehicle {
    id: string                          // vhc_xxxxx
    
    // Propriété polymorphique
    ownerType: VehicleOwnerType         // 'User' ou 'Company'
    ownerId: string                     // ID du driver ou de l'entreprise
    
    // Assignation legacy (Company)
    companyId: string | null
    assignedDriverId: string | null     // Driver assigné (sync avec activeVehicleId)
    
    // Métadonnées
    type: VehicleType                   // MOTO, CAR_SEDAN, VAN, TRUCK, BICYCLE
    brand: string                       // Marque
    model: string                       // Modèle
    plate: string                       // Immatriculation
    year: number | null
    color: string | null
    energy: VehicleEnergy
    
    // Spécifications logistiques
    specs: {
        maxWeight?: number              // Poids max en kg
        cargoVolume?: number            // Volume en m³
        height?: number
        length?: number
        width?: number
    } | null
    
    // Statut
    verificationStatus: VehicleStatus   // PENDING → APPROVED/REJECTED
    isActive: boolean
    
    // Historique
    metadata: {
        assignmentHistory?: Array<{
            driverId: string | null
            driverName: string
            managerId: string
            managerName: string
            action: 'ASSIGNED' | 'UNASSIGNED'
            timestamp: string
        }>
    } | null
    
    // Relations
    files: File[]                       // Documents attachés
    orders: Order[]                     // Commandes effectuées
}
```

### DriverSetting (Mode IDEP)

```typescript
class DriverSetting {
    id: string                          // ds_xxxxx
    userId: string
    
    activeZoneId: string | null         // Zone active
    activeVehicleId: string | null      // 🆕 Véhicule actif en mode IDEP
    
    vehicleType: string | null
    vehiclePlate: string | null
    verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE'
    // ...
}
```

### CompanyDriverSetting (Mode ETP)

```typescript
class CompanyDriverSetting {
    id: string                          // cds_xxxxx
    companyId: string
    driverId: string
    
    activeZoneId: string | null         // Zone active
    activeVehicleId: string | null      // 🆕 Véhicule actif en mode ETP
    
    status: CompanyDriverStatus
    docsStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
    // ...
}
```

---

## 🔌 Endpoints API

### 1. **Lister les véhicules**

```http
GET /v1/vehicles?ownerType=Company&ownerId={companyId}
Authorization: Bearer {token}
```

**Response: 200 OK**
```json
[
  {
    "id": "vhc_abc123",
    "ownerType": "Company",
    "ownerId": "cmp_xyz789",
    "type": "MOTO",
    "brand": "Honda",
    "model": "PCX 125",
    "plate": "AB-1234-CI",
    "year": 2023,
    "color": "Noir",
    "energy": "GASOLINE",
    "verificationStatus": "APPROVED",
    "isActive": true,
    "assignedDriverId": "usr_driver1"
  }
]
```

---

### 2. **Créer un véhicule**

```http
POST /v1/vehicles
Authorization: Bearer {token}
Content-Type: application/json

{
  "ownerType": "User",
  "ownerId": "usr_abc123",
  "type": "MOTO",
  "brand": "Yamaha",
  "model": "NMAX",
  "plate": "XY-5678-CI",
  "year": 2022,
  "color": "Bleu",
  "energy": "GASOLINE",
  "specs": {
    "maxWeight": 50,
    "cargoVolume": 0.1
  }
}
```

---

### 3. **Définir le véhicule actif (Mode ETP)**

```http
POST /v1/vehicles/{vehicle_id}/set-active-etp
Authorization: Bearer {token}
Content-Type: application/json

{
  "driverId": "usr_driver123"
}
```

> Le **Manager** définit quel véhicule Company est actif pour un driver de sa flotte.

**Response: 200 OK**
```json
{
  "message": "Active vehicle set successfully",
  "companyDriverSetting": {
    "id": "cds_xxx",
    "companyId": "cmp_yyy",
    "driverId": "usr_driver123",
    "activeVehicleId": "vhc_abc123"
  }
}
```

**Erreurs possibles** :
- `404` : Véhicule Company non trouvé
- `403` : Driver n'appartient pas à l'entreprise
- `409` : Véhicule déjà assigné à un autre driver

---

### 4. **Retirer le véhicule actif (Mode ETP)**

```http
POST /v1/vehicles/clear-active-etp
Authorization: Bearer {token}
Content-Type: application/json

{
  "driverId": "usr_driver123"
}
```

**Response: 200 OK**
```json
{
  "message": "Active vehicle cleared"
}
```

---

### 5. **Définir le véhicule actif (Mode IDEP)**

```http
POST /v1/vehicles/{vehicle_id}/set-active-idep
Authorization: Bearer {token}
```

> Le **Driver** définit son véhicule personnel actif pour livrer en mode indépendant.

**Response: 200 OK**
```json
{
  "message": "Active IDEP vehicle set successfully",
  "driverSetting": {
    "id": "ds_xxx",
    "userId": "usr_driver123",
    "activeVehicleId": "vhc_abc123"
  }
}
```

**Règle** : Le driver ne peut activer que ses propres véhicules (`ownerType: 'User'`, `ownerId: user.id`)

---

### 6. **Retirer le véhicule actif (Mode IDEP)**

```http
POST /v1/vehicles/clear-active-idep
Authorization: Bearer {token}
```

---

### 7. **Obtenir le driver actif d'un véhicule**

```http
GET /v1/vehicles/{vehicle_id}/driver
Authorization: Bearer {token}
```

**Response: 200 OK**
```json
{
  "vehicle": {
    "id": "vhc_abc123",
    "name": "Honda PCX 125",
    "plate": "AB-1234-CI",
    "ownerType": "Company"
  },
  "activeDriver": {
    "id": "usr_driver123",
    "fullName": "Jean Kouassi",
    "phone": "+225XXXXXXXX"
  }
}
```

---

### 8. **Uploader un document véhicule**

```http
POST /v1/vehicles/{vehicle_id}/documents
Authorization: Bearer {token}
Content-Type: multipart/form-data

file: [binary]
docType: "VEHICLE_INSURANCE"
expiryDate: "2027-01-15"
```

**Types de documents** :
- `VEHICLE_INSURANCE` - Assurance (expiration requise)
- `VEHICLE_TECHNICAL_VISIT` - Visite technique (expiration requise)
- `VEHICLE_REGISTRATION` - Carte grise

---

### 9. **Valider un document (Admin Sublymus)**

```http
POST /v1/vehicle-documents/{docId}/validate
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "APPROVED",
  "comment": "Document conforme"
}
```

> Réservé aux Admins Sublymus pour les véhicules IDEP.

---

## ⚙️ Règles Métier

### 1. **Un seul véhicule actif par mode**

- Un driver peut avoir :
  - **1 véhicule actif IDEP** (dans `DriverSetting.activeVehicleId`)
  - **1 véhicule actif ETP** par entreprise (dans `CompanyDriverSetting.activeVehicleId`)

### 2. **Un véhicule Company = Un driver max**

- Si un véhicule Company est déjà assigné à un driver, il ne peut pas être assigné à un autre
- Erreur `409 Conflict` : "Vehicle is already assigned to another driver"

### 3. **Propriété et Permissions**

| Action | Admin | Manager | Driver |
|--------|-------|---------|--------|
| Créer véhicule User | ✅ | ❌ | ✅ (soi-même) |
| Créer véhicule Company | ✅ | ✅ | ❌ |
| Modifier véhicule User | ✅ | ❌ | ✅ (le sien) |
| Modifier véhicule Company | ✅ | ✅ | ❌ |
| Set active vehicle ETP | ❌ | ✅ | ❌ |
| Set active vehicle IDEP | ❌ | ❌ | ✅ |
| Upload document | ✅ | ✅ (Company) | ✅ (User) |
| Valider document IDEP | ✅ | ❌ | ❌ |

### 4. **Documents selon le mode**

| Mode | Upload par | Validation par | Responsable |
|------|------------|----------------|-------------|
| **IDEP** | Driver | Admin Sublymus | Sublymus |
| **ETP** | Manager | Manager | Entreprise |

### 5. **Types de véhicule**

| Type | Description | Capacité type |
|------|-------------|---------------|
| `BICYCLE` | Vélo | < 10 kg |
| `MOTO` | Moto/Scooter | 10-50 kg |
| `CAR_SEDAN` | Voiture berline | 50-200 kg |
| `VAN` | Fourgonnette | 200-500 kg |
| `TRUCK` | Camion | > 500 kg |

---

## 🧪 Cas d'Usage Détaillés

### Cas 1 : Driver IDEP crée et active son véhicule

1. Driver se connecte en mode IDEP
2. Va dans "Mes Véhicules"
3. Clique "Ajouter un véhicule"
4. Remplit : Moto Yamaha NMAX, AB-1234-CI
5. Upload les documents (assurance, carte grise)
6. Sublymus Admin valide les documents
7. Driver active le véhicule
8. `POST /vehicles/{id}/set-active-idep`
9. Peut maintenant recevoir des commandes

### Cas 2 : Manager ETP assigne un véhicule à un driver

1. Manager accède au dashboard
2. Liste les véhicules de la flotte
3. Sélectionne un véhicule disponible
4. Clique "Assigner à un driver"
5. Choisit "Kofi Mensah" dans la liste
6. `POST /vehicles/{id}/set-active-etp` avec `driverId`
7. Driver voit le véhicule dans son app
8. Peut commencer à livrer

### Cas 3 : Véhicule déjà assigné

1. Manager tente d'assigner un véhicule
2. Le véhicule est déjà utilisé par "Jean Dupont"
3. Erreur 409 : "Vehicle is already assigned to another driver"
4. Manager doit d'abord libérer le véhicule
5. `POST /vehicles/clear-active-etp` avec `driverId: Jean Dupont`
6. Puis réassigner au nouveau driver

---

## 📡 Routes API Résumé

| Méthode | Endpoint | Description | Rôle |
|---------|----------|-------------|------|
| GET | `/v1/vehicles` | Lister les véhicules | Owner |
| POST | `/v1/vehicles` | Créer un véhicule | Manager, Driver |
| GET | `/v1/vehicles/:id` | Voir un véhicule | Owner |
| PUT | `/v1/vehicles/:id` | Modifier un véhicule | Owner |
| DELETE | `/v1/vehicles/:id` | Supprimer un véhicule | Owner |
| GET | `/v1/vehicles/:id/driver` | Driver actif | Owner |
| POST | `/v1/vehicles/:id/set-active-etp` | Activer pour driver ETP | Manager |
| POST | `/v1/vehicles/clear-active-etp` | Désactiver pour driver ETP | Manager |
| POST | `/v1/vehicles/:id/set-active-idep` | Activer véhicule IDEP | Driver |
| POST | `/v1/vehicles/clear-active-idep` | Désactiver véhicule IDEP | Driver |
| POST | `/v1/vehicles/:id/documents` | Upload document | Owner |
| POST | `/v1/vehicle-documents/:docId/validate` | Valider document | Admin |

---

## 📱 Implémentation Mobile (Flutter)

### États à Gérer

```dart
enum VehicleOwnerType { user, company }
enum VehicleType { bicycle, moto, carSedan, van, truck }

class Vehicle {
  String id;
  VehicleOwnerType ownerType;
  String ownerId;
  VehicleType type;
  String brand;
  String model;
  String plate;
  int? year;
  String? color;
  String verificationStatus;
  bool isActive;
}

class DriverState {
  // Mode IDEP
  String? activeIdepVehicleId;  // Depuis DriverSetting.activeVehicleId
  
  // Mode ETP (par entreprise)
  Map<String, String?> activeEtpVehicleIds;  // companyId -> vehicleId
}
```

### Permissions

```dart
bool canEditVehicle(Vehicle vehicle, User user) {
  if (user.isAdmin) return true;
  
  // Driver peut éditer ses propres véhicules
  if (vehicle.ownerType == VehicleOwnerType.user && 
      vehicle.ownerId == user.id) {
    return true;
  }
  
  // Manager peut éditer les véhicules de sa company
  if (vehicle.ownerType == VehicleOwnerType.company && 
      vehicle.ownerId == user.currentCompanyManaged) {
    return true;
  }
  
  return false;
}
```

---

**Dernière mise à jour** : 2026-01-19
