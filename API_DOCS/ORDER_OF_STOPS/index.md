# Tour de Contrôle : Gestion des Commandes (Order Management)

Bienvenue dans la tour de contrôle pour l'implémentation et la validation de la gestion des commandes Sublymus. Ce document sert de dashboard central pour piloter l'opération étape par étape.

## Philosophie : Le Changement de Paradigme

Cette opération marque la transition entre l'ancienne logique de gestion et la nouvelle structure définie dans [dataStructure.md](./dataStructure.md).

| Caractéristique | Ancien Modèle (Obsolète) | Nouveau Modèle (Cible) |
| :--- | :--- | :--- |
| **Focus** | Trajet et Type de Tournée | **L'Action au Stop** |
| **Unité de base** | Shipment [Départ > Arrivée] | **Stop** (Point Géo) |
| **Logique VROOM** | Évitait les "Jobs" atomiques | Utilise les **Actions** (+, -, .) |
| **Scénarios** | Définis à l'avance (G1, G2...) | **Inhérents** aux combinaisons d'actions |
| **Liaison** | Shipment UUID | **transit_item_id** (commun au + et -) |
| **Stock** | Binaire (chargé/déchargé) | **Quantitatif** (gestion de flux/fluides) |

### Principes Fondamentaux de la Tour de Contrôle
1. **L'Action est reine** : Tout ce qui monte (`pickup +`), descend (`delivery -`) ou se passe sur place (`service .`) est une action.
2. **Transit Item ID** : C'est la clé de voûte qui lie une collecte à sa livraison, même si les stops sont multiples ou distants.
3. **Stock Temps Réel** : On sait à tout instant ce qui est à l'intérieur du véhicule en calculant la somme des actions précédentes.
4. **Groupement par Steps** : Les actions sont groupées en `steps`. La propriété `linked: true` impose qu'un même driver enchaîne les étapes.
5. **Flexibilité du Driver** : L'ordre des actions à un stop est indicatif ; le driver peut s'adapter tant qu'il remplit toutes les missions du stop.

> [!NOTE]
> Pour comprendre l'écart entre l'implémentation actuelle et la cible, consultez les documents dans [API_DOCS/ORDER](../ORDER/).

## Navigation de l'Opération

### Phase 0 : Conception & Références
- [x] [00_Questions reponses.md](./00_Questions reponses.md) : Principes de l'architecture Action-Stop.

### Phase 1 : Initialisation & Création
- [ ] [01_creation.md](./01_creation.md) : Création de commandes simples et complexes (Cas G).
- [ ] [02_route_optimization.md](./02_route_optimization.md) : Calcul d'itinéraire, VROOM et séquençage des arrêts.
- [ ] [03_pricing.md](./03_pricing.md) : Moteur de tarification, frais clients et rémunération livreurs.

### Phase 2 : Dispatch & Attribution
- [ ] [04_dispatch.md](./04_dispatch.md) : Logique de dispatch (GLOBAL, INTERNAL, TARGET).
- [ ] [05_mission_lifecycle.md](./05_mission_lifecycle.md) : Cycle de vie de la mission (Acceptation, Refus, Transitions).

### Phase 3 : Exécution & Preuve de Service
- [ ] [06_verification.md](./06_verification.md) : Vérification par code OTP et confirmation photo.
- [ ] [07_realtime_sync.md](./07_realtime_sync.md) : Synchronisation temps réel (WebSockets) et interfaces.
- [x] [08_shadow_modifications.md](./08_shadow_modifications.md) : Modifications en temps réel (Shadow Components).

## État Global de l'Opération

| Étape | Description | Statut |
| :--- | :--- | :--- |
| 01 | Création & Validation | ⏳ En attente |
| 02 | Optimisation & Route | ⏳ En attente |
| 03 | Tarification | ⏳ En attente |
| 04 | Dispatch & Offres | ⏳ En attente |
| 05 | Lifecycle Mission | ⏳ En attente |
| 06 | Preuve de Service | ⏳ En attente |
| 07 | Sync Temps Réel | ⏳ En attente |
| 08 | Shadows & Modifs | ✅ Terminé |

---

## Guide d'Utilisation
Chaque fichier `.md` ci-dessus contient les détails techniques, les tests à effectuer et les points de vigilance pour sa partie respective. Nous validons chaque étape avant de passer à la suivante.
