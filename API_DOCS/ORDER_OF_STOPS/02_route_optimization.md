# Étape 02 : Optimisation & Calcul d'Itinéraire

[⬅️ Retour à l'index](./index.md)

Cette étape valide l'intégration avec le moteur VROOM et la structure des `OrderLegs`.

## Aspects Techniques
- Appel au `GeoService` pour l'optimisation.
- Mapping vers le format VROOM.
- Création des `OrderLegs` et calcul des ETAs.
- Séquençage correct des `Stops` et `Tasks`.

## Validation
- [ ] Vérification du calcul d'itinéraire (distance/durée).
- [ ] Validation de l'ordre des arrêts (Optimized vs Non-optimized).
- [ ] Vérification de la géométrie de la route.
