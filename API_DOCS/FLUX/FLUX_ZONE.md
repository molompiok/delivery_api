# Flux: Gestion des Zones

## 🎯 Objectif du Flux

Permettre la gestion des **zones d'intervention** géographiques avec une approche hybride :

| Type de Zone | Propriétaire | Description |
|--------------|--------------|-------------|
| **Sublymus** | Plateforme | Zones globales prédéfinies (villes, quartiers) |
| **Company** | Entreprise (ETP) | Zones de service de la flotte (installées ou créées) |
| **User** | Driver (IDEP) | Zones d'action personnelles |

> **Principe clé** : Une seule zone active par driver et par mode (IDEP/ETP)

---

## 🏗️ Architecture

### 📊 Diagramme - Types de Zones

```
┌─────────────────────────────────────────────────────────────┐
│                    ZONES SUBLYMUS                           │
│              (Globales, maintenues par Sublymus)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  Abidjan    │    │ Yamoussoukro│    │   Bouaké    │     │
│  │  Métropole  │    │   Centre    │    │   Centre    │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
    ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
    │  COMPANY  │      │   IDEP    │      │   IDEP    │
    │  Installe │      │ Référence │      │ Référence │
    │  (Copie)  │      │ Directe   │      │ Directe   │
    └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
          │                  │                  │
          ▼                  ▼                  ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ Zone Company │   │DriverSetting │   │DriverSetting │
   │ sourceZoneId │   │ activeZoneId │   │ activeZoneId │
   │ = zn_sub_xxx │   │ = zn_sub_yyy │   │ = zn_sub_zzz │
   └──────────────┘   └──────────────┘   └──────────────┘
```

### 📊 Diagramme - Activation de Zone

```
┌─────────────────────────────────────────────────────────────┐
│                    ACTIVATION DE ZONE                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   MODE ETP (Entreprise)              MODE IDEP (Driver)     │
│   ─────────────────────              ──────────────────     │
│                                                             │
│   Zone Company                       Zone Sublymus          │
│   (ownerType=Company)                OU Zone User           │
│         │                                  │                │
│         ▼                                  ▼                │
│   CompanyDriverSetting               DriverSetting          │
│   .activeZoneId                      .activeZoneId          │
│         │                                  │                │
│         ▼                                  ▼                │
│   ┌──────────────┐                 ┌──────────────┐        │
│   │  Driver ETP  │                 │ Driver IDEP  │        │
│   │ zone active  │                 │ zone active  │        │
│   │ pour cette   │                 │ personnelle  │        │
│   │ entreprise   │                 │              │        │
│   └──────────────┘                 └──────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 Modèles de Données

### Zone

```typescript
export type ZoneOwnerType = 'Company' | 'User' | 'Sublymus'

class Zone {
    id: string                          // zn_xxxxx

    ownerType: ZoneOwnerType            // Type de propriétaire
    ownerId: string | null              // null si Sublymus
    
    sourceZoneId: string | null         // ID zone source si installée depuis Sublymus
    
    name: string                        // "Abidjan Métropole"
    color: string                       // "#6366f1"
    sector: string | null               // "ABIDJAN", "YAMOUSSOUKRO"
    
    type: 'circle' | 'polygon' | 'rectangle'
    geometry: {
        // Circle
        center?: { lat: number, lng: number }
        radiusKm?: number
        
        // Polygon
        paths?: { lat: number, lng: number }[]
        
        // Rectangle
        bounds?: { north: number, south: number, east: number, west: number }
    }
    
    isActive: boolean                   // Zone utilisée pour le dispatch
    
    createdAt: DateTime
    updatedAt: DateTime
    
    // Méthode
    async getActiveDrivers(): Promise<User[]>
}
```

### DriverSetting (Mode IDEP)

```typescript
class DriverSetting {
    id: string                          // ds_xxxxx
    userId: string                      // Référence au User
    
    activeZoneId: string | null         // 🆕 Zone active en mode IDEP
    
    vehicleType: string | null
    vehiclePlate: string | null
    verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE'
    currentLat: number | null
    currentLng: number | null
    mileage: number
}
```

### CompanyDriverSetting (Mode ETP)

```typescript
class CompanyDriverSetting {
    id: string                          // cds_xxxxx
    companyId: string                   // Entreprise
    driverId: string                    // Driver
    
    activeZoneId: string | null         // 🆕 Zone active en mode ETP
    
    status: CompanyDriverStatus         // ACCEPTED, etc.
    docsStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
    requiredDocTypes: string[]
}
```

---

## 🔌 Endpoints API

### 1. **Lister les zones**

```http
GET /v1/zones
Authorization: Bearer {token}
```

**Règles de filtrage** :

| Rôle | Zones visibles |
|------|----------------|
| **Admin** | Toutes les zones |
| **Manager (ETP)** | Zones Company (sa company) + Zones Sublymus |
| **Driver** | Ses zones User + Zones de sa company + Zones Sublymus |

**Response: 200 OK**
```json
[
  {
    "id": "zn_1xphwzh2t92jyr32jr",
    "ownerType": "Sublymus",
    "ownerId": null,
    "name": "Abidjan Métropole",
    "color": "#6366f1",
    "sector": "ABIDJAN",
    "type": "circle",
    "geometry": {
      "center": { "lat": 5.32, "lng": -4.02 },
      "radiusKm": 20
    },
    "isActive": true,
    "sourceZoneId": null
  },
  {
    "id": "zn_pxt84fm96o2548i6ak",
    "ownerType": "Company",
    "ownerId": "cmp_f1a3k28sfvv162hdbs",
    "name": "Cocody Centre",
    "color": "#10b981",
    "sector": "ABIDJAN",
    "type": "circle",
    "geometry": {
      "center": { "lat": 5.359, "lng": -3.984 },
      "radiusKm": 4
    },
    "isActive": true,
    "sourceZoneId": null
  }
]
```

---

### 2. **Créer une zone**

```http
POST /v1/zones
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body (Circle):**
```json
{
  "name": "Zone Plateau",
  "color": "#3b82f6",
  "sector": "ABIDJAN",
  "type": "circle",
  "geometry": {
    "center": { "lat": 5.32, "lng": -4.02 },
    "radiusKm": 3.5
  },
  "isActive": true
}
```

**Logique de création** :
- Driver → `ownerType = 'User'`, `ownerId = user.id`
- Manager → `ownerType = 'Company'`, `ownerId = companyId`
- Admin peut spécifier `ownerType = 'Sublymus'`

---

### 3. **Installer une zone Sublymus** (Company uniquement)

```http
POST /v1/zones/{zone_id}/install
Authorization: Bearer {token}
```

> **Pourquoi installer ?** Les entreprises copient une zone Sublymus pour la personnaliser (nom, couleur, ajuster la géométrie). Les drivers IDEP référencent directement (pas de copie).

**Response: 201 Created**
```json
{
  "message": "Zone installed successfully",
  "zone": {
    "id": "zn_fmuj1qx6q1yq1xz5kp",
    "ownerType": "Company",
    "ownerId": "cmp_f1a3k28sfvv162hdbs",
    "name": "San-Pédro Port",
    "color": "#0ea5e9",
    "sector": "SAN_PEDRO",
    "type": "circle",
    "geometry": {
      "center": { "lat": 4.75, "lng": -6.64 },
      "radiusKm": 6
    },
    "isActive": true,
    "sourceZoneId": "zn_6sjdngi6m4t328jm5j"
  },
  "sourceZone": {
    "id": "zn_6sjdngi6m4t328jm5j",
    "ownerType": "Sublymus",
    "name": "San-Pédro Port"
  }
}
```

**Erreurs possibles** :
- `404` : Zone Sublymus non trouvée
- `400` : Zone déjà installée

---

### 4. **Définir la zone active (Mode ETP)**

```http
POST /v1/zones/{zone_id}/set-active-etp
Authorization: Bearer {token}
Content-Type: application/json

{
  "driverId": "usr_ed7m6vlytwbshl095r"
}
```

> Le **Manager** définit quelle zone Company est active pour un driver de sa flotte.

**Response: 200 OK**
```json
{
  "message": "Active zone set successfully",
  "companyDriverSetting": {
    "id": "cds_3ywljccxqqrlgea9fu",
    "companyId": "cmp_f1a3k28sfvv162hdbs",
    "driverId": "usr_ed7m6vlytwbshl095r",
    "status": "ACCEPTED",
    "activeZoneId": "zn_pxt84fm96o2548i6ak"
  }
}
```

**Vérifications** :
- Zone doit être `ownerType = 'Company'` et appartenir à la company
- Driver doit avoir `status = 'ACCEPTED'` dans CompanyDriverSetting

---

### 5. **Retirer la zone active (Mode ETP)**

```http
POST /v1/zones/clear-active-etp
Authorization: Bearer {token}
Content-Type: application/json

{
  "driverId": "usr_ed7m6vlytwbshl095r"
}
```

**Response: 200 OK**
```json
{
  "message": "Active zone cleared"
}
```

---

### 6. **Définir la zone active (Mode IDEP)**

```http
POST /v1/zones/{zone_id}/set-active-idep
Authorization: Bearer {token}
```

> Le **Driver** définit sa propre zone active pour recevoir des commandes en mode indépendant.

**Zones acceptées** :
- Ses propres zones (`ownerType = 'User'`, `ownerId = user.id`)
- Zones Sublymus (`ownerType = 'Sublymus'`) - **référence directe, pas de copie**

**Response: 200 OK**
```json
{
  "message": "Active IDEP zone set successfully",
  "driverSetting": {
    "id": "ds_h1kvp0m4f54qa81q7x",
    "userId": "usr_ed7m6vlytwbshl095r",
    "activeZoneId": "zn_1xphwzh2t92jyr32jr",
    "status": "ONLINE"
  }
}
```

---

### 7. **Retirer la zone active (Mode IDEP)**

```http
POST /v1/zones/clear-active-idep
Authorization: Bearer {token}
```

---

### 8. **Obtenir les drivers actifs d'une zone**

```http
GET /v1/zones/{zone_id}/drivers
Authorization: Bearer {token}
```

**Response: 200 OK**
```json
{
  "zone": {
    "id": "zn_1xphwzh2t92jyr32jr",
    "name": "Abidjan Métropole",
    "ownerType": "Sublymus"
  },
  "activeDrivers": [
    {
      "id": "usr_ed7m6vlytwbshl095r",
      "fullName": "Kofi Mensah",
      "phone": "+2250700000101",
      "email": "driver1.fast@delivery.ci"
    }
  ],
  "count": 1
}
```

**Logique `getActiveDrivers()`** :
- Zone Company → Cherche dans `CompanyDriverSetting.activeZoneId`
- Zone User/Sublymus → Cherche dans `DriverSetting.activeZoneId`

---

### 9. **Modifier une zone**

```http
PATCH /v1/zones/{zone_id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Zone Centre-Ville Étendue",
  "geometry": {
    "radiusKm": 7.0
  }
}
```

> Le merge de `geometry` est **récursif** : modifier `radiusKm` sans re-spécifier `center`.

---

### 10. **Supprimer une zone**

```http
DELETE /v1/zones/{zone_id}
Authorization: Bearer {token}
```

**Response: 204 No Content**

---

## ⚙️ Règles Métier

### 1. **Approche Hybride IDEP/ETP**

| Contexte | Zone Sublymus | Action |
|----------|---------------|--------|
| **Company (ETP)** | Installe (copie) | Crée une zone Company avec `sourceZoneId` |
| **Driver (IDEP)** | Référence directe | pointe `activeZoneId` vers la zone Sublymus |

**Avantages** :
- ✅ Companies peuvent personnaliser leurs zones
- ✅ IDEP n'a pas de duplication de données
- ✅ Sublymus peut mettre à jour les zones globales

### 2. **Une seule zone active par mode**

- Un driver peut avoir :
  - **1 zone active ETP** par entreprise (dans `CompanyDriverSetting.activeZoneId`)
  - **1 zone active IDEP** globale (dans `DriverSetting.activeZoneId`)

### 3. **Propriété et Permissions**

| Action | Admin | Manager | Driver |
|--------|-------|---------|--------|
| Voir zones Sublymus | ✅ | ✅ | ✅ |
| Créer zone Sublymus | ✅ | ❌ | ❌ |
| Créer zone Company | ✅ | ✅ | ❌ |
| Créer zone User | ✅ | ❌ | ✅ (soi-même) |
| Installer Sublymus → Company | ✅ | ✅ | ❌ |
| Set active zone ETP | ❌ | ✅ | ❌ |
| Set active zone IDEP | ❌ | ❌ | ✅ |

### 4. **Types de Géométrie**

**Circle (Cercle)** :
```json
{
  "center": { "lat": 5.36, "lng": -4.00 },
  "radiusKm": 5.0
}
```

**Polygon (Polygone)** :
```json
{
  "paths": [
    { "lat": 5.35, "lng": -3.98 },
    { "lat": 5.36, "lng": -3.97 },
    { "lat": 5.35, "lng": -3.96 }
  ]
}
```

**Rectangle** :
```json
{
  "bounds": {
    "north": 5.33,
    "south": 5.31,
    "east": -4.00,
    "west": -4.02
  }
}
```

---

## 🌍 Zones Sublymus Prédéfinies

| ID | Nom | Secteur | Rayon |
|----|-----|---------|-------|
| `zn_sub_abidjan` | Abidjan Métropole | ABIDJAN | 20 km |
| `zn_sub_abidjan_centre` | Abidjan Centre (Plateau, Cocody) | ABIDJAN | 6 km |
| `zn_sub_abidjan_sud` | Abidjan Sud (Treichville, Marcory) | ABIDJAN | 5 km |
| `zn_sub_abidjan_nord` | Abidjan Nord (Abobo, Anyama) | ABIDJAN | 7 km |
| `zn_sub_abidjan_ouest` | Abidjan Ouest (Yopougon) | ABIDJAN | 8 km |
| `zn_sub_yamoussoukro` | Yamoussoukro Centre | YAMOUSSOUKRO | 10 km |
| `zn_sub_bouake` | Bouaké Centre | BOUAKE | 8 km |
| `zn_sub_san_pedro` | San-Pédro Port | SAN_PEDRO | 6 km |
| `zn_sub_korhogo` | Korhogo Centre | KORHOGO | 5 km |
| `zn_sub_daloa` | Daloa Centre | DALOA | 5 km |

---

## 🧪 Cas d'Usage Détaillés

### Cas 1 : Entreprise installe une zone Sublymus

1. Manager accède à la liste des zones
2. Voit les zones Sublymus disponibles (ex: "San-Pédro Port")
3. Clique "Installer"
4. `POST /zones/{id}/install`
5. Zone copiée avec `sourceZoneId` → peut la personnaliser
6. Renomme en "San-Pédro - FastDelivery"
7. Assigne des drivers via `set-active-etp`

### Cas 2 : Driver IDEP active une zone Sublymus

1. Driver ouvre l'app en mode IDEP
2. Va dans "Choisir ma zone"
3. Voit ses zones perso + zones Sublymus
4. Sélectionne "Abidjan Métropole"
5. `POST /zones/{id}/set-active-idep`
6. `activeZoneId` pointe directement vers la zone Sublymus
7. Reçoit les commandes dans cette zone

### Cas 3 : Manager assigne un driver à une zone Company

1. Manager ouvre le dashboard
2. Sélectionne une zone Company "Cocody Centre"
3. Clique "Assigner driver"
4. Sélectionne "Kofi Mensah" (status: ACCEPTED)
5. `POST /zones/{id}/set-active-etp` avec `driverId`
6. `CompanyDriverSetting.activeZoneId` mis à jour
7. Driver voit sa zone active dans l'app

### Cas 4 : Voir les drivers actifs d'une zone

1. Admin veut voir qui travaille dans "Abidjan Métropole"
2. `GET /zones/{id}/drivers`
3. Retourne la liste des IDEP qui ont cette zone active
4. Pour une zone Company → retourne les drivers ETP

---

## 📱 Implémentation Mobile (Flutter)

### États à Gérer

```dart
enum ZoneOwnerType { company, user, sublymus }
enum ZoneType { circle, polygon, rectangle }

class Zone {
  String id;
  ZoneOwnerType ownerType;
  String? ownerId;
  String? sourceZoneId;  // Si installée depuis Sublymus
  String name;
  String color;
  String? sector;
  ZoneType type;
  Map<String, dynamic> geometry;
  bool isActive;
}

class DriverState {
  // Mode IDEP
  String? activeIdepZoneId;  // Depuis DriverSetting.activeZoneId
  
  // Mode ETP (par entreprise)
  Map<String, String?> activeEtpZoneIds;  // companyId -> zoneId
}
```

### Permissions

```dart
bool canEditZone(Zone zone, User user) {
  // Admin peut tout éditer
  if (user.isAdmin) return true;
  
  // Driver peut éditer ses propres zones
  if (zone.ownerType == ZoneOwnerType.user && zone.ownerId == user.id) {
    return true;
  }
  
  // Manager peut éditer les zones de sa company
  if (zone.ownerType == ZoneOwnerType.company && 
      zone.ownerId == user.currentCompanyManaged) {
    return true;
  }
  
  return false;
}

bool canSetActiveZone(Zone zone, User user, {bool isIdepMode = true}) {
  if (isIdepMode) {
    // IDEP peut activer ses zones OU zones Sublymus
    return (zone.ownerType == ZoneOwnerType.user && zone.ownerId == user.id) ||
           zone.ownerType == ZoneOwnerType.sublymus;
  } else {
    // Seul le Manager peut activer pour ETP
    return false; // Le driver ne fait pas ça lui-même
  }
}
```

---

## 🔍 Algorithme de Dispatch

```typescript
// Trouver les drivers éligibles pour une commande
function findEligibleDrivers(order: Order): Driver[] {
  const eligibleDrivers: Driver[] = [];
  const pickupPoint = order.pickupAddress;
  
  // Pour commandes ETP (internes à une entreprise)
  if (order.type === 'INTERNAL') {
    // Trouver les CDS avec activeZoneId correspondant
    const cdsList = await CompanyDriverSetting.query()
      .where('companyId', order.companyId)
      .whereNotNull('activeZoneId')
      .preload('activeZone')
      .preload('driver');
    
    for (const cds of cdsList) {
      if (cds.activeZone.isActive && isPointInZone(pickupPoint, cds.activeZone)) {
        eligibleDrivers.push(cds.driver);
      }
    }
  }
  
  // Pour commandes IDEP (globales)
  if (order.type === 'GLOBAL') {
    const driverSettings = await DriverSetting.query()
      .whereNotNull('activeZoneId')
      .preload('activeZone')
      .preload('user');
    
    for (const ds of driverSettings) {
      if (ds.activeZone.isActive && isPointInZone(pickupPoint, ds.activeZone)) {
        eligibleDrivers.push(ds.user);
      }
    }
  }
  
  return eligibleDrivers;
}
```

---

## � Notes d'Implémentation Mobile (Recommandations)

### 🎯 Architecture Recommandée

```
┌─────────────────────────────────────────────────────────────┐
│                    COUCHE PRÉSENTATION                      │
├─────────────────────────────────────────────────────────────┤
│  ZonesListScreen     ZoneMapScreen     ZoneDetailScreen     │
│  (liste zones)       (carte interactive)  (détails/edit)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    COUCHE ÉTAT (Provider/Riverpod)          │
├─────────────────────────────────────────────────────────────┤
│  ZonesProvider              ActiveZoneProvider              │
│  - zones: List<Zone>        - activeIdepZone: Zone?         │
│  - isLoading: bool          - activeEtpZone: Zone?          │
│  - fetchZones()             - setActiveZone()               │
│  - installZone()            - clearActiveZone()             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    COUCHE SERVICE                           │
├─────────────────────────────────────────────────────────────┤
│  ZonesService                                               │
│  - getZones()               - setActiveZoneETP()            │
│  - createZone()             - setActiveZoneIDEP()           │
│  - updateZone()             - clearActiveZone()             │
│  - deleteZone()             - getActiveDrivers()            │
│  - installFromSublymus()                                    │
└─────────────────────────────────────────────────────────────┘
```

### 🔄 Flux d'Écrans Recommandés

#### Pour le Driver (App Driver)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Accueil    │────▶│  Mes Zones   │────▶│ Choisir Zone │
│   Driver     │     │   (Liste)    │     │   Active     │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                    │
                            ▼                    ▼
                     ┌──────────────┐     ┌──────────────┐
                     │ Créer Zone   │     │  Carte avec  │
                     │ Personnelle  │     │ zones dispo  │
                     └──────────────┘     └──────────────┘
```

**Écrans clés** :
1. **Liste "Mes Zones"** : Affiche zones perso + zones Sublymus disponibles
2. **Carte choix zone** : Visualiser les zones avant activation
3. **Création zone** : Outils de dessin (cercle, polygone)
4. **Zone active** : Badge/indicateur visible sur l'accueil

#### Pour le Manager (Dashboard Web/App)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Dashboard   │────▶│    Zones     │────▶│ Assigner     │
│   Company    │     │   Company    │     │   Drivers    │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                    
                            ▼                    
                     ┌──────────────┐     
                     │  Installer   │     
                     │  Sublymus    │     
                     └──────────────┘     
```

### 💾 Gestion du Cache Local

```dart
// Recommandation : Cacher les zones localement
class ZonesCache {
  static const Duration cacheValidity = Duration(hours: 1);
  
  Future<List<Zone>> getZones() async {
    // 1. Vérifier cache local
    final cached = await _localDb.getZones();
    if (cached.isNotEmpty && !_isCacheExpired()) {
      return cached;
    }
    
    // 2. Sinon, appel API
    final zones = await _api.getZones();
    await _localDb.saveZones(zones);
    return zones;
  }
  
  // Forcer refresh après modifications
  Future<void> invalidateCache() async {
    await _localDb.clearZones();
  }
}
```

### 🗺️ Affichage sur Google Maps

```dart
// Recommandation : Composant réutilisable pour afficher les zones
class ZoneOverlay extends StatelessWidget {
  final Zone zone;
  final bool isActive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final opacity = zone.isActive ? 0.3 : 0.1;
    final strokeWidth = isActive ? 4.0 : 2.0;
    
    switch (zone.type) {
      case ZoneType.circle:
        return CircleMarker(
          center: zone.geometry.center!,
          radius: zone.geometry.radiusKm! * 1000,
          color: Color(int.parse(zone.color.replaceFirst('#', '0xFF'))),
          fillOpacity: opacity,
          strokeColor: isActive ? Colors.white : null,
          strokeWidth: strokeWidth,
          onTap: onTap,
        );
        
      case ZoneType.polygon:
        return PolygonMarker(
          points: zone.geometry.paths!,
          color: Color(int.parse(zone.color.replaceFirst('#', '0xFF'))),
          fillOpacity: opacity,
          strokeWidth: strokeWidth,
          onTap: onTap,
        );
        
      case ZoneType.rectangle:
        return RectangleMarker(
          bounds: zone.geometry.bounds!,
          color: Color(int.parse(zone.color.replaceFirst('#', '0xFF'))),
          fillOpacity: opacity,
          strokeWidth: strokeWidth,
          onTap: onTap,
        );
    }
  }
}
```

### 🎨 UX Recommandations

| Élément | Recommandation |
|---------|----------------|
| **Zone active** | Badge coloré sur l'accueil + barre de status |
| **Zones Sublymus** | Icône distinctive (🌍 ou logo Sublymus) |
| **Zone installée** | Indiquer "depuis Sublymus" si `sourceZoneId != null` |
| **Création zone** | Mode plein écran avec carte centrée sur position |
| **Choix couleur** | Palette prédéfinie (10-15 couleurs harmonieuses) |
| **Désactivation** | Confirmation modale + explication impact |

### 🔔 Notifications Recommandées

```dart
// Déclencher notifications locales pour :
enum ZoneNotification {
  zoneActivated,      // "Vous êtes maintenant actif dans {zoneName}"
  zoneDeactivated,    // "Zone désactivée. Vous ne recevrez plus de commandes."
  newZoneAvailable,   // "Nouvelle zone Sublymus disponible : {zoneName}"
  zoneUpdated,        // "La zone {zoneName} a été modifiée"
}
```

### 📊 États UI à Implémenter

```dart
enum ZoneScreenState {
  loading,           // Chargement des zones
  empty,             // Aucune zone disponible
  loaded,            // Zones chargées
  error,             // Erreur de chargement
}

enum ZoneActionState {
  idle,              // Pas d'action en cours
  activating,        // Activation en cours
  creating,          // Création en cours
  installing,        // Installation Sublymus en cours
}
```

### ⚠️ Cas d'Erreurs à Gérer

| Erreur API | Message utilisateur |
|------------|---------------------|
| `Zone not found` | "Cette zone n'existe plus. Actualisez la liste." |
| `Driver does not belong to your company` | "Ce chauffeur n'appartient pas à votre entreprise." |
| `Zone already installed` | "Cette zone est déjà installée dans votre flotte." |
| `Only drivers can set IDEP active zone` | Rediriger vers connexion driver |
| `Company context required` | "Sélectionnez une entreprise pour continuer." |

### 🔄 Synchronisation Temps Réel

```dart
// Recommandation : Écouter les changements via WebSocket/Socket.io
class ZonesSyncService {
  void listen() {
    socket.on('zone:updated', (data) {
      // Mettre à jour la zone dans le cache
      zonesProvider.updateZone(Zone.fromJson(data));
    });
    
    socket.on('zone:deleted', (data) {
      // Retirer la zone du cache
      zonesProvider.removeZone(data['id']);
      
      // Si c'était la zone active, notifier l'utilisateur
      if (activeZoneProvider.activeZoneId == data['id']) {
        activeZoneProvider.clearActiveZone();
        NotificationService.show("Votre zone active a été supprimée");
      }
    });
    
    socket.on('driver:zone_changed', (data) {
      // Pour les managers : un driver a changé de zone
      driversProvider.updateDriverZone(data['driverId'], data['zoneId']);
    });
  }
}
```

---

## �📡 Routes API Résumé

| Méthode | Endpoint | Description | Rôle |
|---------|----------|-------------|------|
| GET | `/v1/zones` | Lister les zones | Tous |
| POST | `/v1/zones` | Créer une zone | Manager, Driver |
| GET | `/v1/zones/:id` | Voir une zone | Tous |
| PATCH | `/v1/zones/:id` | Modifier une zone | Owner |
| DELETE | `/v1/zones/:id` | Supprimer une zone | Owner |
| GET | `/v1/zones/:id/drivers` | Drivers actifs | Tous |
| POST | `/v1/zones/:id/install` | Installer zone Sublymus | Manager |
| POST | `/v1/zones/:id/set-active-etp` | Activer pour driver ETP | Manager |
| POST | `/v1/zones/clear-active-etp` | Désactiver pour driver ETP | Manager |
| POST | `/v1/zones/:id/set-active-idep` | Activer zone IDEP | Driver |
| POST | `/v1/zones/clear-active-idep` | Désactiver zone IDEP | Driver |

---

**Dernière mise à jour** : 2026-01-19

