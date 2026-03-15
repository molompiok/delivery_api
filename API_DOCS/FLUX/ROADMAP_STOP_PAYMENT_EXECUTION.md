# Roadmap Execution - Wallets et Paiement au Stop

## 1. Objet

Ce document transforme la feuille de route fonctionnelle en plan d'execution technique.

Pour chaque lot:

- objectif,
- perimetre technique,
- fichiers probables,
- risques,
- criteres de validation.

Perimetre principal:

- `Delivery/delivery-api`
- `Payement/wave-api`

---

## 2. Principes de pilotage

Ordre recommande:

1. stabiliser l'infrastructure,
2. corriger les flux financiers existants,
3. introduire les nouvelles regles metier,
4. finir par migration, observabilite et tests.

Regles deja retenues:

- `MISSION` n'est pas payable,
- wallet driver cible = `CompanyDriverSetting.walletId`,
- paiement Wave = fonds disponibles immediatement,
- paiement au stop = seulement sur les stops de livraison,
- distinction explicite:
  - `EMETTEUR_PAYE_TOUT`
  - `PAYEUR_AU_STOP`

---

## 3. Lots a executer

**Lot 1. Worker de synchronisation paiement**

Objectif:

- faire en sorte que le worker de sync paiement demarre avec `delivery-api`,
- garantir que la synchronisation `wave-api -> delivery-api` est automatique.

Points a traiter:

- choisir le point de boot du worker dans l'app HTTP,
- definir sa boucle d'execution,
- eviter plusieurs workers concurrents non maitrises,
- gerer l'arret propre au shutdown,
- poser les logs de cycle du worker.

Fichiers probables:

- [payment_sync_worker.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/commands/payment_sync_worker.ts)
- [server.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/bin/server.ts)
- [init.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/start/init.ts)
- nouveau service probable:
  - `app/services/payment_sync_runtime_service.ts`

Risques:

- double execution en dev HMR,
- double execution en multi-instance,
- boucle trop aggressive,
- worker silencieux si pas de logs exploitables.

Criteres de validation:

- au demarrage serveur, un log confirme que le worker runtime est actif,
- un intent confirme dans `wave-api` finit bien `COMPLETED` dans `delivery-api` sans action manuelle,
- le worker ne lance pas plusieurs boucles concurrentes dans le meme process.

---

**Lot 2. Gestion ephemere du checkout Wave**

Objectif:

- sortir le checkout URL de la logique persistante durable,
- le traiter comme un artefact court terme.

Decision cible:

- soit regeneration a la demande,
- soit cache Redis 10 minutes,
- mais pas de confiance sur un lien ancien stocke indefiniment.

Points a traiter:

- definir une cle Redis par intent,
- stocker `checkout_url`, `session_id`, `expires_at`,
- verifier si un checkout encore valide existe avant regeneration,
- regenerer si lien absent ou expire,
- definir l'idempotence de `authorize`.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [wallet_bridge_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/wallet_bridge_service.ts)
- [order_payments_controller.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/controllers/order_payments_controller.ts)
- [payment_orchestrator_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/payment_orchestrator_service.ts)
- [payment_intent.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/models/payment_intent.ts)
- nouveau service probable:
  - `app/services/payment_checkout_cache_service.ts`

Risques:

- multiplication des sessions Wave pour un meme intent,
- reutilisation d'un lien expire,
- desynchronisation entre session Wave et cache Redis.

Criteres de validation:

- un authorize repetitif sur une courte fenetre retourne soit le meme checkout valide, soit un nouveau propre,
- aucun checkout expire n'est renvoye,
- l'API supporte le cas "lien expire, regenere" sans casser l'intent metier.

---

**Lot 3. Reconciliation delivery-api / wave-api**

Objectif:

- fiabiliser la correspondance entre intent metier Delivery et ecritures reelles Wave.

Points a traiter:

- renforcer la detection de confirmation dans `checkPaymentStatus`,
- tracer `payment_intent_id`, `external_reference`, `session_id`,
- gerer les intents orphelins ou partiellement synchronises,
- definir une logique de reprise si `wave-api` a credite mais `delivery-api` n'a pas synchronise.

Fichiers probables:

- [wallet_bridge_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/wallet_bridge_service.ts)
- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [payment_sync_worker.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/commands/payment_sync_worker.ts)
- [webhook_processor_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/webhook_processor_service.ts)
- [payment_orchestrator_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/payment_orchestrator_service.ts)

Risques:

- faux positifs de completion,
- faux negatifs si le ledger regarde le mauvais wallet ou peu d'entrees recentes,
- intents bloquant le front alors que le paiement est bien passe.

Criteres de validation:

- chaque paiement Wave confirme remonte de facon deterministic cote Delivery,
- les intents localement `PENDING` mais deja executes cote Wave sont rattrapes automatiquement,
- les logs permettent de suivre un paiement de bout en bout.

---

**Lot 4. Resolution correcte du wallet receveur**

Objectif:

- distribuer la part driver vers le bon wallet metier.

Decision:

- dans le contexte entreprise-driver, la part driver doit aller vers `CompanyDriverSetting.walletId`.

Points a traiter:

- ajouter une resolution explicite de la relation active driver <-> entreprise,
- charger le `walletId` de la relation,
- remplacer l'usage direct de `order.driver.walletId` dans les splits,
- prevoir une erreur explicite si le wallet relation est absent,
- interdire le fallback silencieux vers plateforme pour les montants driver.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [wallet_provisioning_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/wallet_provisioning_service.ts)
- [company_driver_setting.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/models/company_driver_setting.ts)
- nouveau service probable:
  - `app/services/payment_wallet_resolution_service.ts`

Risques:

- relation entreprise-driver introuvable,
- commande multi-contexte mal resolue,
- regression IDEP si on remplace trop brutalement la logique.

Criteres de validation:

- les credits driver ETP apparaissent sur le wallet `COMPANY_DRIVER`,
- aucune part driver ne tombe sur la plateforme par absence silencieuse de wallet,
- les erreurs de configuration wallet sont visibles et explicites.

---

**Lot 5. Suppression de la fausse logique de release au stop**

Objectif:

- aligner le code avec la decision metier: les fonds Wave sont disponibles des confirmation.

Points a traiter:

- auditer `onStopCompleted`,
- retirer la dependance metier a `releaseFunds` pour ce flux,
- garder `release` seulement si un vrai mode `ON_HOLD` est voulu plus tard,
- documenter l'ajustement futur via ecritures compensatrices.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [mission_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/mission_service.ts)
- [internal_payment_orchestrator_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/internal_payment_orchestrator_service.ts)
- [release_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/release_service.ts)

Risques:

- code mort laisse en place,
- confusion entre "paiement acquis" et "stop termine",
- regression sur d'autres flux qui utilisent reellement `ON_HOLD`.

Criteres de validation:

- un paiement Wave confirme credite et rend disponible l'argent sans attendre la completion du stop,
- la completion du stop ne tente plus une release inutile,
- les ajustements futurs restent possibles par `TRANSFER` ou `ADJUSTMENT`.

---

**Lot 6. Champ metier de mode de paiement commande**

Objectif:

- representer clairement la difference entre:
  - emetteur qui paie tout,
  - client qui paie au stop.

Points a traiter:

- ajouter un champ metier explicite sur la commande,
- definir sa validation,
- definir son mapping API,
- integrer ce champ a la creation / edition de commande,
- definir la valeur par defaut.

Suggestion de valeur:

- `EMETTEUR_PAYE_TOUT`
- `PAYEUR_AU_STOP`

Fichiers probables:

- [order.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/models/order.ts)
- migration nouvelle dans `database/migrations`
- [order_validator.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/validators/order_validator.ts)
- [order_draft_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order/order_draft_service.ts)
- [orders_controller.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/controllers/orders_controller.ts)

Risques:

- ambiguite avec `paymentTrigger`,
- retrocompatibilite des anciennes commandes,
- front non aligne sur le nouveau champ.

Criteres de validation:

- toute commande `COMMANDE + TARGET` porte explicitement son mode de paiement,
- le backend ne devine plus ce mode par heuristique fragile.

---

**Lot 7. Notion de stop payable**

Objectif:

- passer de "paiement par stop brut" a "paiement par stop payable".

Regle provisoire:

- un stop est payable seulement s'il porte au moins une action de livraison.

Points a traiter:

- definir la detection d'un stop payable,
- distinguer pickup / delivery / service si necessaire,
- preparer un helper reutilisable,
- documenter les cas mixtes.

Fichiers probables:

- [stop.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/models/stop.ts)
- [action.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/models/action.ts)
- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- possiblement:
  - `app/services/order/stop_payment_service.ts`

Risques:

- mauvaise lecture de certains templates,
- stops avec actions mixtes,
- confusion entre "delivery physique" et "service".

Criteres de validation:

- un stop pickup seul ne genere pas d'intent payable,
- un stop delivery en genere un,
- le comportement est stable sur les parcours mixtes.

---

**Lot 8. Refonte de generation des PaymentIntent COMMANDE**

Objectif:

- adapter la generation des intents a la nouvelle logique metier.

Points a traiter:

- en `EMETTEUR_PAYE_TOUT`:
  - intent global commande,
  - payable a tout moment, meme apres completion,
- en `PAYEUR_AU_STOP`:
  - intents uniquement sur les stops payables,
  - pas d'intent pour les stops de collecte seule.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [payment_intent.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/models/payment_intent.ts)
- migration potentielle si nouveaux attributs a stocker

Risques:

- casser la logique `VOYAGE`,
- generer deux fois des intents,
- mauvaises conditions d'idempotence.

Criteres de validation:

- `EMETTEUR_PAYE_TOUT` cree l'intent attendu,
- `PAYEUR_AU_STOP` cree seulement les intents sur stops payables,
- les anciennes commandes non migrees restent lisibles ou converties.

---

**Lot 9. Repartition temporaire du montant entre stops payables**

Objectif:

- avoir une V1 simple et equitable sans entrer encore dans le calcul complexe strict.

Regle provisoire:

- repartir le montant total client entre les seuls stops payables.

Points a traiter:

- identifier le montant total a repartir,
- compter uniquement les stops payables,
- gerer le reste / arrondis,
- garder une trace lisible de la repartition effectuee.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [order_draft_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order/order_draft_service.ts)

Risques:

- repartition simple mais discutable metier,
- arrondis injustes si petits montants,
- ecart avec futur moteur strict.

Criteres de validation:

- somme des intents stop payables = montant total commande,
- aucun montant n'est attribue a un stop non payable,
- la repartition est deterministe.

---

**Lot 10. Flux driver pour paiement au stop**

Objectif:

- presenter au driver le bon paiement, au bon moment, sur le bon stop.

Points a traiter:

- afficher l'intent payable du stop,
- ne rien afficher si le stop n'est pas payable,
- gerer les actions `authorize`, `COD`, et etat de paiement,
- empecher les erreurs de validation sur mauvais stop.

Fichiers probables:

- backend:
  - [order_payments_controller.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/controllers/order_payments_controller.ts)
  - [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- frontend driver ensuite:
  - hors perimetre immediat backend, mais a prevoir

Risques:

- affichage driver non aligne sur le modele backend,
- paiement lance sur un stop non payable,
- confusion entre stop courant et autre stop.

Criteres de validation:

- sur un stop non payable, aucune action paiement n'est exposee,
- sur un stop payable, le paiement attendu est recuperable sans ambiguite,
- les erreurs de mauvais stop sont bloquees proprement.

---

**Lot 11. COD aligne sur la nouvelle logique**

Objectif:

- rendre le COD coherent avec le modele stop payable et les bons wallets.

Points a traiter:

- n'autoriser le COD que sur les stops payables,
- faire debiter le bon wallet reglement,
- conserver `IMMEDIATE` vs `DEFERRED`,
- corriger le batch de settlement differe si le wallet source change.

Fichiers probables:

- [order_payment_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/order_payment_service.ts)
- [driver_payments_controller.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/controllers/driver_payments_controller.ts)
- [internal_payment_orchestrator_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/internal_payment_orchestrator_service.ts)

Risques:

- COD declenche sur un stop non payable,
- debit du mauvais wallet,
- dossiers `COD_DEFERRED` impossibles a solder correctement.

Criteres de validation:

- un COD de stop payable regle les bonnes parts,
- un COD sur stop non payable est refuse,
- les dossiers differes se reglent depuis le bon wallet.

---

**Lot 12. Ajustements comptables futurs**

Objectif:

- permettre les corrections plus fines sans bloquer les fonds initiaux.

Points a traiter:

- definir la strategie d'ajustement:
  - `TRANSFER`
  - `ADJUSTMENT`
  - `REFUND`
- definir quand utiliser quoi,
- documenter les references ledger a conserver.

Fichiers probables:

- [wallet_bridge_service.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/app/services/wallet_bridge_service.ts)
- [transactions_controller.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/controllers/transactions_controller.ts)
- [refund_service.ts](/home/opus/Projects/Sublymus/Payement/wave-api/app/services/refund_service.ts)

Risques:

- complexite prematuree,
- mauvais usage des categories ledger,
- opacite audit si on ne documente pas les references.

Criteres de validation:

- une correction comptable peut etre appliquee sans reouvrir le paiement initial,
- le ledger reste lisible et reconciliable.

---

**Lot 13. Migration et backfill**

Objectif:

- faire passer les donnees existantes au nouveau modele sans casser le systeme.

Points a traiter:

- migration du nouveau champ de mode de paiement commande,
- eventuel backfill de valeurs par defaut,
- backfill des wallets `COMPANY_DRIVER` manquants,
- verification des commandes existantes `PROGRESSIVE`,
- script de verification post-migration.

Fichiers probables:

- `database/migrations/*`
- [backfill_wallets.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/commands/real_impact/backfill_wallets.ts)
- nouveaux scripts de verification possibles

Risques:

- anciennes commandes sans mode explicite,
- donnees incoherentes relation-driver / entreprise,
- intents historiques non migrables proprement.

Criteres de validation:

- les nouvelles colonnes sont peuplees,
- les wallets manquants critiques sont provisionnes,
- les commandes existantes restent consultables.

---

**Lot 14. Tests et non-regressions**

Objectif:

- verrouiller le nouveau comportement avant generalisation.

Points a traiter:

- tests unitaires resolution wallet,
- tests unitaires stop payable,
- tests integration authorize / webhook / sync worker,
- tests `EMETTEUR_PAYE_TOUT`,
- tests `PAYEUR_AU_STOP`,
- tests parcours mixtes:
  - `+5 > -5`
  - `+3 > +5 > -6 > +2 > -4`
- tests COD immediat / differe,
- tests de non-regression `MISSION` et `VOYAGE`.

Fichiers probables:

- [order_progressive.spec.ts](/home/opus/Projects/Sublymus/Delivery/delivery-api/tests/functional/order_progressive.spec.ts)
- nouveaux specs dans `tests/functional`
- scripts de verification dans `scripts/`

Risques:

- couverture partielle sur les parcours mixtes,
- faux sentiment de securite si on teste seulement le happy path.

Criteres de validation:

- chaque lot critique a au moins un test de non-regression,
- les cas metier nominaux et les cas de refus sont couverts.

---

## 4. Ordre d'execution recommande

### Phase A. Stabilisation technique

1. Lot 1. Worker de synchronisation paiement
2. Lot 2. Gestion ephemere du checkout Wave
3. Lot 3. Reconciliation delivery-api / wave-api

Sortie attendue:

- le pipeline paiement est fiable de bout en bout.

### Phase B. Correction financiere

4. Lot 4. Resolution correcte du wallet receveur
5. Lot 5. Suppression de la fausse logique de release au stop
6. Lot 12. Ajustements comptables futurs

Sortie attendue:

- l'argent va au bon wallet et le comportement financier devient coherent.

### Phase C. Nouveau modele metier stop-payment

7. Lot 6. Champ metier de mode de paiement commande
8. Lot 7. Notion de stop payable
9. Lot 8. Refonte de generation des PaymentIntent COMMANDE
10. Lot 9. Repartition temporaire du montant entre stops payables
11. Lot 10. Flux driver pour paiement au stop
12. Lot 11. COD aligne sur la nouvelle logique

Sortie attendue:

- le paiement au stop devient metierement correct.

### Phase D. Industrialisation

13. Lot 13. Migration et backfill
14. Lot 14. Tests et non-regressions

Sortie attendue:

- le systeme est migrable, testable et maintenable.

---

## 5. Proposition de decoupage en sprints

**Sprint 1**

- Lot 1
- Lot 2
- Lot 3

Livrable:

- sync fiable + checkout propre.

**Sprint 2**

- Lot 4
- Lot 5
- debut Lot 12

Livrable:

- flux financier corrige.

**Sprint 3**

- Lot 6
- Lot 7
- Lot 8
- Lot 9

Livrable:

- nouveau coeur metier stop-payment.

**Sprint 4**

- Lot 10
- Lot 11
- Lot 13
- Lot 14

Livrable:

- mise en service et securisation complete.

---

## 6. Priorites absolues

Si on doit aller au plus rentable d'abord, les priorites absolues sont:

1. demarrage auto du worker,
2. checkout ephemere,
3. wallet driver cible `COMPANY_DRIVER`,
4. suppression du fallback silencieux vers plateforme,
5. stop payable au lieu de stop brut.

---

## 7. References

- [ANALYSE_WALLETS_ET_STOP_PAYMENT.md](/home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/FLUX/ANALYSE_WALLETS_ET_STOP_PAYMENT.md)
- [FLUX_STOP_PAYMENT.md](/home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/FLUX/FLUX_STOP_PAYMENT.md)

