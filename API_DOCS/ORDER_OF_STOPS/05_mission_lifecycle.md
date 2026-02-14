# Étape 05 : Cycle de Vie de la Mission

[⬅️ Retour à l'index](./index.md)

Validation des transitions de statut et de l'état du driver.

## Aspects Techniques
- Acceptation/Refus par le driver (`MissionService`).
- Verrouillage Redis (`OFFERING` -> `BUSY`).
- Transitions : `ACCEPTED` -> `DELIVERED`/`FAILED`
- Gestion des annulations et échecs.

## Validation
- [ ] Test Acceptation (passage en `BUSY` dans Redis).
- [ ] Test Refus (remise en pool de dispatch).
- [ ] Validation de l'automate d'états (transitions interdites).
