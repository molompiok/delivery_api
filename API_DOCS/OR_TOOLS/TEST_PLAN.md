# OR-Tools — Plan de Test & Validation

L'objectif est de valider chaque fonctionnalité via l'utilitaire `/test-lifecycle` du Dashboard.

## Phase 1 : Remplacement VROOM (Vitesse & Précision)
- [ ] Créer une Order avec 5 stops.
- [ ] Vérifier que `executionOrder` est calculé par OR-Tools au lieu de VROOM.
- [ ] Valider que le tracé map affiché est cohérent.

## Phase 2 : Contraintes de Stock & Charge
- [ ] Tester le multi-drop : `+5x` suivi de `-2x` et `-3x`.
- [ ] Provoquer une surcharge : mettre 3 tonnes dans un véhicule limité à 2 tonnes.
- [ ] Vérifier que OR-Tools déclare le stop infaisable ou propose un autre ordre si c'est possible.

## Phase 3 : Cycle de Vie complet
- [ ] **Scénario "Happy Path"** : Manager crée → Driver accepte → Driver exécute (chaque étape filmée/confirmée).
- [ ] **Scénario "Modification Live"** : Pendant que le chauffeur est entre Stop 1 et Stop 2, le manager ajoute un Stop 4. Vérifier l'insertion.
- [ ] **Scénario "Driver Choice"** : Le chauffeur décide de sauter un stop recommandé. Vérifier que l'ordre se recalcule.

---
[⬅ Retour à l'Index](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/INDEX.md)
