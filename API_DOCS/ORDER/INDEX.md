# Order Logistic Documentation Index

This directory contains the documentation for the Sublymus/BMAD universal logistic engine, based on the **Cas G (Global)** architecture and powered by the **VROOM** optimization engine.

## Documentation Modules

### 1. [VROOM Integration Guide](VROOM.md)
Detailed documentation on the VROOM optimization engine, its integration with our infrastructure, and the technical specification of the input/output protocol.

### 2. [Universal Order Feature Specification](ORDER_FEATURE.md)
Comprehensive description of the business logic, tour types (Collection/Delivery), constraints (skills, compatibility), and the universal JSON format used by our services.

### 3. [Logistics & Business Scenarios](SCENARIOS/)
A collection of detailed use cases, business profiles, and critical edge cases handled by our logistic engine.

## Core Concepts

- **Cas G (Global)**: An abstraction layer that treats every delivery operation as a set of atomic dependencies (Pickups/Deliveries).
- **Shipments vs Jobs**: The building blocks of our route optimization.
- **Dynamic Routing**: How we handle real-time changes, traffic, and driver availability.
