# Étape 08 : Modifications Temps Réel (Shadows)

[⬅️ Retour à l'index](./index.md)

Le mécanisme de **Shadow Components** (Draft-in-Place) permet de modifier une commande déjà acceptée ou en cours sans interférer avec l'affichage du Driver jusqu'à validation finale.

## Logique de Fonctionnement

### 1. Édition (Context: EDIT)
Le client modifie un arrêt ou une action via le Dashboard.
- Le serveur vérifie si la commande est en `DRAFT`.
- Si non, il crée une copie (clone) de l'entité avec `is_pending_change = true`.
- L'entité originale reste inchangée.
- `LogisticsService` valide la cohérence de l'état "virtuel" (Originals + Shadows).

### 2. Vue Différenciée
`OrderDraftService.buildVirtualState` génère deux versions de la commande :
- **CLIENT** : Affiche les `shadows` à la place des `originals` correspondants. Masque les éléments marqués `is_delete_required`.
- **DRIVER** : Affiche uniquement les éléments stables (`is_pending_change = false`). Ignore `is_delete_required` pour ne pas supprimer un arrêt sur lequel le chauffeur est peut-être déjà en train de rouler.

### 3. Validation de Viabilité
À chaque modification, le système simule le flux d'inventaire :
- **Règle d'Or** : `(Stock de départ au Step + Collectes du Step) >= Livraisons du Step`.
- On ne peut pas planifier une livraison si l'item n'est pas déjà dans le véhicule ou collecté durant le même trajet (Step).

### 4. Application (Push Updates)
`POST /v1/orders/:id/push-updates` :
1. Valide l'état final cible (Contrainte items + itinéraire).
2. Fusionne les données des `shadows` dans les `originals`.
3. Supprime physiquement les éléments originaux marqués `is_delete_required`.
4. Recalcule l'itinéraire (VROOM) et la tarification.
5. Met à jour les `OrderLegs` (géométrie du trajet).
6. Notifie le chauffeur du changement de route via WebSocket.

## Points de Vigilance
- **Liaison des enfants** : Lors de la suppression d'un stop "shadow" après fusion, ses actions doivent être rattachées au stop "original" correctement.
- **Adresse isolation** : Chaque stop (original ou shadow) possède son propre record d'adresse pour éviter que la modification d'un clone n'impacte l'adresse de l'original prématurément.
- **Statut Driver** : On ne peut pas modifier un Step déjà `EXECUTED` ou `IN_PROGRESS`.
