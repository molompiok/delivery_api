General :

step 1: Colis1 (pickup 12), Colis2 (pickup 5), Colis3 (pickup 1)

step 2: Colis1 (delivery 4) , Colis3 (pickup 1), Colis4 (pickup 1)

step 3: Colis1 (delivery 6) , Colis3 (delivery 2) 

step 4: Colis1 (delivery 2), Colis2 (delivery 5) 

step 5: Colis4 (delivery 1) 

### Item Flow Visualization (Relationships)

```text
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│     STEP 1      │      │     STEP 2      │      │     STEP 3      │      │     STEP 4      │      │     STEP 5      │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ Colis1 (P: 12)  │──┐   │ Colis1 (D: 4)   │──┐   │ Colis1 (D: 6)   │──┐   │ Colis1 (D: 2)   │      │                 │
│                 │  │   │                 │  │   │                 │  │   │                 │      │                 │
│ Colis2 (P: 5)   │──┼───┼─────────────────┼──┼───┼─────────────────┼──┼──▶│ Colis2 (D: 5)   │      │                 │
│                 │  │   │                 │  │   │                 │  │   └─────────────────┘      │                 │
│ Colis3 (P: 1)   │──┼───┼──▶ Colis3 (P: 1)│──┼──▶│ Colis3 (D: 2)   │  │                            │                 │
│                 │  │   │                 │  │   └─────────────────┘  │                            │                 │
│                 │  │   │ Colis4 (P: 1)   │──┼────────────────────────┼───────────────────────────▶│ Colis4 (D: 1)   │
└─────────────────┘  │   └─────────────────┘  │                        │                            └─────────────────┘
                     │                        │                        │
                     └────────────────────────┴────────────────────────┘
                              Item Flow (Transit)
```

**Légende :**
- `(P: X)` : Pickup (Collecte) de X unités.
- `(D: X)` : Delivery (Livraison) de X unités.
- `──▶` : Flux d'un même item entre les étapes.

Bus :
