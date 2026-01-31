# Étape 03 : Moteur de Tarification

[⬅️ Retour à l'index](./index.md)

Validation du calcul des prix et de la répartition financière.

## Aspects Techniques
- Calcul basé sur KM/Temps (`PricingService`).
- Gestion des surcharges (Poids, Volume, Fragile).
- Calcul de la commission plateforme vs part livreur.

## Validation
- [ ] Test des différents seuils de surcharge.
- [ ] Vérification des arrondis et devises (XOF).
- [ ] Cohérence entre estimation et création commande.
