# Google OR-Tools Integration — INDEX

Bienvenue dans la documentation de la refonte du moteur d'optimisation. Nous remplaçons VROOM par Google OR-Tools pour une gestion avancée des flux logistiques.

## 📁 Sommaire des Documents

1.  **[Architecture & Flux de Données](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/ARCHITECTURE.md)**
    *   Le rôle du microservice Python et l'intégration AdonisJS.
2.  **[Mapping des Modèles](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/DATA_MAPPING.md)**
    *   Comment nos Stops/Actions deviennent des contraintes OR-Tools.
3.  **[Cycle de Vie & Ré-optimisation Dynamique](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/LIFECYCLE.md)**
    *   Gestion du "Live" : ajout de stops, changements de chauffeur, "Driver Full Control".
4.  **[Contraintes Avancées](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/CONSTRAINTS.md)**
    *   Multi-compartiments, Time Windows, Skills & Requirements.
5.  **[Plan de Test & Validation](file:///home/opus/Projects/Sublymus/Delivery/delivery-api/API_DOCS/OR_TOOLS/TEST_PLAN.md)**
    *   L'usage de `/test-lifecycle` pour valider chaque étape.

---

## 🚀 Philosophie de l'implémentation
*   **Modularité** : Le service Node.js prépare les données, le microservice Python résout l'équation complexe.
*   **Remplacement de VROOM** : Opération transparente pour le reste de l'application.
*   **Robustesse** : Priorité à la cohérence des stocks (+/-) et au respect des capacités.
