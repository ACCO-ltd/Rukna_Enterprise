# Procurement workspace — refinement (Phase 5)

Status: **BUILT and browser-QA'd 2026-09-05.** Backend + frontend landed; 947 API tests, 1717 web
tests, both browser states verified. Residual gaps in *Still open*.
Phase 5 of the project-workspace redesign, after Commercial (`commercial-workspace-refinement.md`).
Sources of truth: **ADR-013** (Project Financial Position), **ADR-018** (bill matching),
**ADR-020** (BOQ backbone + change classifier), **ADR-022** (DOA + SoD).
Supersedes the boundary section of `docs/reference/procurement-tab-refinement-spec.md`.

## Why Procurement before Finance

The cost spine runs `MR → PO → GRN → Bill → Payment`, producing `COMMITTED → ACCRUED → ACTUAL`.
Finance *interprets* those events. Designing the interpretation before the operational flow is
settled means designing financial presentation around a cost flow nobody has pinned down.

---

## 1. Where the code actually stands

All six Round-2 slices shipped — and every one of them shipped into the **org** workspace:

| Surface | State |
|---|---|
| `/procurement/*` (org) | Requests, orders, GRN, commitments, suppliers, setup, bill matching. Fully built. |
| `/projects/[id]/procurement` | **One thin page**: a commitments strip, an MR table, and a dashed box linking out to Orders and GRN. |

The project tab's own comment explains the split:

> *"Purchase orders and goods receipts stay in the org buyer workspace — they have no project
> filter server-side and are the cross-project queue by design — so the tab links out for them."*

The second clause is right. The first is a **backend limitation being reported as a product
decision**, and that is what this phase corrects.

---

## 2. The boundary — LOCKED

### B1. The organisation owns supplier documents. The project owns the cost coded onto their lines.

This is not a preference; the schema already says it. `PurchaseOrder` has **no** `projectId`.
Neither does `GoodsReceiptNote`. The project dimension lives one level down, on
`PurchaseOrderLine`, which documents itself:

> *"Cost-target (A3/D7) — the authoritative project cost attribution, **captured once here**. Both
> set = a project-cost-relevant line (boqNode is a leaf cost node on projectId's BOQ); both null =
> a non-project/org/overhead line. Half-specified is rejected by the service. **Downstream (Goods
> Receipt, PO-backed bill, commitment ledger) inherit this read-only.**"*

That is correct modelling. One purchase order legitimately buys cement for three sites, and a GRN
line reaches a project only through its PO line. So:

| Home | Owns |
|---|---|
| **Org `/procurement/*`** | The supplier-facing documents themselves (PO, GRN, bill, payment), the buyer's cross-project queues, `ORGANIZATION`-scope buying, master data (UoM, materials, categories, suppliers), matching and tolerance governance. |
| **Project Procurement tab** | *This project's* **lines** across the spine, its commitment stages, its exceptions, and the BOQ nodes they land on. Every parent document links out to the org workspace. |

**Rejected alternative — project-filtered document lists.** Showing POs that "touch" this project
would put a `$500,000` PO row on a project whose share is `$80,000`. That is the
misleading-money failure class Phase 4 spent its whole effort eliminating; it is not cheaper in
any sense that matters.

### B2. Procurement is lifecycle. Finance is interpretation.

Both tabs surface project cost today and neither says why. Locked:

| Tab | Question it answers | Figures |
|---|---|---|
| **Procurement** | *Where is this cost in its lifecycle, and what must I chase?* | `COMMITTED → ACCRUED → ACTUAL`, on order, received-not-billed, exceptions |
| **Finance** | *What does it mean for margin?* | Forecast cost, forecast margin, project P&L, GL position |

`Actual` and `remaining commitments` appear in both, as **the same server figures** — Finance
consumes them as inputs to forecast. They are labelled as shared inputs so nobody maintains two
answers. Nothing else crosses.

---

## 3. Backend gap map

| Read | Project-scoped today? |
|---|---|
| `GET /procurement/material-requests` | ✅ `projectId` + `scope` |
| `GET /procurement/commitment-ledger/projects/:projectId` (+ `/summary`) | ✅ project-native, filterable by `stage` and `boqNodeId` |
| `GET /projects/:projectId/financial-position` | ✅ project-native |
| `GET /procurement/purchase-orders` | ❌ `status`, `supplierId` only |
| `GET /procurement/goods-receipts` | ❌ `purchaseOrderId` only |
| `GET /bills` | ❌ `supplierId` only |

The project's **money** is already well served. What is missing is **operational visibility** —
*what have I got on order, what has arrived, what is waiting on a bill.*

### The read model should be built on the commitment ledger, not on three new list filters

`CommitmentLedgerEntry` already carries every dimension the pipeline needs, and is indexed for
exactly this query (`@@index([organizationId, projectId, stage])`):

```
projectId · boqNodeId · materialId · supplierId · purchaseOrderId · spendCategoryId
stage (COMMITTED | ACCRUED | ACTUAL)
amount (signed, immutable — reversals are entries, never edits)
sourceDocumentType (PURCHASE_ORDER_REVISION | GOODS_RECEIPT | SUPPLIER_BILL
                    | PO_CANCELLATION | GRN_REVERSAL | BILL_REVERSAL)
sourceDocumentId · sourceLineId · sourceRevision
occurredAt · accountingDate
```

This is the authoritative signed record of cost movement for the project. Deriving the pipeline
from it — then joining out to the source documents for their human references and lifecycle
status — means the tab's figures **cannot** disagree with the Financial Position or the ledger,
because they are the same rows. Adding `projectId` filters to the PO/GRN/bill list endpoints
would create a second, denormalised path to the same numbers.

Proposed: `GET /projects/:projectId/procurement/pipeline`, returning the project's line-level
position by stage with its source documents named, plus the open exceptions.

---

## 4. Lifecycle vocabulary (verified against the schema)

Use these exactly; do not invent intermediate states.

```
MaterialRequestStatus   DRAFT · SUBMITTED · APPROVED · PARTIALLY_ORDERED · FULLY_ORDERED
                        · CANCELLED · CLOSED
PurchaseOrderStatus     OPEN · CLOSED · CANCELLED          (the header)
PurchaseOrderRevision   DRAFT · SUBMITTED · APPROVED · ACTIVE · SUPERSEDED · CANCELLED
QualityStatus           PENDING_INSPECTION · ACCEPTED · PARTIALLY_ACCEPTED · REJECTED
BillDocStatus           DRAFT · SUBMITTED · APPROVED · REJECTED · CANCELLED
BillMatchType           TWO_WAY · THREE_WAY
CommitmentStage         COMMITTED · ACCRUED · ACTUAL
```

Note the PO shape: **the header is only `OPEN/CLOSED/CANCELLED`; the lifecycle lives on immutable
revisions.** A "PO status" column that shows revision state is conflating two records.

`PoReceiptException` is the ADR-022 SoD escape hatch — PO creator receiving their own goods —
gated on `supervisorVerifiedAt` then `cfoApprovedAt`. It is governance evidence, not a workflow
step, and must not read as one.

---

## 5. Open questions before design

1. **Does the project tab get write actions, or is it a read?** Raising an MR is project work;
   creating a PO is a buyer's job. The ADR-020 "Raise requirement" classifier belongs here — but
   whether PO creation is reachable from a project is a role question (Eng Ahmed / ADR-022).
2. **What does a project manager chase first?** Candidates: over-receipt exceptions, received-not-
   billed, out-of-tolerance matches, MRs approved but unordered. The attention list should be
   ordered by what actually stalls a site, not by what is easy to query.
3. **BOQ-node rollup depth.** The ledger keys on `boqNodeId`; the tab could show cost by BOQ node
   against the priced BOQ. That is the ADR-020 payoff, and also the biggest single design
   decision left.
4. **Non-project (overhead) lines.** Both `projectId` and `boqNodeId` null means org/overhead.
   Those are invisible to a project tab by definition — confirm nobody expects to see them there.

## 6. Explicitly out of scope

- **Inventory / issue-to-site.** `ACCRUED`/`ACTUAL` is where procurement stops; consumption→cost
  needs Inventory (Sprint 7, not built). The existing tab flags this honestly and the refined one
  must keep doing so.
- The org `/procurement/*` workspace. Round-2 refined it; this phase does not reopen it.

---

## 7. What was built, and what the review changed

Three views — **Overview · Requirements · Cost & Commitments** — over a ledger-backed read model,
plus `ProjectCostBudget` as a new versioned aggregate.

### The correction that mattered most

The spec assumed a cost budget existed. **It did not** — no `Budget`, `CostBudget` or `CostPlan`
model anywhere, no budget field on `BoqNode`, and `MaterialRequestLine.projectCostCategoryId` was
a dangling column with no model behind it. Every "% of budget" figure and the whole Budget /
Remaining / % Used column set had zero backing data.

`ProjectCostBudget` is therefore new, and **versioned/baselined like the BOQ**: a budget that can
be edited in place is worthless as a control, because the first response to an overrun is to raise
the number and the evidence goes with it. Lines code to a BOQ node **or** a spend category —
exactly one — which is what makes the three-tier model real:

```
BOQ-coded          → rolls up the BOQ hierarchy
project-level      → its own named row (site overhead, transport, insurance)
corporate overhead → no project attribution, never reaches the read model
```

### Vocabulary corrections, before any of it reached a screen

| Was | Now | Why |
|---|---|---|
| `forecastExposure` | `committedNotBilled` | It was not a forecast. It is a ledger fact, present with or without a budget. |
| one `remaining` | `uncommittedBudget` + `budgetLessActual` | Different questions. Budget−actual counts money already on a PO as available; reading it as headroom is how a project overspends a budget it believes it is under. A test asserts they differ. |
| `% used` | `committedOfBudgetPercent`, `actualOfBudgetPercent` | With three stages on the row, an unlabelled ratio is a guess. |
| one MR `status` | `approvalStatus` + `fulfillmentStatus` | Two facts in one enum. Same discipline as PO header vs revision. |
| "Active POs" | `openPoCount` | `PurchaseOrder.status = OPEN` is not a revision reaching ACTIVE. |

### Also added, because the domain required it

`MaterialRequestLine.estimatedUnitPrice`. ADR-022 routes approval by **monetary threshold**, so a
requirement carrying no value could not be routed at all — a governance contradiction, not a UI
gap. Plus `title` and `priority` on the header.

### Design decisions taken during the build

- **Table first, no charts.** A grouped committed-vs-actual bar looks like analysis and answers
  nothing actionable. Supplier and category are ranked tables, not donuts: the question is which
  supplier owns this exposure, answered to the cent.
- **Payment carries a count and no amount.** Settling a bill moves cash, not cost. It is not in
  the commitment ledger, and inferring an amount from ACTUAL would report money as paid that
  nobody paid.
- **No MR attachments.** No attachment model, and file serving is deferred platform-wide.

### Browser QA

`e2e/project-procurement-qa.spec.ts`, run against two real projects — one with a baselined budget
and one without, because the null-versus-zero rule renders as a tidy "0.0%" and is invisible
otherwise. Verified end to end:

| | With budget | Without budget |
|---|---|---|
| `budgetTotal` | `990000.00` | `null` |
| `committedOfBudgetPercent` | `0` (a valid zero) | `null` |
| `uncommittedBudget` | `990000.00` | `null` |

Eight specs pass across 1440/375 × light/dark: zero overflow, zero controls under 44px, zero
console errors, zero 4xx. It caught two defects — a 20px disclosure chevron, and a remainder note
asserting one figure was "larger" than the other, which is false whenever nothing is committed.

## Still open

- **No live cost data.** The ledger is empty on both QA projects, so the rollup, supplier ranking
  and category split are unit-tested but have never rendered populated. Reaching COMMITTED needs
  an approved PO, which needs DOA workflow bindings this tenant lacks.
- **The budget authoring UI.** The API is complete (create / edit draft / baseline, with
  supersede in the same transaction) and the position band links to it, but the editor itself is
  not built — budgets are currently set through the API.
- **`MaterialRequest.title` / `priority` are not yet on the MR create form** in the org
  workspace; the columns read them, and older requests have neither.
