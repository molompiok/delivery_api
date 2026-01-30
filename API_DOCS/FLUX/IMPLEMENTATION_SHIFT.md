# Flux: Bascule Automatique IDEP ↔ ETP (Implémentation)

## 📋 Vue d'ensemble

Ce système gère la bascule automatique des chauffeurs entre le mode **IDEP** (indépendant) et **ETP** (entreprise) en fonction de leurs horaires de travail assignés.

---

## 🔄 États du Système (WorkMode)

Le chauffeur peut être dans l'un des 4 états suivants :

| État | Description | Peut recevoir missions ? |
|------|-------------|-------------------------|
| `IDEP` | Mode indépendant actif | ✅ Oui |
| `ETP` | Mode entreprise actif | ✅ Oui |
| `IDEP_TO_ETP` | Shift ETP commence, mission IDEP en cours | ❌ Non (en transition) |
| `ETP_TO_IDEP` | Shift ETP terminé, mission ETP en cours | ❌ Non (en transition) |

**Les états de transition empêchent** l'attribution de nouvelles missions pendant qu'une livraison se termine.

---

## 🏗️ Architecture Implémentée

### 1. Modèle de Données

**`DriverSetting.currentMode`** : Champ qui stocke l'état actuel du chauffeur.

```typescript
enum WorkMode {
    IDEP = 'IDEP',
    ETP = 'ETP',
    IDEP_TO_ETP = 'IDEP_TO_ETP',
    ETP_TO_IDEP = 'ETP_TO_IDEP',
}
```

### 2. Services

#### **ShiftService** (`app/services/shift_service.ts`)
Contient toute la logique de vérification et de bascule :
- `checkAndSwitchAllDrivers()` : Vérifie tous les drivers
- `checkAndSwitchDriver()` : Logique pour un driver spécifique
- `switchToETP()` / `switchToIDEP()` : Gestion des transitions
- `handleTransition()` : Finalise les bascules en attente
- `hasActiveETPShift()` : Vérifie si un shift ETP est actif maintenant
- `hasActiveMission()` : Vérifie si une mission est en cours (à brancher sur Order)

#### **NotificationService** (`app/services/notification_service.ts`)
Service provisoire pour alerter les chauffeurs :
- Envoie des messages via SMS (provisoire)
- Logs système
- **TODO** : Remplacer par Firebase Cloud Messaging (FCM)

### 3. Queue BullMQ

**Pourquoi BullMQ ?**
- Les jobs sont traités de manière asynchrone
- Retry automatique en cas d'erreur
- Idempotence garantie (pas de doublons)
- Monitoring intégré

**Configuration** (`app/queues/shift_queue.ts`) :
- **Queue** : `shift-checks`
- **Worker** : Traite les jobs un par un (concurrency: 1)
- **Redis** : Utilise Redis déjà présent dans Docker

### 4. Commandes Ace

#### `node ace shift:check`
Déclenche une vérification des shifts :
- Envoie un job dans la queue BullMQ
- **Idempotent** : peut être appelé plusieurs fois sans effet de bord
- Prévu pour être lancé par **cron toutes les minutes**

#### `node ace shift:worker`
Démarre le worker qui consomme les jobs :
- Tourne en continu
- Support du graceful shutdown (SIGINT/SIGTERM)
- À lancer avec PM2 en production

---

## 🔁 Flux de Bascule

### Cas 1 : Shift ETP commence (IDEP → ETP)

```
1. Cron lance `node ace shift:check` toutes les minutes
2. Job BullMQ créé et traité par le worker
3. ShiftService vérifie si un shift ETP est actif maintenant
4. Shift trouvé → Vérifier si mission en cours

   SI mission IDEP en cours :
   ├─ Passer en IDEP_TO_ETP (transition)
   ├─ Notification chauffeur : "Terminez votre mission"
   └─ ❌ Plus de nouvelles missions attribuées

   SI pas de mission :
   ├─ Passer en ETP immédiatement
   ├─ Notification chauffeur : "Shift commencé"
   └─ ✅ Peut recevoir missions ETP

5. Si en transition, à chaque vérification :
   ├─ Mission terminée ? → Finaliser la bascule vers ETP
   └─ Mission en cours ? → Attendre
```

### Cas 2 : Shift ETP se termine (ETP → IDEP)

```
1. ShiftService détecte que le shift ETP est fini
2. Vérifier si mission en cours

   SI mission ETP en cours :
   ├─ Passer en ETP_TO_IDEP (transition)
   ├─ Notification chauffeur : "Terminez votre mission"
   └─ ❌ Plus de nouvelles missions attribuées

   SI pas de mission :
   ├─ Passer en IDEP immédiatement
   ├─ Notification chauffeur : "Shift terminé"
   └─ ✅ Peut recevoir missions IDEP

3. Si en transition, à chaque vérification :
   ├─ Mission terminée ? → Finaliser la bascule vers IDEP
   └─ Mission en cours ? → Attendre
```

---

## 🚀 Déploiement

### En développement

```bash
# Terminal 1 : API
pnpm dev

# Terminal 2 : Worker BullMQ
node ace shift:worker
```

### En production

#### 1. Lancer le worker avec PM2

```bash
pm2 start "node ace shift:worker" --name shift-worker
pm2 save
```

#### 2. Configurer le cron

Ajouter dans le crontab du serveur :

```bash
# Vérifier les shifts toutes les minutes
* * * * * cd /path/to/delivery-api && node ace shift:check >> /var/log/shifts.log 2>&1
```

#### 3. Variables d'environnement

Ajouter dans `.env` :

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

## 📡 API Endpoints

### 1. Suivi GPS (Driver App)
`POST /v1/driver/location`
- **Body** : `{ lat: number, lng: number, heading?: number }`
- **Action** : Met à jour Redis instantanément et bufférise pour SQL.

### 2. Forçage de Mode (Manager Dashboard)
`POST /v1/company/drivers/:driverId/force-mode`
- **Body** : `{ mode: 'IDEP' | 'ETP' }`
- **Action** : Crée un `MANUAL_OVERRIDE` (priorité 200) et bascule le chauffeur immédiatement.

---

## 🔧 Points techniques spécifiques gérés

### 1. Buffering GPS (Scalabilité)
Le système ne fait plus un `UPDATE SQL` à chaque ping.
- Les pings sont stockés dans une liste Redis `sublymus:location:buffer`.
- Quand 50 pings sont accumulés, un job BullMQ `location-flush` est créé.
- Le worker vide le buffer en une seule fois vers la base de données.

### 2. Nettoyage Géospatial
Dès qu'un chauffeur passe en statut `OFFLINE` ou `PAUSE`, il est automatiquement retiré de l'index Redis (`sublymus:drivers:locations`) pour ne pas être sollicité par le dispatching.

### 3. Résolution des Conflits
Si deux changements interviennent en même temps :
- La priorité (`priority`) de l'horaire est le premier critère.
- La date de modification (`updatedAt`) est le second critère (le plus récent l'emporte).

---

## 🔧 Points à brancher ultérieurement

### 1. Modèle Order
Dans `shift_service.ts`, ligne 265 :
```typescript
private async hasActiveMission(userId: string): Promise<boolean> {
    // TODO: Implémenter quand Order sera disponible
    const Order = (await import('#models/order')).default
    const activeOrder = await Order.query()
        .where('driverId', userId)
        .whereIn('status', ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'])
        .first()
    return !!activeOrder
}
```

### 2. Notifications Push (FCM)
Dans `notification_service.ts`, ligne 95 :
```typescript
private async send(user: User, payload: NotificationPayload) {
    // TODO: Remplacer par Firebase Cloud Messaging
    await this.sendViaPush(user.fcmToken, payload)
}
```

### 3. Dispatch conditionnel
Dans le moteur de dispatch (à créer), vérifier :
```typescript
const driverSetting = await DriverSetting.find(driverId)

if (!canReceiveNewMissions(driverSetting.currentMode)) {
    // Driver en transition, ne pas attribuer de mission
    return
}

if (driverSetting.currentMode === WorkMode.IDEP) {
    // Utiliser DriverSetting.activeZoneId et activeVehicleId
} else if (driverSetting.currentMode === WorkMode.ETP) {
    // Utiliser CompanyDriverSetting.activeZoneId et activeVehicleId
}
```

---

## 📊 Monitoring

### Logs BullMQ

Les logs du worker affichent :
- Jobs traités avec succès
- Jobs en erreur (avec retry automatique)
- État actuel de la queue

### Vérifier Redis

```bash
# Se connecter à Redis
redis-cli

# Lister les jobs
KEYS bullmq:shift-checks:*

# Voir les jobs actifs
LRANGE bullmq:shift-checks:active 0 -1

# Voir les jobs complétés
LRANGE bullmq:shift-checks:completed 0 -1
```

---

## ✅ Checklist de mise en production

- [ ] Redis configuré et accessible
- [ ] Worker lancé avec PM2 et configuré pour redémarrer au boot
- [ ] Cron configuré pour lancer `shift:check` chaque minute
- [ ] Notifications SMS connectées (ou FCM implémenté)
- [ ] Modèle Order créé et méthode `hasActiveMission()` branchée
- [ ] Moteur de dispatch mis à jour pour vérifier `currentMode`
- [ ] Tests effectués sur la bascule avec différents scenarios
- [ ] Monitoring en place (logs, alertes Redis down, etc.)

---

**Dernière mise à jour** : 2026-01-19
