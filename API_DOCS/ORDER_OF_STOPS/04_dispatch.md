# Étape 04 : Logique de Dispatch

Validation du système d'offre et d'attribution des missions.

## Aspects Techniques
- Recherche géo-spatiale des drivers (`RedisService`).
- Modes : GLOBAL, INTERNAL (Flotte), TARGET (ID spécifique).
- Gestion des offres et timeouts.
- Chaînage de missions (Drivers BUSY).

## Validation
- [ ] Test de dispatch GLOBAL (Drivers ONLINE à proximité).
- [ ] Test de dispatch INTERNAL (Fidélisation flotte).
- [ ] Test de dispatch TARGET.
- [ ] Vérification du chaînage (Driver BUSY -> Prochaine destination).
