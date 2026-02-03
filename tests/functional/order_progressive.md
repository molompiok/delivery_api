# Scénario : Le Grand Tour de l'Aube (Simulation Stagiaire)

Ce document décrit le plan de test progressif pour une commande complexe de 5 Steps et 20 Stops, simulant les erreurs et tâtonnements d'un utilisateur novice (le "stagiaire").

## 📦 Inventaire des Produits (TransitItems)
1.  **IT1 (Bloc - Box)** : Électroménager (Pièce unique).
2.  **IT2 (Flux - Fluid)** : Eau potable (Litres, divisible).
3.  **IT3 (Bloc - Box)** : Palettes de fournitures.
4.  **IT4 (Flux - Box)** : Courriers/Petits colis (Gestion par lot).
5.  **IT5 (Bloc - Box)** : Pièces de rechange pour maintenance.

---

## 🗺️ Déroulement de la Mission (5 Étapes / 20 Stops)

### Phase 1 : Initiation Maladroite (DRAFT)
Le stagiaire commence par créer une commande vide.
- **Action** : `POST /orders/initiate` -> Création d'un Draft.
- **Erreur** : Tente d'ajouter un stop sans adresse valide -> **Échec**.
- **Correction** : Ajoute le premier stop avec succès.

### Phase 2 : Construction de la "Collecte Matinale" (Step 1)
- **S1 (Pickup)** : IT1(+1), IT2(+100L).
- **Oubli** : Le stagiaire oublie de déclarer IT1 et IT2 dans la liste globale.
- **Test Vision** : Il utilise la **Création Inline** (`addTransitItem`) en envoyant l'objet complet directement dans l'action.
- **S2 (Pickup)** : IT3(+5).
- **S3 (Service)** : Sv(0) - Contrôle technique.
- **S4 (Pickup)** : IT4(+10).

### Phase 3 : Erreurs de Séquence (Step 2)
Le stagiaire tente de livrer des objets qu'il n'a pas encore ramassés.
- **S3 (Delivery)** : Tente de livrer IT1(-1).
- **Échec (ERROR)** : Le système bloque car IT1 n'est pas "dans le camion" à ce stade temporel (séquence).
- **Correction** : Réorganise les stops.
- **S1** : IT2(-50L).
- **S2** : IT4(-2).
- **S3** : IT1(-1).
- **S4** : IT1_New(+1) (Retour client).

### Phase 4 : Flux & Maintenance (Step 3)
Manipulation de fluides (cumulatif) et services.
- **S1** : IT5(+2), IT2(+200L).
- **S2** : Sv(0), IT5(-2).
- **S3** : IT3(-2).
- **S4** : IT4(-3).

### Phase 5 : La Tournée liée (Step 4 - LINKED)
- **Action** : Crée un Step avec `linked: true`.
- **Stops** : S1, S2, S3, S4 (Distribution variée).
- **Test** : Si un stop manque de coordonnées, vérifie que le geocoding auto fonctionne.

### Phase 6 : Finalisation & Nettoyage (Step 5)
- **S1** : IT3(-5).
- **S2** : IT2(-150L).
- **S3** : Sv(0).
- **Vérification** : Tentative de `SUBMIT`.
- **Warning** : Le système prévient si le solde n'est pas à 0 (mais autorise le stockage en Draft).
- **Ajustement** : Correction des quantités finales pour arriver à un solde nul.

---

## 🔬 Objectifs des tests progressifs
1.  **Immutabilité vs Souplesse** : Vérifier ce qui est modifiable en Draft.
2.  **Résilience** : La capacité du système à absorber des `TransitItems` créés au dernier moment.
3.  **Correcteur de Flux** : Validation que le système suit l'eau (IT2) au litre près.
4.  **Auto-Geocoding** : Résolution des adresses incomplètes pendant le flow.
