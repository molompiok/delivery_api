# Documentation Technique: Shift Management & Ingestion GPS

## 🧱 Architecture Technique

Le système repose sur une séparation claire entre les données **froides** (SQL) et les données **chaudes** (Redis).

### 1. Redis: La Source de Vérité "Hot"
Chaque chauffeur possède un snapshot de son état actuel dans Redis pour permettre un dispatching ultra-performant.

**Clé Redis** : `sublymus:driver:{userId}:state`
**Structure** :
```json
{
  "id": "usr_xxx",
  "mode": "ETP",            // IDEP, ETP, IDEP_TO_ETP, ETP_TO_IDEP
  "status": "ONLINE",      // ONLINE, OFFLINE, BUSY, PAUSE
  "last_lat": 5.341,
  "last_lng": -4.012,
  "active_company_id": "cmp_xxx",
  "active_zone_id": "zon_xxx",
  "active_vehicle_id": "vhc_xxx",
  "updated_at": "ISO-TIMESTAMP"
}
```

### 1.1 Contexte Dynamique (Mirroring)
Lors de la synchronisation SQL ➔ Redis (`syncDriverToRedis`), le système calcule dynamiquement le contexte du chauffeur. C'est une subtilité clé :

- **Si Mode = ETP** :
    - `active_zone_id` ➔ Pris depuis `CompanyDriverSetting` (la zone assignée par l'entreprise).
    - `active_vehicle_id` ➔ Pris depuis `CompanyDriverSetting`.
- **Si Mode = IDEP** :
    - `active_zone_id` ➔ Pris depuis `DriverSetting` (la zone de préférence du chauffeur).
    - `active_vehicle_id` ➔ Pris depuis `DriverSetting`.

**Pourquoi ?** Un chauffeur peut utiliser son propre vélo le week-end (IDEP) mais doit utiliser la camionnette de l'entreprise le lundi matin (ETP). Redis contient toujours la "vérité de l'instant" pour le dispatch.

---

## 🏎️ Ingestion GPS & Buffering SQL

Pour supporter des milliers de pings GPS sans écraser la base PostgreSQL, nous utilisons un mécanisme de **Buffering**.

### Flux d'ingestion (REST)
1. Le mobile appelle `POST /v1/driver/location`.
2. Le `TrackingService` :
   - Met à jour le snapshot Redis (`last_lat`, `last_lng`).
   - Met à jour l'index géospatial Redis (`GEOADD sublymus:drivers:locations`).
   - Ajoute le ping dans une liste Redis `sublymus:location:buffer`.

### Flush vers SQL
Le flush vers la base de données est déclenché par deux conditions :
1. **Seuil de quantité** : Atteinte de 50 pings dans le buffer.
2. **Seuil temporel** : Forçage toutes les minutes par le `ShiftCheck` (même si < 50 pings).

**Processus de Flush** :
- Acquisition d'un lock Redis `location_flush`.
- Lecture du batch via `LRANGE`.
- **Sync SQL** : Mise à jour en masse des modèles `DriverSetting`.
- Nettoyage du buffer via `LTRIM`.

---

## 🛠️ Workers & Queues (BullMQ)

Deux queues distinctes gèrent l'asynchronisme :

### 1. `shift-checks`
- **Fréquence** : 1 minute.
- **Rôle** : Parcourt tous les chauffeurs, résout les horaires (`ScheduleService`) et initie les bascules de mode.
- **Idempotence** : Chaque job porte un ID basé sur le timestamp (`check-yyyy-MM-dd-HH-mm`) pour éviter les exécutions en double.

### 2. `location-flush`
- **Rôle** : Insère les positions GPS accumulées en base de données.
- **Concurrency** : 1 (pour éviter les conflits d'écriture SQL sur le même chauffeur).

---

## 🔄 Machine à États (WorkMode)

Les transitions garantissent la continuité des missions :

- **IDEP ➔ IDEP_TO_ETP** : Le shift commence, mais une mission est en cours.
- **ETP ➔ ETP_TO_IDEP** : Le shift finit, mais le chauffeur livre encore pour l'entreprise.
- **IDEP_TO_ETP ➔ ETP** : Bascule automatique détectée par le worker dès que `order_count === 0`.

---

## 🛑 Mécanismes de Verrouillage (Locking)

Pour éviter les "Race Conditions" (conflits d'accès simultanés), nous utilisons `Redis.set(key, val, 'NX')` :

1. **Assignation de mission** : Verrou sur `lock:driver:{id}` pendant l'assignation.
2. **Flush GPS** : Verrou `lock:location_flush` pour qu'un seul worker ne vide la liste à la fois.
3. **Bascule de mode** : Utilisation de transactions ou de vérifications atomiques pour s'assurer que le mode ne change pas entre le moment où on lit la mission et celui où on écrit le mode.

---

## 📈 Scalabilité & Monitoring

### Warm-Up (Démarrage)
Au boot du serveur (`start/init.ts`), tous les drivers SQL sont scannés et leurs snapshots Redis sont recréés. Cela garantit qu'après un redémarrage, le cache n'est pas vide.

### Monitoring Redis
Commandes utiles pour surveiller la santé du système :
- `LLEN sublymus:location:buffer` : Taille de la file d'attente GPS.
- `GEORADIUS sublymus:drivers:locations {lng} {lat} 5 km` : Tester le dispatch.
- `KEYS sublymus:lock:*` : Voir les verrous actifs.

---

## ⚠️ Subtilités & Limitations

1. **Batterie Mobile** : L'app mobile doit réduire la fréquence des pings si le chauffeur est immobile (logiciel client).
2. **TTL des Verrous** : Les verrous ont une durée de vie (TTL) par défaut de 5s pour éviter les blocages infinis en cas de crash du worker.
3. **Ghost Drivers** : Si un driver coupe son app sans se déconnecter, son snapshot reste "ONLINE". Un processus de "Heartbeat" (non encore implémenté) devra périodiquement passer en `OFFLINE` les drivers sans pings GPS depuis > 5 min.
