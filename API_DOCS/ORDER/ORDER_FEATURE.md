# Universal Order Feature Specification

This document defines the high-level functionalities and input formats for the Sublymus Order service. It supports complex logistic scenarios ranging from simple couriers to multi-source/multi-target industrial tours.

## 1. Tour Types (TC & TL)

### Collection Tour (TC) - Many-To-One
Gathering items from multiple locations to be delivered to a single destination.
- **Example**: Laundry pickup from various houses to a central factory.

### Delivery Tour (TL) - One-To-Many
Distributing items from a single collection point to multiple destinations.
- **Example**: Morning bread delivery from a bakery to various grocery stores.

## 2. Driver & Logistics Strategy

### Assignment Modes
- **DIRECT**: Explicitly assigned to a Driver ID (`ref_id`).
- **TARGET**: Offered specifically to an ETP (Enterprise) or a specific group.
- **GLOBAL**: Market-driven (Marketplace), any qualified driver can accept.

### Loading & Strategy
- **Progressive / Interleaved**: The driver can fulfill deliveries while still having pickups to do. This is handled by VROOM's optimization to minimize backtracking.
- **Cumulative / Batch**: Forced grouping where all pickups must be completed before any delivery starts. (Implemented via `relations` in the backend).

## 3. Advanced Waypoint Modifiers

For every Collection (C) or Delivery (L) point, we can attach:
- **Pb (Point Before)**: A pass-through point that MUST be visited immediately before the task (e.g., security gate, document pickup).
- **Pa (Point After)**: A pass-through point that MUST be visited immediately after the task (e.g., disposal site, return of containers).

## 4. Constraints & Groups

### Priority Groups
Instead of arbitrary numbers, we use **Priority Groups** (Urgent, Standard, Economy).
- Tasks within a group are optimized together.
- High-priority groups are sequenced strictly before lower-priority groups if they conflict.

### Skill & Technical Constraints
- **Thermo**: Cold chain (Fridge), Warm/Hot.
- **Dimensions**: S, M, L, XL, 2XL (Determines vehicle compatibility).
- **Specialized**: Document handling, Cash-on-delivery (COD).

### Compatibility / Exclusion
- **Incompatibility Rule**: Prevents certain goods from being in the same vehicle (e.g., Corrosive Chemicals + Fresh Food).

## 5. Universal JSON Input Structure

A unified command in AdonisJS follows this schema:

```json
{
  "context": "GLOBAL | INTERNAL | TARGET",
  "strategy": "OPTIMIZED | MANUAL",
  "tours": [
    {
      "id": "T1",
      "type": "COLLECT_TOUR",
      "nodes": [
        {
          "type": "PICKUP",
          "address": "...",
          "skills": ["fridge"],
          "group": "PRIORITY_1",
          "waypoints": {
             "before": [{ "id": "PB1", "address": "..." }],
             "after": []
          }
        }
      ],
      "destination": { "type": "DELIVERY", "address": "..." },
      "mix_with": ["T2"] // Allows merging this tour's optimization with T2
    }
  ]
}
```

## 6. Chaining and Mixing (The "At Plat" Strategy)

By default, an Order is a succession of Tours (`T1 -> T2 -> T3`).
- **Strict Chain**: T1 MUST be finished before T2.
- **Unified Mix (At Plat)**: If `mix_all` is true, the system "flattens" every tour into a single global optimization pool.
- **Specific Mix**: You can group `T1` and `T2` into a pool, while keeping `T3` as a separate sequel.

## 7. Exception Handling & Dynamic Operations

### Breakdown Management (Transfert de Tournée)
In case of vehicle failure:
1. **Extraction**: Remaining tasks of the broken vehicle are extracted.
2. **State Analysis**:
    - **Unpicked items**: Original Pickup location is kept.
    - **Already picked items**: The current location of the broken vehicle becomes the *new* Pickup location for the rescue driver.
3. **Re-injection**: These tasks are injected into the pool of available drivers as a high-priority "Rescue Shipment".

### Dynamic Cleaning (Nettoyage)
Automatic "Freezing" of dependency chains:
- If a **Pickup** fails (e.g., store closed), the system automatically **Freezes** the associated **Delivery** and **Pa (Point After)** tasks.
- The route is immediately recalculated to bypass these frozen nodes, ensuring the driver doesn't waste time.

### Wait Policy
Strategy for early arrival:
- Defines behavior if a driver arrives before the `time_window` starts.
- Options: **Wait** (stay on site), **Re-route** (move to next task and return later), or **Flexible Start** (allow early delivery if possible).

### Unassigned Task Handling
- If a task violates constraints (Time, Capacity, Skills), VROOM returns it as "unassigned".
- The system must flag these tasks to administrators with the reason (e.g., "Infeasible - Time Window Violation").

### Dynamic Injection/Removal
- **Injection**: Adding a new Shipment to an active tour. The system checks if the diversion cost is lower than dispatching a new driver.
- **Removal**: Canceling a shipment in transit. If the item is already picked up, it is automatically converted into a "Return-to-Hub" job.
