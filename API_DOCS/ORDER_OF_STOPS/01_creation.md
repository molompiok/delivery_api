# Étape 01 : Création & Validation des Commandes

[⬅️ Retour à l'index](./index.md)

Cette étape concerne la réception des commandes via l'API et leur persistance initiale.

## Aspects Techniques
- **Refonte des Validators (VineJS)** :
    - Remplacer `waypoints` par une structure `steps[] -> stops[] -> actions[]`.
    - Ajouter `transit_item_id` et `quantity` sur chaque action.
    - Déclinaison du type d'action : `PICKUP` (+), `DELIVERY` (-), `SERVICE` (.).
    - Ajout de la liste `transit_items` au niveau racine de la commande.
- **Refonte de `OrderService.createOrder`** :
    - Instanciation des `Steps` et `Stops` au lieu des simples adresses.
    - Création des `TransitItems` et liaison optionnelle aux `Products` (Company only).
    - Création des `Actions` liées aux `Stops` et `TransitItems`.
    - Calcul de la charge initiale et dynamique du véhicule.
- **Suppression du Legacy** :
    - Retrait de `createComplexOrder` (fusionnée dans la logique universelle).
    - Nettoyage des appels à `Task`, `Shipment`, `Job` et `Package`.

## Validation
- [ ] **Test API 01** : Création d'une commande unitaire (A+ -> B-).
- [ ] **Test API 02** : Création d'une commande fluide (Citerne : A+1000L, B-500L, C-500L).
- [ ] **Test API 03** : Création d'une commande complexe avec Multi-actions au même stop.
- [ ] **Test DB** : Vérification de l'intégrité référentielle (TransitItem <-> Action).
- [ ] **Test Validation** : Rejet si `delivery` (-) est tenté sans `pickup` (+) préalable du même `transit_item_id`.
