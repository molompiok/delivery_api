# Flux: Paiement au Stop (Stop Payment)

## 1. Objectif
Documenter le flux de paiement au stop pour l'app Driver et le delivery-api:
- detection d'un paiement a valider sur un stop,
- generation du checkout Wave,
- declaration de collecte COD (cash/autre moyen),
- reglement immediat ou differe,
- impact sur les statuts.

Ce document decrit l'etat **actuel du code** (2026-03-07).

---

## 2. Perimetre
- Templates concernes: principalement `COMMANDE`.
- Mode progressif: `clientPaymentTrigger = PROGRESSIVE` => un `PaymentIntent` par stop.
- Endpoint API: `/v1/order-payments/*`.
- Ecran Driver: `StopDetailScreen`.

Hors scope:
- politique commerciale "qui paie / qui ne paie pas".
- remboursement business complet (hors endpoint refund deja present).

---

## 3. Entites

### 3.1 PaymentIntent
Champs cle:
- `id`, `orderId`, `stopId`, `amount`
- `status`: `PENDING | COMPLETED | FAILED | REFUNDED`
- `paymentMethod`: `WAVE | CASH | WALLET`
- `platformFee`, `waveFee`, `companyAmount`, `driverAmount`

### 3.2 CodCollection
Champs cle:
- `paymentIntentId`, `stopId`, `driverId`
- `expectedAmount`, `collectedAmount`, `changeGiven`
- `settlementMode`: `IMMEDIATE | DEFERRED`
- `status`: `COLLECTED | COD_DEFERRED | SETTLED | ...`
- `deferredReason`, `proofPhotoUrl`, `notes`

---

## 4. API Endpoints utilises

- `GET /v1/order-payments?orderId=<orderId>&stopId=<stopId>`
  - recupere l'intent du stop.

- `POST /v1/order-payments/:id/authorize`
  - cree l'intent Wave via bridge,
  - retourne `checkoutUrl`.
  - body optionnel:
```json
{
  "successUrl": "https://.../payments/success",
  "errorUrl": "https://.../payments/error"
}
```

- `POST /v1/order-payments/:id/cod`
  - declaration conducteur: client paye en cash/autre moyen.
```json
{
  "expectedAmount": 4000,
  "collectedAmount": 4000,
  "changeGiven": 0,
  "changeMethod": "CASH",
  "stopId": "stp_xxx"
}
```

- `POST /v1/admin/settle-pending-cod`
  - batch admin/cron pour solder les COD differes.

---

## 5. Sequence fonctionnelle (Driver)
1. Driver arrive au stop.
2. App appelle `GET /order-payments?orderId&stopId`.
3. Si intent `PENDING`, la carte "Paiement a valider" s'affiche.
4. Driver ouvre le panneau paiement.
5. App appelle `POST /order-payments/:id/authorize` si URL Wave absente.
6. App affiche le QR Wave (dans l'app, sans navigateur externe).
7. Si client paye cash/autre: app envoie `POST /order-payments/:id/cod`.
8. Si solde wallet driver insuffisant pour reglement immediat:
   - status `COD_DEFERRED`,
   - message app: versement requis avant 00:00.
9. Driver continue le flux des autres actions/stops.

---

## 6. Logique serveur de reglement

### 6.1 Creation des intents
`OrderPaymentService.generateIntentsForOrder`:
- en progressif: creation d'un intent par stop (`stopId` renseigne), statut `PENDING`.

### 6.2 Autorisation checkout Wave
`OrderPaymentService.authorize`:
- calcule les splits wallets,
- cree le payment intent Wave,
- sauvegarde `externalId`,
- retourne `checkoutUrl`.

### 6.3 COD
`OrderPaymentService.handleCod`:
- reserve au driver assigne,
- cree `CodCollection`,
- tente debit wallet driver => `SETTLED` si succes,
- sinon `COD_DEFERRED`.

### 6.4 Completion stop
`MissionService.syncStopProgress` appelle `orderPaymentService.onStopCompleted(stopId)`:
- pour l'intent `PENDING` du stop,
- release des fonds conducteur (`driverAmount`) si applicable,
- intent passe `COMPLETED` ou `FAILED`.

---

## 7. Regles metier explicites
- Un stop peut avoir **0 ou 1** `PaymentIntent` actif selon la policy.
- Le driver ne doit valider le paiement qu'en statut stop `ARRIVED`.
- Un COD peut etre:
  - `IMMEDIATE` (wallet debite maintenant),
  - `DEFERRED` (solde insuffisant ou erreur check/debit).
- Le statut intent peut rester `PENDING` tant que le reglement COD n'est pas solde.

---

## 8. Erreurs courantes
- `Intent de paiement introuvable`:
  - stop non configure pour paiement progressif.
- `Impossible de generer le lien de paiement Wave`:
  - bridge indisponible / configuration callback.
- `Only the assigned driver can handle COD`:
  - token d'un autre user.

---

## 9. Checklist de test
- [ ] Stop sans intent => pas de carte paiement.
- [ ] Stop avec intent `PENDING` => carte visible + bouton validation.
- [ ] Authorize retourne un `checkoutUrl` valide.
- [ ] COD cash valide => creation `CodCollection`.
- [ ] Solde insuffisant => `COD_DEFERRED` + message app.
- [ ] Cron `settle-pending-cod` solde un dossier differe.
- [ ] Completion stop declenche `onStopCompleted`.

---

## 10. References code
- `start/routes/payments.ts`
- `app/controllers/order_payments_controller.ts`
- `app/services/order_payment_service.ts`
- `app/services/mission_service.ts` (hook completion stop)
- `delivery-driver-app/lib/features/missions/presentation/screens/stop_detail_screen.dart`
- `delivery-driver-app/lib/features/missions/data/repositories/mission_repository.dart`
