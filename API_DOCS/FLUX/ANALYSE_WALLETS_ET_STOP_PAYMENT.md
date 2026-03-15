# Analyse Wallets et Paiement au Stop

## 1. Objet
Ce document capture:

- l'etat actuel de la gestion des wallets dans `Sublymus Delivery`,
- les constats reels sur le flux de paiement actuel,
- la reflexion sur les nouvelles regles proposees pour le chantier "paiement au stop".

Perimetre:

- `Delivery/delivery-api`
- `Payement/wave-api`

Date de reference:

- 2026-03-10

---

## 2. Architecture actuelle

### 2.1 Separation des roles

`delivery-api`:

- porte la logique metier livraison,
- cree les `PaymentIntent` locaux,
- calcule les splits metier,
- autorise les paiements,
- gere le COD,
- appelle `wave-api` via `WalletBridgeService`.

`wave-api`:

- cree les wallets,
- gere le ledger,
- calcule les soldes,
- cree les sessions checkout Wave,
- recoit les webhooks Wave,
- cree les ecritures financieres reelles.

Conclusion:

- `delivery-api` orchestre,
- `wave-api` tient l'argent.

---

## 3. Gestion actuelle des wallets

### 3.1 Types de wallets utilises

Dans `delivery-api`, les entites suivantes peuvent porter un `walletId`:

- `User.walletId`
- `Company.walletId`
- `CompanyDriverSetting.walletId`

Le provisioning est gere par `WalletProvisioningService`.

Regles actuelles:

- un user driver recoit par defaut un wallet de type `DRIVER`,
- un client recoit un wallet de type `CLIENT`,
- une entreprise recoit un wallet de type `COMPANY`,
- une relation entreprise-driver recoit un wallet de type `COMPANY_DRIVER`.

Reference code:

- `app/services/wallet_provisioning_service.ts`

### 3.2 Graphe wallet d'un driver

Quand un driver ouvre ses endpoints paiements, `delivery-api` tente de garantir:

- wallet perso present,
- wallet(s) de relation entreprise-driver presents,
- wallet entreprise active present si besoin.

Le driver voit ensuite:

- son wallet personnel,
- les wallets lies a ses relations entreprise-driver,
- eventuellement le wallet d'entreprise qu'il gere.

Reference code:

- `app/controllers/driver_payments_controller.ts`

### 3.3 Ou vivent les soldes

Les soldes ne sont pas maintenus comme un compteur metier dans `delivery-api`.

Ils sont recalcules dans `wave-api` depuis `ledger_entries`:

- `balanceAccounting` = somme des mouvements `AVAILABLE`, `ON_HOLD`, `LOCKED`
- `balanceAvailable` = somme des mouvements `AVAILABLE`

Donc un wallet est un conteneur logique, mais le vrai solde depend du ledger.

Reference code:

- `Payement/wave-api/app/models/wallet.ts`
- `Payement/wave-api/app/services/ledger_service.ts`

---

## 4. Cycle actuel d'un paiement

### 4.1 Creation des intents dans delivery-api

`OrderPaymentService.generateIntentsForOrder` fait aujourd'hui:

- `MISSION` => pas de paiement,
- `VOYAGE` => 1 intent par booking,
- `COMMANDE`:
  - si trigger `PROGRESSIVE` => 1 intent par stop,
  - sinon => 1 intent global.

Constat important:

- en `COMMANDE`, le progressif cree actuellement un intent pour tous les stops,
- il ne filtre pas encore "delivery seulement" vs "pickup/collect".

Reference code:

- `app/services/order_payment_service.ts`

### 4.2 Authorize

`delivery-api`:

- charge l'intent,
- calcule les splits driver / company / plateforme,
- cree un checkout complexe dans `wave-api`,
- sauvegarde seulement `externalId` localement.

`wave-api`:

- cree son `PaymentIntent`,
- cree la session checkout Wave,
- stocke `waveCheckoutUrl` dans sa base,
- attend le webhook.

References:

- `app/services/order_payment_service.ts`
- `app/services/wallet_bridge_service.ts`
- `Payement/wave-api/app/services/payment_orchestrator_service.ts`

### 4.3 Confirmation Wave

Quand Wave confirme:

- `wave-api` recoit le webhook,
- execute l'intent,
- cree une ecriture `CREDIT` par split,
- marque l'intent `COMPLETED`.

Ensuite:

- `delivery-api` a un worker `payment:sync-worker`,
- il scrute les intents locaux `PENDING` avec `externalId`,
- il regarde si une trace apparait dans le ledger,
- puis il marque son `PaymentIntent` local `COMPLETED`.

References:

- `Payement/wave-api/app/services/webhook_processor_service.ts`
- `Payement/wave-api/app/services/payment_orchestrator_service.ts`
- `commands/payment_sync_worker.ts`

---

## 5. Constats critiques sur l'etat actuel

### 5.1 Le worker de synchro n'est pas branche au boot serveur

Constat:

- le worker existe comme commande Adonis,
- mais rien ne montre qu'il soit lance automatiquement au demarrage HTTP de `delivery-api`.

Impact:

- un paiement Wave peut etre correctement credite dans `wave-api`,
- mais rester `PENDING` cote `delivery-api` tant que le worker n'est pas execute.

### 5.2 Le checkout URL a une duree de vie courte mais sa gestion n'est pas propre

Constat:

- `delivery-api` ne stocke pas localement le lien,
- mais `wave-api` stocke `waveCheckoutUrl` dans son `PaymentIntent`.

Probleme:

- un lien checkout Wave expire vite,
- le stocker durablement en base est trompeur,
- on finit avec un lien persiste qui peut etre deja mort.

Decision cible proposee:

- ne pas persister ce lien durablement,
- soit le regenerer a la demande,
- soit le mettre en cache Redis 10 minutes maximum.

### 5.3 Le paiement progressif cree des intents pour tous les stops

Constat:

- en mode `PROGRESSIVE`, la logique actuelle repartit le total sur tous les stops,
- sans distinguer:
  - stop de collecte,
  - stop de livraison,
  - stop non payable.

Or ta nouvelle regle cible est:

- on ne demande un paiement qu'aux stops qui portent une livraison.

### 5.4 Le wallet cible driver est mauvais pour le mode entreprise

Constat actuel:

- `authorize` prend `order.driver.walletId`,
- pas `CompanyDriverSetting.walletId`.

Impact:

- les gains peuvent partir vers le wallet perso du driver,
- alors que tu veux explicitement le wallet `entreprise-driver`.

### 5.5 Le fallback actuel peut pousser l'argent vers la plateforme

Constat:

- si wallet driver absent, le montant driver tombe vers entreprise,
- si wallet entreprise absent, il tombe vers plateforme,
- si rien n'existe, la plateforme absorbe le reliquat.

Impact probable sur ton constat terrain:

- "le paiement va bien au wave-api mais le montant recu ne correspond a aucun wallet metier attendu".

En pratique, ce que tu observes peut venir de:

- wallet relation entreprise-driver non utilise,
- fallback vers plateforme,
- logique de repartition pas encore alignee avec les stops payants reels.

### 5.6 Le hook "release au stop" n'est pas coherent avec le flux courant

Constat:

- `onStopCompleted(stopId)` essaie de `release` la part driver a la fin du stop,
- mais les splits envoyes au checkout sont actuellement avec `release_delay_hours: 0`,
- donc les credits deviennent `AVAILABLE` des la confirmation Wave.

Conclusion:

- aujourd'hui, le "release au stop" n'a pas de vraie matiere a liberer dans le flux normal.

---

## 6. Decisions metier retenues d'apres tes propositions

Ces decisions sont coherentes et doivent devenir la base du refactor.

### 6.1 MISSION

Decision:

- `MISSION` n'est pas payable par intervention du driver.

Consequence:

- on garde `MISSION` hors du flux de paiement commande.

### 6.2 Wallet receveur de la part driver

Decision:

- la part driver doit aller au wallet `CompanyDriverSetting.walletId`,
- pas au wallet perso `User.walletId`,
- lorsqu'on est dans un contexte entreprise-driver.

Consequence:

- il faut resoudre la relation active entreprise-driver au moment des splits.

### 6.3 Moment de disponibilite des fonds

Decision:

- les fonds deviennent disponibles au paiement Wave,
- pas a la validation du stop.

Consequence:

- on doit supprimer la dependance fonctionnelle au `release` de fin de stop pour ce flux,
- le stop sert a declencher l'exigibilite du paiement, pas la disponibilite des fonds deja payes.

### 6.4 Paiement au stop uniquement pour les deliveries

Decision:

- un stop est payable seulement s'il porte au moins une action de livraison,
- jamais pour une collecte seule.

Exemples:

- `+5 > -5` => seul le stop `-5` est payable
- `+3 > +5 > -6 > +2 > -4` => seuls `-6` et `-4` sont candidats au paiement

### 6.5 Cas COMMANDE + assignment TARGET

Decision:

pour une `Order` de template `COMMANDE` et assignement `TARGET`, il faut distinguer deux modes:

- `EMETTEUR_PAYE_TOUT`
- `PAYEUR_AU_STOP`

Sens metier:

- `EMETTEUR_PAYE_TOUT`: celui qui cree la commande peut payer a n'importe quel moment, meme apres completion du parcours
- `PAYEUR_AU_STOP`: le client present au stop de livraison paye a ce stop

### 6.6 Repartition temporaire simplifiee

Decision:

- pour le moment, on ne gere pas encore la repartition complexe stricte,
- on repartit le montant total entre les seuls stops payants.

Consequence:

- la version 1 peut faire une repartition simple sur les stops avec delivery,
- puis une version 2 introduira un calcul plus fin.

---

## 7. Relecture critique de tes propositions

### 7.1 "Si le paiement est acquis des confirmation Wave, comment ajuster plus precis la prochaine fois ?"

Reponse:

- il ne faut pas retarder la disponibilite pour garder la possibilite d'ajuster,
- il faut separer:
  - `encaissement`
  - `reconciliation`
  - `ajustement`

Modele recommande:

- a la confirmation Wave, les fonds deviennent `AVAILABLE`,
- si plus tard la repartition doit changer, on cree:
  - un `TRANSFER` interne,
  - ou un `ADJUSTMENT`,
  - ou un `REFUND` partiel si l'argent doit ressortir.

Donc:

- le paiement n'est pas re-bloque,
- l'ajustement se fait par ecriture compensatrice,
- le ledger reste propre et audit-able.

### 7.2 "Le montant recu ne correspond a aucun wallet"

Ce constat est credible et coherent avec le code actuel.

Raisons les plus probables:

- le flux paie vers le mauvais wallet driver,
- le flux progressif cree des intents pour des stops qui ne devraient pas etre payants,
- le fallback plateforme absorbe des montants quand les wallets attendus ne sont pas resolus,
- la logique stop actuelle raisonne par stop brut et non par "stop payable".

### 7.3 "Le checkout doit etre regenere ou garde 10 min max"

C'est une bonne decision.

Recommendation:

- le lien checkout ne doit pas etre une verite metier durable,
- il doit etre traite comme un artefact ephemere.

Approche recommandee:

- `delivery-api` garde son `PaymentIntent` metier,
- `wave-api` garde la trace technique de session si necessaire,
- mais le `waveCheckoutUrl` public ne doit pas etre considere comme persistant,
- Redis 10 min est une bonne option simple.

---

## 8. Proposition de logique cible "nickel"

### 8.1 Nouveau principe central

Le paiement ne doit plus etre "par stop brut".

Il doit etre "par stop payable".

Definition provisoire d'un stop payable:

- stop contenant au moins une action de type livraison,
- stop appartenant a une commande payable,
- stop concernable par le mode de paiement choisi.

### 8.2 Deux familles d'intents a distinguer

#### A. Intent global emetteur

Cas:

- `COMMANDE`
- `assignment = TARGET`
- mode `EMETTEUR_PAYE_TOUT`

Caracteristiques:

- payeur = createur de la commande,
- payable avant, pendant, ou apres le parcours,
- un ou plusieurs intents globaux selon besoin,
- non lie a un stop payable.

#### B. Intent stop payable

Cas:

- `COMMANDE`
- mode `PAYEUR_AU_STOP`

Caracteristiques:

- un intent seulement pour les stops qui ont une livraison,
- payeur logique = client au stop,
- le driver declenche l'encaissement sur place,
- le paiement peut etre Wave ou COD.

### 8.3 Calcul provisoire du montant par stop payable

Version simple retenue pour maintenant:

1. calculer le montant total client de la commande,
2. identifier la liste des stops payables,
3. repartir ce montant uniquement entre eux,
4. ignorer les stops de collecte dans cette repartition.

Attention:

- cette version est volontairement simple,
- elle ne pretend pas resoudre le vrai cout logistique par segment.

---

## 9. Recommandations concretes pour l'implementation future

Ordre recommande.

### Etape 1. Fiabiliser l'infrastructure de paiement

- demarrer automatiquement le worker de synchro avec le serveur API,
- sortir le lien checkout du stockage permanent,
- ajouter un cache Redis 10 min ou regeneration a la demande,
- tracer clairement les intents expirables.

### Etape 2. Corriger le wallet receveur

- remplacer `order.driver.walletId` par la resolution du wallet `CompanyDriverSetting.walletId` dans le contexte entreprise-driver,
- interdire le fallback silencieux vers plateforme tant que le wallet metier attendu n'est pas resolu.

### Etape 3. Introduire la notion de stop payable

- marquer les stops payables a partir des actions de livraison,
- ne plus generer d'intent pour un stop de collecte seule,
- recalculer la repartition uniquement entre stops payables.

### Etape 4. Distinguer les deux modes business

- `EMETTEUR_PAYE_TOUT`
- `PAYEUR_AU_STOP`

Il faudra un champ metier explicite au niveau commande, pas une deduction implicite fragile.

### Etape 5. Retirer la logique de release au stop pour Wave

- si les fonds sont disponibles a confirmation Wave, il ne faut plus les reliberer au stop,
- garder les ajustements pour plus tard via ledger compensatoire.

---

## 10. Position finale sur tes propositions

Je valide les choix suivants comme base saine:

- `MISSION` hors paiement,
- wallet driver cible = `entreprise-driver`,
- fonds disponibles des paiement Wave,
- paiement au stop uniquement pour les stops de livraison,
- distinction stricte entre:
  - emetteur paie tout,
  - payeur au stop,
- repartition simple temporaire entre stops payants seulement.

Je considere que les points a corriger en priorite sont:

1. le demarrage automatique du worker de sync,
2. la gestion ephemere du checkout URL,
3. la suppression du fallback silencieux vers plateforme,
4. le passage de "stop brut" a "stop payable",
5. l'usage du wallet `CompanyDriverSetting`.

---

## 11. References code

- `Delivery/delivery-api/app/services/order_payment_service.ts`
- `Delivery/delivery-api/app/services/wallet_provisioning_service.ts`
- `Delivery/delivery-api/app/controllers/driver_payments_controller.ts`
- `Delivery/delivery-api/app/services/wallet_bridge_service.ts`
- `Delivery/delivery-api/commands/payment_sync_worker.ts`
- `Delivery/delivery-api/app/services/mission_service.ts`
- `Payement/wave-api/app/models/wallet.ts`
- `Payement/wave-api/app/services/ledger_service.ts`
- `Payement/wave-api/app/services/payment_orchestrator_service.ts`
- `Payement/wave-api/app/services/internal_payment_orchestrator_service.ts`
- `Payement/wave-api/app/services/webhook_processor_service.ts`

