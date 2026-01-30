# Scenario G.5: L'Échange / Retour (Reverse Logistics)

## Concept
Effectuer une livraison et une collecte simultanément à la même adresse.

## Cas d'Usage
- **Échange Standard** : Livraison d'un nouveau téléphone et récupération de l'ancien pour réparation.
- **Contenants Consignés** : Livraison de bouteilles pleines et récupération des bouteilles vides.

## Structure VROOM (Cas G)
- **Shipments** : 2 Shipments sur le même arrêt.
  - S1: {P1 -> L1} (Livraison)
  - S2: {L1 -> P2} (Retour vers entrepôt)

## Comportement Attendu
- VROOM identifie que les deux tâches ont la même coordonnée GPS.
- Il fusionne l'arrêt pour le chauffeur.
- Le chauffeur voit deux actions à effectuer : "Remettre Colis A" et "Récupérer Colis B".

## Avantages Logistiques
- Gain de temps énorme (pas de deuxième trajet).
- Gestion simplifiée des retours client (e-commerce).
