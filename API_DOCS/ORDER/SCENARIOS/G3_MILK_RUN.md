# Scenario G.3: Le "Milk Run" (Interleavé M:N)

## Concept
Le cas le plus flexible où les points de collecte et de livraison sont mélangés de manière dynamique pour minimiser les kilomètres à vide.

## Cas d'Usage
- **Logistique Urbaine Mutualisée** : Le chauffeur ramasse un pli chez A pour le porter à B, mais sur le chemin il récupère un colis chez C pour le livrer à D.
- **Tournées Multipares** : Mélange de plusieurs clients "Éclaté" et "Conséquent" dans un seul véhicule.

## Structure VROOM (Cas G)
- **Shipments** : Plusieurs Couples `{Pi -> Di}` indépendants.
  - S1: {P1 -> D1}
  - S2: {P2 -> D2}
  - ...

## Comportement Attendu
- Le chauffeur ne fait pas forcément `P1 -> D1 -> P2 -> D2`.
- Il peut faire `P1 -> P2 -> D1 -> D2` si c'est plus court.
- **Contrainte Restante** : `P_i` doit TOUJOURS être visité avant `D_i`.

## Avantages Logistiques
- Rentabilité maximale par chauffeur.
- C'est le cœur du système Sublymus : traiter la ville comme un réseau de flux entremêlés.
