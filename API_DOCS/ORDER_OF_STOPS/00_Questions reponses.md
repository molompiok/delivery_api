# Questions & Réponses : Architecture des Commandes

Ce document récapitule les échanges entre Noga et l'agent sur la nouvelle structure de gestion des commandes "centrée sur l'action au stop".

---

### 🟢 1. Liaison Inter-Stops (Le Fil d'Ariane)
**Question :** Comment lier une collecte (+) au point A avec sa livraison (-) au point B sans le modèle "Shipment" binaire ?
**Réponse :** On utilise un `transit_item_id`. Cet ID est commun aux actions (+) et (-). Il permet de suivre un produit (ou un lot) depuis sa montée dans le véhicule jusqu'à sa descente, peu importe le nombre d'arrêts intermédiaires.

### 🟢 2. Multi-Actions au même Stop
**Question :** Un seul stop peut-il contenir plusieurs actions ?
**Réponse :** Oui. Un livreur peut effectuer des collectes, des livraisons et des services au même point géographique. L'ordre est défini par défaut dans le tableau des actions, mais le driver a la liberté de s'adapter sur place tant que toutes les actions sont complétées.

### 🟢 3. Logique VROOM & Stock
**Question :** Comment traduire cela pour le moteur d'optimisation VROOM ?
**Réponse :** Chaque action est traitée comme un "job" qui impacte le stock du véhicule. C'est à la couche application (delivery-api) de calculer l'état du stock (ce qui est monté/descendu) pour informer VROOM.

### 🟢 4. Gestion de la Capacité & Surcharge
**Question :** VROOM doit-il respecter strictement la capacité du véhicule ?
**Réponse :** Par défaut oui, mais avec une option "Autoriser surcharge". En cas de surcharge activée, on ignore la contrainte de capacité (ou on la passe à l'infini) pour permettre au moteur d'optimiser sans restriction physique. Le dépassement est tracé dans les métadonnées.
*Note technique : VROOM ne gérant pas nativement la surcharge "souple", l'ignorer est l'approche retenue.*

### 🟢 5. Validation & Preuve de Service
**Question :** La validation se fait-elle par stop ou par action ?
**Réponse :** Par action. Si un arrêt comporte 3 actions avec confirmation requise, le driver doit valider les 3 actions individuellement (Photo ou Code OTP/QR).

### 🟢 6. Distribution & Lots (Fluides / Quantités)
**Question :** Comment gère-t-on 1000L d'eau collectés en deux fois et livrés en trois fois ?
**Réponse :** C'est le duo `produit_id` + `transit_item_id` qui compte. On raisonne en quantités récupérées et livrées. On ne cherche pas à identifier chaque unité, mais à suivre le flux volumétrique ou quantitatif global du lot de transit.

### 🟢 7. Structure des Steps
**Question :** Quel est le rôle des Steps ?
**Réponse :** Les steps servent à organiser les stops. Pour l'instant, ils sont indépendants et ne gèrent pas encore de file d'attente spécifique de drivers ou de successions strictes.

---

### 🟢 8. Cycle de Vie & Modifications en cours (In-Transit)
La structure permet des ajustements dynamiques durant la tournée :

*   **Ajout de Steps** : Possible en cours de route. Le nouvel index doit être supérieur aux steps existants et cohérent avec la logistique actuelle.
*   **Retrait Action/Stop** : Un stop ou une action peut être retiré définitivement ou "gelé" (reste visible mais exclu des calculs d'itinéraire).
*   **Contrainte Critique** : On ne peut jamais supprimer ou modifier ce qui est déjà **fait** ou **en cours** d'exécution.
*   **Suppression de Step** : Un step ne peut être retiré que s'il est vide de stops. Les index sont alors automatiques recalculés.
*   **Suppression de Commande** : Suppression physique interdite. On utilise un flag `isDeleted: true` pour conserver l'historique complet (même rejeté).

---
## Note supementaaire

A - pour les commandes
ok on peut 
create 
- cree une commande, 

update
- ajouter des stpes en cours de routes : chaque nouveau step est ajouet avec un index superieur et doit etre coherent avec les step recedant.
- ajouter ( s'il c'est pas deja occuper avec une autre commande )/ retirer  (s'il n'a pas de colis n'a pas de colis a gerer).
- on peut en cours de route : retiner une [ actions/stop ] definitivement , ou la geler ( toujour visible, mais plus prise en compte dans les calcules de tajectoire).
- on ne peut rien suprpimer qui soit deja fait ou en cours.

delete step
- on ne peut par retirer suprimer ou retirer une step si elle contient encores des stops
-  les index automatiquement recalculer.

delete commande 
on ne peut pas suprimer une commande. meme celle qui n'ont ete cree et rejeter.
juste un isDeleted a true.


B - 
---
*Dernière mise à jour : 2026-01-30*