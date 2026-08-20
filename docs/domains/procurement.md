# Domain — Procurement & Cost (Flow B)

> **Fully implemented.** This domain was previously marked "not yet implemented" in older docs —
> that was stale. Corrected 2026-08-14.

```
Need → MR → PO → GRN → (Inventory) → Supplier Bill → Payment
             COMMITTED   ACCRUED                ACTUAL + GL
```

| Capability | Code | Endpoints | Frontend | Status |
|---|---|---|---|---|
| Catalogue (UoM, MaterialCategory, SpendCategory, Material) | `procurement/catalogue` | `procurement/uom`, `.../material-categories`, `.../spend-categories`, `.../materials` | `/procurement/setup/*` | INTEGRATED |
| Suppliers | `accounting/...` (Supplier) | `suppliers` | `/procurement/suppliers` | INTEGRATED |
| Material Requests (dual-scope, DOA) | `procurement/material-requests` | `procurement/material-requests` | `/procurement/requests` | INTEGRATED |
| Purchase Orders (immutable revisions) | `procurement/purchase-orders` | `procurement/purchase-orders` | `/procurement/orders` | INTEGRATED |
| Goods Receipts (over-receipt tolerance) | `procurement/goods-receipts` | `procurement/goods-receipts` | `/procurement/grn` | INTEGRATED |
| Bill Matching (2-way / 3-way) | `procurement/bill-matching` | `procurement/bill-matching` | — | BACKEND |
| Commitment Ledger | `procurement/commitment-ledger` | `procurement/commitment-ledger` | `/procurement/commitments` | INTEGRATED |

**ADRs:** ADR-007 (procurement, AP integration, commitment control — 13 locked decisions),
ADR-012 (subcontracts reuse the certify engine + AP — designed, not built).

**Commitment Ledger** — immutable signed `CommitmentLedgerEntry` written via
`CommitmentLedgerWriter` (`committed()` / `accrued()` / `actual()`; auto-computes
`reportingAmount`, sets `occurredAt`):
`COMMITTED` (PO approval) → `ACCRUED` (GRN post) → `ACTUAL` (Bill post). Kept **separate** from
the GL — see `docs/02-domain-boundaries.md`.

**Bill matching** blocks posting unless `MATCHED` / `MATCHED_WITH_TOLERANCE` /
`APPROVED_EXCEPTION`; THREE_WAY for MATERIAL, TWO_WAY for SERVICE; hierarchical tolerance
(PO → SpendCategory → Org).

**Open loop:** buying material does not charge a project. *Issuing* material to site does — but
Inventory/stock ledger is **not built**, so project consumption cannot be recorded yet. See
`docs/domains/not-built.md`.
