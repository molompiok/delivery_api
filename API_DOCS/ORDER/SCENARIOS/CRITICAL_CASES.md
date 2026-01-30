# Scénarios de Cas Critiques (Edge Cases & Erreurs)

Comment le système réagit quand les choses ne se passent pas comme prévu.

## 1. L'Incalculable (Unassigned Task)
- **Scénario** : L'optimiseur VROOM ne trouve aucune solution pour une tâche (ex: horaire impossible ou pas de chauffeur avec le bon skill).
- **Réaction système** : 
  - La tâche est marquée "Non-attribuée".
  - Une alerte est envoyée sur le Dashboard ETP avec le motif calculé (ex: `infeasible: time_window_violation`).
  - L'admin doit manuellement forcer une attribution ou appeler le client.

## 2. La Surcharge Physique (Capacity Violation)
- **Scénario** : Un chauffeur tente de prendre un colis XL alors que sa jauge de capacité est à 90%.
- **Réaction système** : 
  - L'application Driver refuse le scan si le blocage est strict.
  - VROOM pré-calcule cela en amont : la mission ne lui sera proposée que si l'espace est suffisant après les livraisons précédentes.

## 3. Le "No-Show" (Client Absent)
- **Scénario** : Le chauffeur arrive au point de pickup ou delivery, mais personne ne répond.
- **Réaction système** :
  - **Nettoyage Dynamique** : Si c'est un Pickup, la suite de la chaîne de livraison est "gelée".
  - Le chauffeur doit prendre une photo preuve via l'app pour valider l'échec.
  - Le trajet est recalculé pour passer au point suivant immédiatement.

## 4. La Panne de Chauffeur (Breakdown)
- **Scénario** : Le véhicule est immobilisé au milieu de sa tournée avec 5 colis à bord.
- **Réaction système** :
  - L'admin déclenche un "Sauvetage".
  - Les colis à bord deviennent des nouveaux Pickups au point GPS actuel de la panne.
  - Une nouvelle mission prioritaire est créée pour un autre chauffeur à proximité.

## 5. La Rupture de Connexion (Trafic / GPS)
- **Scénario** : Le chauffeur entre dans une zone blanche ou le trafic s'arrête net (Abidjan).
- **Réaction système** :
  - L'app Driver conserve la liste des étapes en local (Offline Mode).
  - Le serveur détecte le retard via le manque d'updates GPS et recalcule les ETA (Estimated Time of Arrival) pour tous les clients suivants.
