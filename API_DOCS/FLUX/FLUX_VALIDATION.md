# Flux: Validation Colis/Action (Photo + QR/Code)

## 1. Objectif
Documenter le systeme de validation des actions logistiques:
- validation par `PHOTO` et/ou `CODE` (saisie ou scan QR dans l'app),
- support du mode FLUX (meme item manipule plusieurs fois),
- coexistence validation niveau `item` et niveau `action`.

Etat du code: 2026-03-07.

---

## 2. Probleme resolu
Avant:
- validation principalement configuree au niveau action,
- peu adapte au mode FLUX quand un meme item a plusieurs `PICKUP` / `DELIVERY`.

Maintenant:
- modele hybride `item + action`.

---

## 3. Modele hybride

### 3.1 Regles niveau item (fallback par phase)
Stockage: `transit_item.metadata.validation_rules`

Structure:
```json
{
  "pickup": {
    "photo": [{ "name": "pickup_photo", "compare": false }],
    "code": [{ "name": "pickup_code", "compare": true }]
  },
  "delivery": {
    "photo": [{ "name": "delivery_photo" }],
    "code": [{ "name": "delivery_code", "compare": true }]
  }
}
```

Chaque action `PICKUP`/`DELIVERY` de cet item herite de la phase correspondante, meme si l'item apparait plusieurs fois dans le flux.

### 3.2 Regles niveau action (override local)
Stockage: `actions.confirmation_rules`

Usage:
- cas specifiques a un stop/action precis,
- actions `SERVICE` sans item,
- exception locale meme si item a deja une policy.

### 3.3 Compatibilite payload legacy
Si `confirmation_rules` d'une action contient des flags:
- `pickup: true` et/ou `delivery: true`
=> interprete comme patch de regles niveau item.

Si une regle n'a pas ces flags:
=> regle conservee au niveau action (locale).

---

## 4. Resolution des regles effectives
Pour chaque action:
1. si `action.confirmation_rules` non vide => source `ACTION`.
2. sinon, si item a `validation_rules[phase]` => source `ITEM`.
3. sinon => aucune preuve requise (`NONE`).

`phase` = `pickup | delivery | service` derive du type action.

Les preuves materialisees sont stockees dans `action_proofs`.

---

## 5. Generation des preuves (`action_proofs`)
Types supportes:
- `PHOTO`
- `CODE`

Pour `CODE`:
- `compare=true` + pas de reference => code genere serveur.
- `compare=true` + reference fournie => comparaison sur reference.
- `compare=false` => presence de valeur suffisante.

Metadata de preuve inclut `source` (`ACTION`/`ITEM`) et phase.

---

## 6. API et execution driver

### 6.1 Recuperation mission
`GET /v1/missions` et `GET /v1/missions/:id` preload `actions.proofs`.

### 6.2 Completion action
`POST /v1/actions/:actionId/complete`
- body JSON:
```json
{ "proofs": { "delivery_code": "123456" } }
```
- ou multipart si photo(s):
  - champ `proofs`
  - fichier(s) associes a la `key` de preuve.

### 6.3 Validation serveur
`MissionService.completeAction`:
- verifie stop en `ARRIVED|PARTIAL`,
- verifie chaque preuve requise,
- marque `isVerified`,
- complete l'action si tout est valide.

---

## 7. App Driver (UX)
Ecran: `ActionValidationScreen`
- `PHOTO`: capture camera.
- `CODE`: saisie manuelle ou scan QR.
- scan QR via camera (plugin mobile scanner), valeur injectee dans le champ code.

Permissions ajoutees:
- Android: `android.permission.CAMERA`
- iOS: `NSCameraUsageDescription`

---

## 8. Exemples de payload

### 8.1 Config item-level direct
```json
{
  "transit_item": {
    "name": "Ordinateur",
    "validation_rules": {
      "pickup": {
        "photo": [{ "name": "pickup_photo" }]
      },
      "delivery": {
        "code": [{ "name": "delivery_code", "compare": true }]
      }
    }
  }
}
```

### 8.2 Config action-level local
```json
{
  "type": "delivery",
  "confirmation_rules": {
    "photo": [{ "name": "door_photo" }]
  }
}
```

### 8.3 Legacy action -> item patch
```json
{
  "confirmation_rules": {
    "photo": [
      { "name": "proof_pick", "pickup": true },
      { "name": "proof_drop", "delivery": true }
    ]
  }
}
```

---

## 9. Comportement FLUX (important)
Exemple item X:
- `+30`, `+30`, `-40`, `+50`, `-70`

Avec `validation_rules.pickup` + `validation_rules.delivery`:
- chaque action `PICKUP` de X demandera les preuves pickup,
- chaque action `DELIVERY` de X demandera les preuves delivery,
- sans duplication manuelle par action.

Et une action peut garder sa propre validation locale si besoin.

---

## 10. Checklist de test
- [ ] item avec rules pickup/delivery, plusieurs actions FLUX.
- [ ] action locale avec override sans flags.
- [ ] action `SERVICE` avec rules action-only.
- [ ] completion avec code saisi.
- [ ] completion avec code scanne QR.
- [ ] completion avec photo obligatoire.
- [ ] mission payload contient bien `actions[].proofs`.

---

## 11. References code
- `app/services/order/validation_rule_engine.ts`
- `app/services/order/action_service.ts`
- `app/services/order/transit_item_service.ts`
- `app/validators/order_validator.ts`
- `app/services/mission_service.ts`
- `app/services/mission_service.ts#completeAction`
- `delivery-driver-app/lib/features/missions/presentation/screens/action_validation_screen.dart`
- `delivery-driver-app/lib/features/missions/data/repositories/mission_repository.dart`
