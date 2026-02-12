# OR-Tools — Architecture & Flux de Données

## 1. Vue d'ensemble
L'optimisation repose sur une collaboration entre trois services :

1.  **delivery-api (AdonisJS)** : Le chef d'orchestre.
2.  **Valhalla** : Fournisseur de matrices de distances/temps.
3.  **or-tools-optimizer (Python)** : Le cerveau mathématique.

## 2. Le Microservice Python
*   **Techno** : Python 3 + Flask + `ortools`.
*   **Entrée** : Liste de nœuds (stops), matrice de distances, matrice de temps, capacités véhicule.
*   **Sortie** : Ordre optimal des nœuds, horaires de passage estimés, items non assignés.

## 3. Flux d'une requête d'optimisation (OrderDraftService)
1.  **Préparation** : Récupération de l'état virtuel de l'ordre (Stops non validés).
2.  **Distance Matrix** : Appel à Valhalla (`sources_to_targets`) pour obtenir les coûts réels de trajet.
3.  **Optimization** : Envoi à OR-Tools qui applique les contraintes métier.
4.  **Application** : Mise à jour de `Stop.executionOrder` dans la base de données.
5.  **Routing** : Appel final à Valhalla pour générer le tracé GPS (`LineString`) à afficher sur la map.

## 4. OrToolsService (Node.js)
Ce nouveau service dans AdonisJS fera le lien :
*   `GET /sources_to_targets` (via GeoService/Valhalla).
*   `POST /optimize` (via OrTools Microservice).
*   Formatage des réponses pour `OrderDraftService`.

---
[⬅ Retour à l'Index](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/INDEX.md)
