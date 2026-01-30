# Scenario G.6: Cas Spécifiques (Déménagement & Multi-nœuds)

## Concept
Gérer des missions qui ne sont plus de simples "colis" mais des services logistiques complets impliquant des volumes importants ou des successions de points sans lien direct de vente.

## Cas d'Usage
- **Déménagement** : Collecte à l'Adresse A (Meubles) + Adresse B (Cave) vers l'Adresse C (Nouveau Logement).
- **Tournée de Maintenance** : Un technicien qui doit passer à 5 endroits différents sans forcément transporter d'objets (Utilisation massive des **Jobs**).

## Structure VROOM (Cas G)
- **Déménagement** : Shipments `{A -> C}` et `{B -> C}`.
- **Maintenance** : Liste de **Jobs** indépendants avec des `service_time` longs.

## Comportement Attendu
- Prise en compte du **Volume global** (L/XL/2XL). Pour un déménagement, le véhicule peut être saturé dès la première collecte.
- Utilisation des `skills` : Besoin d'un chauffeur avec "Aide au portage" ou "Camion avec Hayon".

## Avantages Logistiques
- Capacité à gérer des prestations de service au-delà de la livraison pure.
- Planification précise du temps de travail (grâce aux `service_time`).
