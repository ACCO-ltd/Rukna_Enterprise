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
| Competitive quotations (ADR-044) | `procurement/quotations` | `procurement/quotation-requests` | `/procurement/quotes`, `/finance/quotes` | INTEGRATED |
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

**Competitive quotations** (ADR-044, spec `docs/specs/procurement-quotations-phase1.md` §0a) sit
between an APPROVED MR and its PO: `COLLECTING → AWAITING_DECISION → (RETURNED) → AWARDED
(or AWARD_PENDING_APPROVAL when DoA bands are active)`. The buyer (`collect:quotation`) only
photographs quotes and names the store — no price field; photos are downscaled on the phone,
SHA-256 recorded, and become IMMUTABLE on send. Finance (`award:quotation`, SoD: neither the
uploader nor the MR requester) types each total from the photo, chooses, and picks the pay-by
path (recorded only in Phase 1). Raising the order prefills supplier, lines and pro-rata prices
from the award; its confirm is covered by the award (no second approval) and refused above it
(`PO_EXCEEDS_AWARD` → cancel the draft, then request a re-decision).

**Open loop:** buying material does not charge a project. *Issuing* material to site does — but
Inventory/stock ledger is **not built**, so project consumption cannot be recorded yet. See
`docs/domains/not-built.md`.
