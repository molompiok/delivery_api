# OR-Tools — Mapping des Modèles

Comment transformer nos objets métier en variables d'optimisation.

## 1. Les Nœuds (Stops)
Chaque `Stop` Adonis devient un nœud dans le graphe de routing.
*   **Identifiant** : `stop.id`.
*   **Actions** : Chaque action est soit un `PICKUP` (+), soit un `DELIVERY` (-), soit un `SERVICE` (temps passé).

## 2. Les Dimensions (Commodities / Items)
C'est la grande force de OR-Tools par rapport à VROOM.
*   **Un TransitItem = Une Dimension**.
*   Chaque dimension suit son propre cumul de stock dans le véhicule.
*   **Contrainte de charge** : `Cumul(Item_A) <= Capacité_Compartiment`.

## 3. Pairing Pickup & Delivery
Pour chaque `TransitItem`, FlexVROOM/OR-Tools identifie les paires :
*   `Action(PICKUP, Item_X, Qty_5) @ Stop_A`
*   `Action(DELIVERY, Item_X, Qty_2) @ Stop_B`
*   `Action(DELIVERY, Item_X, Qty_3) @ Stop_C`
*   **Résultat** : Crée 2 contraintes de précédence (A avant B, A avant C).

## 4. Capacités Spécifiques
*   **Poids** : Dimension globale (somme des poids de tous les items).
*   **Volume** : Dimension globale (somme des volumes).
*   **Compartiments** : Plusieurs dimensions de type "Volume" isolées.

---
[⬅ Retour à l'Index](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/INDEX.md)
