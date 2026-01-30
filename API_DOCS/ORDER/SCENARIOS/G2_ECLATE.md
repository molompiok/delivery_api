# Scenario G.2: Le "Éclaté" (One-to-Many)

## Concept
Une seule source de collecte (Pickup) pour plusieurs points de livraison (Deliveries) distincts.

## Cas d'Usage
- **Livraison Marchand** : Une boulangerie (C1) livre 10 restaurants (L1...L10).
- **Distribution de Courrier** : Un centre de tri qui dispatch le courrier vers plusieurs adresses.

## Structure VROOM (Cas G)
- **Shipments** : N Shipments.
  - S1: {C1 -> L1}
  - S2: {C1 -> L2}
  - ...
  - Sn: {C1 -> Ln}

## Comportement Attendu
- Le chauffeur charge tout au point C1.
- VROOM calcule l'ordre optimal pour "décharger" les colis un par un.
- La capacité du véhicule décroît à chaque arrêt de livraison.

## Avantages Logistiques
- Optimisation maximale de la tournée de distribution (VRP classique).
- Une seule interaction de chargement pour le marchand (gagnant en temps de service).
