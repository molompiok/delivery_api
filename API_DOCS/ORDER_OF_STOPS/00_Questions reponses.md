# Questions & Réponses : Architecture des Commandes

Ce document récapitule les échanges sur la structure de gestion des commandes Sublymus "centrée sur l'action au stop".

---

### 🟢 1. Liaison Inter-Stops (Le Fil d'Ariane)
**Question :** Comment lier une collecte (+) au point A avec sa livraison (-) au point B sans le modèle "Shipment" binaire ?
**Réponse :** On utilise un `transit_item_id`. Cet ID est commun aux actions (+) et (-). Il permet de suivre un produit (ou un lot) depuis sa montée dans le véhicule jusqu'à sa descente, peu importe le nombre d'arrêts intermédiaires.

### 🟢 2. Multi-Actions au même Stop
**Question :** Un seul stop peut-il contenir plusieurs actions ?
**Réponse :** Oui. Un livreur peut effectuer des collectes, des livraisons et des services au même point géographique. L'ordre est défini par défaut dans le tableau des actions, mais le driver a la liberté de s'adapter sur place tant qu'il remplit toutes les missions du stop.

### 🟢 3. Logique VROOM & Stock
**Question :** Comment traduire cela pour le moteur d'optimisation VROOM ?
**Réponse :** Chaque action est traitée comme un "job" qui impacte le stock du véhicule. Le serveur calcule l'état du stock à chaque étape pour s'assurer que le véhicule n'est jamais en sous-charge (livrer ce qu'on n'a pas) ou en surcharge (sauf si l'option est activée).

### 🟢 4. Gestion de la Capacité & Surcharge
**Question :** VROOM doit-il respecter strictement la capacité du véhicule ?
**Réponse :** Par défaut oui. L'option "Autoriser surcharge" permet d'ignorer cette contrainte pour laisser le moteur optimiser sans restriction physique (le dépassement reste tracé en métadonnées).

### 🟢 5. Validation & Preuve de Service
**Question :** La validation se fait-elle par stop ou par action ?
**Réponse :** Par action. Chaque action (Photo, OTP, Scan) doit être validée individuellement par le driver pour confirmer l'exécution complète des tâches prévues au stop.

### 🟢 6. Distribution & Lots (Fluides / Quantités)
**Question :** Comment gère-t-on des quantités fractionnées (ex: 1000L collectés, livrés en 3 fois) ?
**Réponse :** C'est le `transit_item_id` qui lie le lot. On suit le flux quantitatif. Le système valide que le cumul des livraisons pour cet ID ne dépasse jamais le cumul des collectes effectuées précédemment.

### 🟢 7. Hiérarchie : Steps vs Stops
**Question :** Quel est le rôle des Steps dans la séquence ?
**Réponse :** Les `steps` sont les blocs logiques de la mission.
- Ils imposent un ordre strict : un driver doit finir le Step N avant de passer au Step N+1.
- `linked: true` : Indique que les steps doivent être exécutés à la suite par le même chauffeur (indispensable pour les missions de type "Tournée").
- `sequence` : L'index définit l'ordre chronologique obligatoire.

---

### 🟠 8. Modifications en Temps Réel (Le mécanisme "Shadow")

**Question :** Comment modifier une commande déjà acceptée par un chauffeur sans créer de bugs sur son application ?
**Réponse :** On utilise le mécanisme **"Draft-in-Place" (Shadow Components)**.
1. Toute modification (update stop, add action) sur une commande non-Draft crée un clone (shadow) avec le flag `is_pending_change = true`.
2. Le chauffeur ne voit que la version "Stable". Le dashboard voit la version "Virtuelle" (fusion des stables et des shadows).
3. Le client peut ajuster, supprimer (flag `is_delete_required`) et tester son itinéraire en mode brouillon jusqu'à ce qu'il soit satisfait.

**Question :** Que se passe-t-il quand on valide les modifications ?
**Réponse :** L'appel à `/push-updates` effectue une validation finale :
- Vérification de la viabilité logistique (pas de livraison impossible).
- Fusion physique des `shadows` dans les records originaux.
- Suppression des éléments marqués `is_delete_required`.
- Recalcul de l'itinéraire (VROOM) et mise à jour des `OrderLegs`.
- Notification WebSocket au chauffeur pour mettre à jour sa route.

**Question :** Peut-on modifier ce qui est déjà "fait" ?
**Réponse :** **Non.** Toute entité (Step/Stop/Action) dont le statut est `EXECUTED` ou `IN_PROGRESS` est verrouillée. On ne peut modifier que le futur de la mission.

---

### 🔴 9. Règles de Validation Logistique

**Question :** Quelles sont les contraintes vérifiées par le serveur ?
**Réponse :**
1. **Viabilité par Step** : À chaque étape, la somme du (Stock de départ + Collectes du step) doit être >= Livraisons du step. On ne peut pas planifier une livraison si l'objet n'est pas déjà dans le camion ou récupéré durant le même trajet.
2. **Équilibre Final (SUBMIT)** : Lors de la soumission ou du push final, le solde de chaque `transit_item_id` doit être exactement à **0** (tout ce qui est monté doit redescendre).
3. **Ordre des Steps** : On ne peut pas insérer un Step avec un index inférieur à un Step déjà terminé.

---
*Dernière mise à jour : 2026-02-01 (Shadow Components & Logic Update)*