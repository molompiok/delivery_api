# VROOM Optimization Engine Documentation

VROOM is the core computational engine used by Sublymus to solve the Vehicle Routing Problem (VRP). It is used to calculate the most efficient path for one or multiple drivers while respecting complex business constraints.

## Official Resources

- **Source Code**: [VROOM-Project/vroom](https://github.com/VROOM-Project/vroom)
- **API Documentation**: [VROOM API Specification](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md)
- **Technical Forum**: [VROOM GitHub Discussions](https://github.com/VROOM-Project/vroom/discussions)

## Architecture

Our logistic stack is composed of two main layers:

1.  **Valhalla (Routing & Matrix)**: Provides the underlying road network data and travel time/distance matrices.
2.  **VROOM (Optimization)**: Takes the matrices from Valhalla, adds business constraints (capacities, time windows, skills), and produces the optimized plan.

## JSON Input Scheme (The "Universal" Format)

The input to VROOM is a JSON object containing `vehicles`, `jobs`, `shipments`, and optionally a `matrix`.

### 1. Vehicles
Defines the resources available (Drivers/Vehicles).
- `id`: Unique identifier (Internal Driver ID).
- `start`/`end`: Initial and final coordinates for the shift.
- `capacity`: Array of capacity values (e.g., [Weight, Volume]).
- `skills`: Required skills for specific shipments (e.g., [1] for Cold Chain).
- `time_window`: [start_timestamp, end_timestamp] in seconds since epoch or start of day.

### 2. Shipments (The "Cas G" Molecule)
Lies at the heart of our M:N logistic model.
- `amount`: Capacity units consumed by this shipment.
- `pickup`: Contains `location`, `service`, `time_windows`.
- `delivery`: Contains `location`, `service`, `time_windows`.
- **Invariants**: Pickup ALWAYS occurs before Delivery in the same route.

### 3. Jobs
Used for atomic tasks not linked to a specific pickup/delivery flow.
- `location`, `service`, `amount`, `skills`, `time_windows`.

### 4. Relations
Used for enforce grouping and order.
- `type`: "sequence" (strict order).
- `ids`: List of Job/Shipment IDs.

## Integration in AdonisJS

The `GeoService` is responsible for:
1. Transforming our internal `Order` models into VROOM-compatible JSON.
2. Fetching the `Distance Matrix` from Valhalla.
3. Querying the VROOM endpoint (default: `http://localhost:8001`).
4. Parsing the result into `OrderLegs` and `Waypoints`.
