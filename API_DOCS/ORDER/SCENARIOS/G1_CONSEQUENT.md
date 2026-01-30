# Scenario G.1: Le "Conséquent" (Many-to-One)

## Concept
Regrouper plusieurs collectes (Pickups) provenant de sources différentes pour une seule destination finale (Delivery).

## Cas d'Usage
- **Réception Groupée** : Un client commande un repas, du vin et des fleurs. 3 boutiques différentes (C1, C2, C3) vers 1 client (L1).
- **Consolidation** : Plusieurs agences envoient des documents vers le siège social.

## Structure VROOM (Cas G)
- **Shipments** : 3 Shipments.
  - S1: {C1 -> L1}
  - S2: {C2 -> L1}
  - S3: {C3 -> L1}

## Comportement Attendu
- Le chauffeur visite les 3 points de collecte dans l'ordre le plus efficace.
- La livraison L1 ne peut être effectuée qu'une fois que les 3 colis sont à bord.
- Si une collecte échoue (C2 fermé), la livraison L1 est "gelée" ou annulée.

## Avantages Logistiques
- Réduction drastique du "Last Mile Delivery" cost en regroupant les arrêts finaux.
- Meilleure expérience client (une seule réception pour plusieurs achats).
