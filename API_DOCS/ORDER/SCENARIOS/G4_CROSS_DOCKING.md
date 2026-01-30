# Scenario G.4: Le "Cross-Docking" Virtuel (Hub & Spoke)

## Concept
Utiliser un point de transfert intermédiaire (Hub) pour séparer la collecte de la livraison finale, permettant d'optimiser les types de véhicules (ex: Camion pour la collecte, Motos pour le dernier kilomètre).

## Cas d'Usage
- **Massification** : Le Chauffeur A ramasse 50 colis et les dépose au Hub. Le système dispatch ensuite ces 50 colis à 5 Chauffeurs B (motos) pour la zone urbaine.

## Structure VROOM (Cas G)
- **Mission 1** (Driver A) : Shipments `{Pi -> Hub}`.
- **Mission 2** (Driver B) : Shipments `{Hub -> Di}`.

## Comportement Attendu
- Le système gère le Hub comme une destination de livraison pour A et un point de départ pour B.
- **Stock Virtuel** : Le colis change de "possésseur" au point Hub.

## Avantages Logistiques
- Spécialisation des flottes.
- Réduction de la fatigue des chauffeurs sur de longues distances.
