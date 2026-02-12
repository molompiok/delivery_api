# OR-Tools — Cycle de Vie & Ré-optimisation

## 1. Gel des États (Freezing)
Lorsqu'un ordre est en cours d'exécution :
*   Les stops `COMPLETED` ou `ARRIVED` sont des **faits établis**.
*   OR-Tools ne re-optimise que les stops `PENDING`.

## 2. Modification par le Manager (Live)
Si le manager ajoute un stop à une commande `ACCEPTED` :
1.  L'état virtuel est mis à jour.
2.  `OrToolsService` est appelé avec la position actuelle du chauffeur (StartLocation).
3.  La route est recalculée pour les stops restants.

## 3. Driver Next Stop (Choix du chauffeur)

Le chauffeur peut **choisir son prochain stop** indépendamment de la suggestion OR-Tools.

### Flux :
1.  Le chauffeur voit la liste des stops `PENDING` triée par `executionOrder` (suggestion OR-Tools).
2.  Il peut cliquer sur **n'importe quel stop** pour le définir comme sa prochaine destination.
3.  L'app appelle une **route HTTP dédiée** :
    ```
    POST /orders/:orderId/driver/next-stop
    Body: { "stop_id": "stp_abc" }
    ```
4.  Le backend :
    *   Calcule l'itinéraire Valhalla vers ce stop pour afficher le tracé GPS.
    *   Optionnellement, relance OR-Tools pour ré-optimiser les stops restants *après* celui choisi.
5.  Le chauffeur voit son itinéraire et peut naviguer.

> **Note** : Le choix du chauffeur n'empêche jamais l'exécution. OR-Tools *suggère*, le chauffeur *décide*.

## 4. Gel et Dégel (Hold/Resume)

### Gel (Hold)
Mettre un stop en attente (ex: client absent, problème d'accès).
*   Le stop gelé passe en `FROZEN`.
*   **Impact cascade** : Si ce stop contenait un **pickup** nécessaire pour un **delivery** ultérieur, OR-Tools doit :
    1.  Détecter la dépendance (le delivery dépend de la collecte gelée).
    2.  **Geler automatiquement** le delivery dépendant (ou le marquer `BLOCKED`).
    3.  Notifier le manager : "Stop X gelé → livraison Y impossible tant que X n'est pas dégelé".

### Dégel (Resume)
*   Le stop repasse en `PENDING`.
*   OR-Tools recalcule la route en incluant ce stop et ses dépendants.
*   Les stops `BLOCKED` qui dépendaient de celui-ci repassent en `PENDING`.

---
[⬅ Retour à l'Index](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/INDEX.md)
