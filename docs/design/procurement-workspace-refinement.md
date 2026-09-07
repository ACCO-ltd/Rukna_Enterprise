# Procurement workspace — refinement (Phase 5)

Status: **FROZEN 2026-09-06.**

```
Domain boundary                FROZEN
Budget model                   COMPLETE   (ProjectCostBudget — NEW in Phase 5)
Cost attribution               COMPLETE
BOQ / project-level rollup     COMPLETE
Overview                       COMPLETE
Requirements                   COMPLETE
Cost & Commitments             COMPLETE
Committed E2E                  PASS
Accrued E2E                    PASS
Actual E2E                     DEFERRED TO ACCOUNTING CONFIG
Responsive / dark              PASS
RBAC                           PASS
PO / revision semantics        PASS
Null-vs-zero semantics         PASS
```

955 API tests, 1729 web tests, 9 browser specs across two projects.
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

---

## 8. `ProjectCostBudget` is NEW in Phase 5, not legacy

Stated plainly so nobody later reads it as pre-existing behaviour and reasons from it the way this
phase's own spec did. **There was no cost budget model in this codebase before Phase 5.** No
`Budget`, `CostBudget` or `CostPlan` aggregate, no budget field on `BoqNode`; the only hint —
`MaterialRequestLine.projectCostCategoryId` — was a dangling column with no model behind it. Every
"% of budget" figure in the source design had nothing under it.

### What a budget line actually supports

**One total per BOQ node. There is no category-level budgeting inside a BOQ item.**

```
boqNodeId  XOR  spendCategoryId          ← enforced in the service, both/neither refused

BOQ node 002 Substructure → $600,000                                    ✅ supported
BOQ node 002 → Materials $300k · Labour $200k · Equipment $100k         ❌ NOT supported
```

This is recorded because the earlier aspirational model assumed the richer shape, and no UI may
imply it. Two places obey the distinction and say so in code:

- **The category breakdown carries no budget column.** Only project-level lines are
  category-coded, so a budget column would populate for those rows and blank for every BOQ-coded
  one — reading as missing data rather than as the model boundary it is.
- **Committed / accrued / actual are never summed.** They are stages of one cost's recognition,
  and no "total exposure" metric exists anywhere in the read model or the UI.

If category-level BOQ budgeting is ever wanted, it is a schema change and an ADR, not a UI feature.

## 9. Budget authoring belongs to Cost Control, not Procurement

**Decided 2026-09-05, before building the editor.** `ProjectCostBudget` is broader than a
supplier-document workflow: procurement contributes one family of cost events (`PO → COMMITTED`,
`GRN → ACCRUED`, `Bill → ACTUAL`), while a project budget must eventually also cover labour,
equipment, internal transport, payroll allocation, site overhead and rework.

```
PROJECT COST CONTROL (Finance)     PROJECT PROCUREMENT
owns                               consumes
  cost budget authoring              the baselined budget
  versions, baseline, revision       the procurement ledger
  budget-vs-actual control           its exposure against that budget
```

So Procurement links out — `No cost budget baselined → Open Cost Control` — rather than becoming
the owner of budgeting, which would mean moving a mature editor later.

The Finance workspace is the likely home, evolving from today's single financial-position screen
toward `Overview · Cost Control · Project P&L · Ledger`, subject to its own audit.

---

## 10. Project-level cost is spendable (2026-09-06)

The model was inconsistent on delivery: a budget line could target a project spend category, but
a PO line demanded a project and a BOQ node together or neither — so those budgets could never be
consumed. **A budget category that can never receive actual cost is a reporting artefact, not a
cost control.** Resolved in favour of making it spendable.

The symmetric rule is replaced by two narrower invariants:

```
boqNodeId requires projectId          a node lives on a project's BOQ
projectId requires a cost target      a BOQ node, or a spend category
```

giving three valid attributions and two named-separately impossible ones:

| | projectId | boqNodeId | spendCategoryId |
|---|---|---|---|
| Corporate / non-project | null | null | — |
| **Project-level (non-BOQ)** | set | null | **required** |
| BOQ-coded project cost | set | set | optional |
| *invalid* — `BOQ_NODE_WITHOUT_PROJECT` | null | set | — |
| *invalid* — `PROJECT_WITHOUT_COST_TARGET` | set | null | null |

The last rule matters: a project with no target is an unclassified suspense bucket nobody
reconciles, and there is deliberately no such thing here.

This is not a procurement convenience. A construction BOQ is the **contractual measured scope**,
not the complete internal cost structure — site security, temporary utilities, transport,
insurance, supervision, fuel and permits are real project cost with no BOQ line to charge. The old
rule left only two options, an invented "Site overhead" BOQ node or losing real cost into
corporate overhead, and both corrupt the client-scope-versus-internal-cost distinction the BOQ
exists to draw.

Capture-once is unchanged: the PO line stays authoritative and the goods receipt, bill and ledger
inherit read-only. The ledger already carried `spendCategoryId`, so the rollup is deterministic
rather than inferred later:

```
boqNodeId              → BOQ hierarchy
projectId + category   → Project-level (non-BOQ), broken into named child rows
neither                → corporate, never reaches a project view
```

Proven through the real governed chain — two purchase orders category-coded with no BOQ node,
each through its approval band and a posted receipt:

```
Project-level (non-BOQ)   budget 390,000   committed 8,400   accrued 24,600
  Transport               budget 120,000   committed 8,400   accrued 12,600
  Site overhead           budget 180,000   committed     0   accrued 12,000
  Insurance               budget  90,000   committed     0   accrued      0
```

Insurance — budgeted, nothing bought — is the row that proves the budget is consumable.

## 11. What the browser gate now pins

Nine specs across 1440/375 × light/dark, on two projects (one budgeted, one not):

- no baselined budget → the absence is stated and **every** percentage is gone, not zeroed;
- with a budget → each ratio names its own numerator, and the two remainders are stated apart;
- project-level cost expands into its named categories — the assertion that stops it silently
  reverting to a budget-only artefact;
- **no PO, GRN, bill or payment authoring exists** anywhere in the project surface;
- the requirement panel has Details / Items / Purchase orders and **no History or Attachments**,
  because neither has anything real behind it.

## 12. Deferred, deliberately

- **`ACTUAL` waits on GL posting.** `PO → COMMITTED, GRN → ACCRUED, GL-posted bill → ACTUAL` is
  financially defensible and stays that way. Do not move ACTUAL earlier to make a dashboard
  populate. Once the accounting foundation is configured, run one bill end to end and verify
  actual by BOQ, actual by project-level category, supplier ranking and the ledger entry.
- **Budget authoring UI** → Cost Control (see §9).
- **History tab** → returns when a resource-scoped audit read exists.
- **QA data hygiene.** The fixture runs left 21 purchase orders on the office-building project.
  Deterministic, identifiable, disposable — worth `qa:seed` / `qa:reset` before Finance QA starts
  mutating ledgers.
