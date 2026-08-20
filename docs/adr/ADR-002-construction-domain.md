# ADR-002: Construction Domain Decisions

Status: ACCEPTED
Date: 2026-07-30
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)
Domain Source: ACCO Ltd Business Process Discovery Document, July 2026

---

## Context

These decisions define how the Construction & Contracting module is modeled. They were reached through detailed discovery of ACCO Ltd's workflows covering estimation, BOQ, procurement, site execution, billing, and job costing.

---

## Decision 1 — Root Entity

**Chosen: Project is the root entity. Everything in construction hangs from a Project.**

A Project always exists independently. A Contract is optional and attached when there is a formal client agreement. This handles all three of ACCO's project types without workarounds:

- Client projects → Project + Contract
- Internal capital projects → Project only (no client Contract)
- Joint-venture projects → Project + Contract (with JV partner flag)

**Constraint CONST-001:** A Contract may not exist without a parent Project. A Project may exist without a Contract.

**Constraint CONST-002:** Project type must be one of: `CLIENT`, `INTERNAL`, `JOINT_VENTURE`. This field is immutable after project creation unless an ADR approves a change process.

---

## Decision 2 — BOQ / Work Breakdown Structure

**Chosen: Option D — Configurable Hierarchical Tree (self-referential node structure).**

The BOQ is stored as a tree of `BOQNode` records. Each node has a `parent_id` (self-referential). Leaf nodes (type `ITEM`) carry quantity, unit, rate, and amount. Branch nodes (type `GROUP`) carry only descriptive fields; their totals are computed from children.

Each organization configures its maximum tree depth and level names. Construction defaults to 3 levels: Division → Section → Item.

```
BOQNode
  id, parent_id, project_id
  type: GROUP | ITEM
  code, name, name_ar
  unit, quantity, unit_rate, total_amount   -- ITEM only
  measurement_method: QUANTITY | PERCENTAGE | MILESTONE  -- ITEM only
  depth, path   -- computed, for ordering and efficient queries
  sort_order
```

**Why:** A fixed 3-level structure would require rebuilding the BOQ module for every new vertical (manufacturing BOM, real estate unit breakdown, consulting phase/deliverable). One tree model serves all.

**Constraint CONST-BOQ-001:** BOQ structure changes after contract award require a formal Variation Order. The baseline BOQ is locked at award.

**Constraint CONST-BOQ-002:** `path` and `depth` are computed fields updated on every insert/move. They must never be manually edited.

**Constraint CONST-BOQ-003:** Deleting a BOQ node that has actual costs or progress records posted against it is prohibited. It must be deactivated instead.

---

## Decision 3 — Cost Tracking (Job Costing)

**Chosen: Option C — Hybrid. Cost Categories cross-cut BOQ Items.**

Each BOQ Item (leaf node) has a budget broken down by Cost Category. Actual costs post against BOQ Item + Cost Category. This gives management variance visibility at two dimensions simultaneously.

Standard Cost Categories:
- `MATERIAL`
- `LABOUR`
- `EQUIPMENT`
- `SUBCONTRACT`
- `TRANSPORT`
- `OVERHEAD`
- `PRELIMINARIES`
- `PROFESSIONAL_FEES`
- `PERMITS`
- `INSURANCE`
- `REWORK`
- `WASTAGE`
- `CLAIMS`

```
BOQCostBudget
  boq_node_id, cost_category, budgeted_amount, currency_code
```

**Constraint CONST-COST-001:** Every cost transaction (material issue, labour timesheet, equipment log, subcontract certificate, supplier invoice) must carry a `boq_node_id` and `cost_category` before it can be posted to the project cost ledger.

**Constraint CONST-COST-002:** Cost categories are defined at the platform level and cannot be deleted by individual organizations. Organizations may hide unused categories.

---

## Decision 4 — Progress Measurement

**Chosen: Option D — All three measurement methods available per BOQ Item.**

Each BOQ Item (leaf node) is configured with one measurement method at BOQ creation:

| Method | How progress is entered | % complete formula |
|---|---|---|
| `QUANTITY` | Site Engineer enters completed qty today | completed_qty / total_qty |
| `PERCENTAGE` | PM/QS enters % complete estimate | entered value |
| `MILESTONE` | Item is marked done/not done | 0% or 100% |

`QUANTITY` is the default and the most auditable. `PERCENTAGE` is available for lump-sum items. `MILESTONE` is for handover and administrative items.

**Constraint CONST-PROG-001:** Progress entries must reference an approved Daily Progress Report. Standalone progress entries without a parent DPR are rejected.

**Constraint CONST-PROG-002:** Progress cannot exceed 100% on any BOQ Item. The system must validate this at entry.

**Constraint CONST-PROG-003:** Progress records are immutable once the DPR is approved. Corrections require a new DPR entry referencing the corrected item.

> **Extended by ADR-021 (proposed).** `CONST-PROG-001/002/003` above stand unchanged. ADR-021 adds
> `CONST-PROG-004…016` (the professional control model: BOQ→WorkPackage→Activity, weighted physical
> progress, Baseline/Forecast/Actual separation, excess-classification, the commercial firewall). It
> **reuses** the `measurementMethod` table above rather than inventing a parallel one.

---

## Decision 5 — Inventory / Stock Management

**Chosen: Option B — Immutable Ledger Model.**

Every stock movement is written as a permanent, timestamped `StockLedger` record. Records are never edited or deleted. Current balance = sum of all ledger entries for a location + material combination.

```
StockLedger
  id, posted_at, location_id, material_id
  transaction_type: RECEIPT | ISSUE | TRANSFER_OUT | TRANSFER_IN |
                    RETURN_TO_STORE | RETURN_TO_VENDOR | WASTAGE |
                    THEFT_LOSS | SCRAP | ADJUSTMENT
  quantity, unit_cost, total_value, currency_code
  reference_doc_type, reference_doc_id
  project_id, boq_node_id, cost_category
  posted_by, approved_by
  notes
```

**Why:** This directly solves ACCO's material tracking problem. Every discrepancy is traceable to a specific entry, person, and document. This is how financial accounting works — you post journal entries, never edit balances.

**Constraint CONST-INV-001:** StockLedger records are immutable. No UPDATE or DELETE is permitted on StockLedger after posting. Corrections are made by posting a reversing entry.

**Constraint CONST-INV-002:** Every `ISSUE` entry must reference an approved Material Issue Request. Issues without an approved MIR reference are rejected.

**Constraint CONST-INV-003:** Material transfers between locations require an approved Stock Transfer document. In-transit stock is tracked until the receiving location confirms.

---

## Decision 6 — Client IPC (Interim Payment Certificate) Generation

**Chosen: CEO Option D — IPC auto-generated from multiple approved source documents. Frozen on approval. Corrections via next IPC or variation order.**

An IPC draft is auto-generated by the system aggregating quantities from four types of approved source documents:

1. Daily Progress Reports (DPR)
2. Inspection and Test Reports (ITR)
3. Measurement Sheets
4. Work Completion Records

A BOQ quantity is only billable if it is supported by ALL required document types for that item. The system shows the minimum certified quantity across all supporting documents.

```
IPC
  id, project_id, contract_id, ipc_number (sequential)
  period_from, period_to
  status: DRAFT | SUBMITTED | APPROVED | FROZEN
  total_gross, retention_amount, advance_recovery, tax_amount, net_payable
  frozen_at, frozen_by
  currency_code

IPCLine
  ipc_id, boq_node_id
  total_qty, unit_rate
  previously_certified_qty, previously_certified_amount
  this_certificate_qty, this_certificate_amount
  cumulative_qty, cumulative_amount
```

Once the IPC passes the full approval chain, status becomes `FROZEN`. A frozen IPC is permanent and immutable. Any adjustment must go through the next IPC or a formal Variation Order.

Retention, advance recovery, and applicable taxes are calculated automatically from the Contract terms on every IPC.

**Constraint CONST-IPC-001:** A frozen IPC may never be edited. Attempts to modify a frozen IPC must be rejected by the API with a clear error.

**Constraint CONST-IPC-002:** IPC numbers are sequential per contract and must never have gaps. The system assigns the number at the point of FROZEN status.

**Constraint CONST-IPC-003:** The IPC line quantities must never exceed the approved BOQ quantities for that item unless a Variation Order has increased the scope.

---

## Decision 7 — Commitment Accounting (Three-Stage)

**Chosen: Option C — Three-stage: Committed → Accrued → Actual.**

Every purchase goes through three financial stages:

```
Stage 1: PO Approved     → CostLedger entry: COMMITTED    $X
Stage 2: GRN Posted      → CostLedger entry: ACCRUED      $X  (COMMITTED closes)
Stage 3: Invoice Matched → CostLedger entry: ACTUAL        $X  (ACCRUED closes)
```

The project cost report always shows four columns per BOQ Item + Cost Category:
`Budget | Committed | Accrued | Actual | Remaining`

**Why:** This eliminates the "surprise cost hit" problem where a project looks healthy until a large delivery arrives. Management sees true exposure from the moment a PO is approved.

**Constraint CONST-COMMIT-001:** Approved POs must trigger a COMMITTED cost entry in the CostLedger on the same transaction. This is not optional.

**Constraint CONST-COMMIT-002:** GRN posting must close the matching COMMITTED entry and open an ACCRUED entry atomically (within one database transaction).

**Constraint CONST-COMMIT-003:** Invoice matching must close the ACCRUED entry and open an ACTUAL entry atomically.

---

## Decision 8 — Revenue Recognition

**Chosen: Option C — Percentage of Completion (POC), configurable per project.**

Revenue for each project is recognized using the POC method by default:

```
Recognized Revenue = Contract Value × % Complete (physical progress)
WIP Asset          = Recognized Revenue − Billed Amount  (if positive)
Over-billing       = Billed Amount − Recognized Revenue  (if positive)
```

The method is configurable per project for cases where a different approach is contractually required (e.g., billing basis for short lump-sum contracts).

**Constraint CONST-REV-001:** The revenue recognition method is set at contract award and requires a formal change process (DOA approval) to modify after the first IPC is issued.

**Constraint CONST-REV-002:** WIP and over-billing positions must be calculated and available in the monthly project P&L report.

**Constraint CONST-REV-003:** Expected losses on a project (when forecast-at-completion exceeds contract value) must be recognized immediately in full when identified.
