# ADR-007: Sprint 5 — Procurement, AP Integration, and Commitment Control

Status: ACCEPTED
Date: 2026-08-07
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)
Supersedes: Nothing — extends ADR-006 (Accounting Foundation) for Sprint 5 scope.

---

## 1. Context and Problem

Sprint 4 delivered the complete double-entry accounting platform: Chart of Accounts, Fiscal
Years, Journals, AR, AP (SupplierBill + SupplierPayment), General Ledger, Trial Balance,
P&L, Balance Sheet, Period Management, and Year-End Close. The AP foundation is live and
tested. The procurement chain that feeds it does not yet exist.

ACCO Ltd currently manages procurement through informal processes — WhatsApp, Excel, and
direct verbal orders. Materials arrive on site without verified purchase orders. Supplier
invoices are matched manually by the accountant from paper records. Committed cost is not
tracked until the supplier bill arrives. This creates:

- No visibility of open purchasing commitments until goods are already received
- No three-way matching gate before payment
- Project cost reports that only reflect actuals, missing committed and accrued exposure
- No audit trail from site need to supplier payment

Sprint 5 builds the procurement chain that closes these gaps. It also renames and tightly
scopes the sprint based on what was actually resolved vs what was incorrectly listed in the
original roadmap (AP is already built; Variations are a separate bounded scope for Sprint 6).

The correct build order for procurement:

```
Material Request
→ Purchase Order (approved commitment)
→ Goods Receipt (confirmed accrual)
→ Supplier Bill (via existing AP module)
→ Supplier Payment (via existing AP module)
→ CommitmentLedger (COMMITTED → ACCRUED → ACTUAL)
```

---

## 2. Scope and Non-Scope

### Sprint 5 delivers

- `UnitOfMeasure` — org-configurable measurement master
- `MaterialCategory` — operational material classification hierarchy
- `SpendCategory` — financial governance classification hierarchy
- `Material` — org-scoped material catalogue
- `MaterialRequest` + `MaterialRequestLine` — dual-scope (project or organization)
- `PurchaseOrder` + `PurchaseOrderRevision` + `PurchaseOrderLine` — immutable revision model
- `PurchaseOrderLineRequestAllocation` — many-to-many MR line ↔ PO line junction
- `GoodsReceiptNote` + `GoodsReceiptLine` + `GoodsReceiptLineAllocation` — full allocation
- `SupplierBillMatch` + `SupplierBillMatchLine` — explicit matching with audit result
- `MatchingTolerancePolicy` — hierarchical price/quantity/amount variance controls
- `CommitmentLedgerEntry` — immutable signed ledger: COMMITTED → ACCRUED → ACTUAL
- DOA conditional routing — extend `WorkflowRequirementPolicy` with condition expressions
- `OverReceiptPolicy` — configurable tolerance band for goods received above ordered quantity
- `BOQNode.sourceType` and `BOQNode.sourceChangeOrderId?` — variation-readiness preparation
- Supplier Bill Matching integration with existing `SupplierBill` (AP module, Sprint 4)

### Deferred — not in Sprint 5

| Deferred item | Target sprint |
|---|---|
| Variations (ChangeOrderRequest, ChangeOrder, BOQ variation nodes) | Sprint 6 |
| `SupplierReturn` / `GoodsReturn` entity | Sprint 6 |
| `ServiceEntrySheet` for service PO confirmation | Sprint 6 |
| UoM conversion (`UoMConversion` entity) | Sprint 7 (Inventory) |
| Approved Supplier List / Supplier Qualification | Sprint 6 |
| Warehouse management, bin locations, stock transfers | Sprint 7 |
| Inventory valuation and stock ledger | Sprint 7 |
| `SupplierBillLineAllocation` (bill-level allocation) | Sprint 6 |
| Cash Flow Statement | Sprint 9 |

---

## 3. Procurement Domain Boundaries

Procurement is a bounded context that coordinates **operational purchasing** with the
**financial accounting** established in Sprint 4. The boundary rules are:

```
Procurement domain owns:
  MaterialRequest, PurchaseOrder, GoodsReceiptNote, CommitmentLedgerEntry,
  MatchingTolerancePolicy, OverReceiptPolicy, SupplierBillMatch

Accounting domain owns:
  SupplierBill, SupplierPayment, JournalEntry, JournalLine

Shared master data:
  Supplier (created in Sprint 4), UnitOfMeasure, MaterialCategory,
  SpendCategory, Material
```

**Cross-domain rules:**

- Procurement does **not** post to `JournalLine`. Only the AP posting engine does.
- A `SupplierBill` is created from the GRN context by Procurement, but it belongs to the
  AP (Accounting) domain once created. Procurement holds a reference FK; AP owns the record.
- `CommitmentLedger` is a **separate ledger** from the GL. PO approval → CommitmentLedger
  only (no GL journal). Supplier Bill posting → CommitmentLedger ACTUAL + GL JournalEntry.
  These are independent postings on the same business event.
- Procurement does **not** reference `ChangeOrder` or `ChangeOrderRequest`. Those belong to
  the Commercial domain (Sprint 6). Variation traceability flows through `BOQNode.sourceType`
  and `BOQNode.sourceChangeOrderId` — not through procurement-level FKs.

---

## 4. Material Catalogue

### 4.1 UnitOfMeasure

Organization-configurable measurement master. Not a system enum — new UoMs are added
through settings without a code deployment.

```
UnitOfMeasure
  id
  organizationId
  code             unique within org (EA, KG, TON, M3, LM, LS, HR, BAG, ROLL, SET, DAY...)
  name
  nameAr?
  symbol
  status           ACTIVE | INACTIVE
```

**Rule UOM-001:** A UoM referenced by any historical procurement, GRN, or inventory record
must never be deleted. Mark `INACTIVE` instead.

**Rule UOM-002:** Sprint 5 enforces that MATERIAL procurement lines use the material's
`baseUnitOfMeasureId`. No UoM conversion in Sprint 5. Conversion (`UoMConversion` entity)
is deferred to the Inventory sprint.

### 4.2 MaterialCategory

Operational classification of physical items. Used by the material catalogue, inventory
managers, storekeepers, and engineers. Hierarchy supported via `parentCategoryId`.

```
MaterialCategory
  id
  organizationId
  code
  name             e.g. CONCRETE, STRUCTURAL_STEEL, REBAR, ELECTRICAL_CABLE, FINISHING
  nameAr?
  parentCategoryId?
  status
```

### 4.3 SpendCategory

Financial governance classification of expenditure. Used by Finance, DOA routing,
matching tolerance policies, and CommitmentLedger reporting. Hierarchy supported.

```
SpendCategory
  id
  organizationId
  code
  name             e.g. CIVIL_MATERIALS, MEP_MATERIALS, SUBCONTRACTS, EQUIPMENT_HIRE,
                        PROFESSIONAL_SERVICES, GENERAL_OVERHEAD, TRANSPORT
  nameAr?
  parentCategoryId?
  status
```

**Rule CAT-001:** `MaterialCategory` and `SpendCategory` are two separate entities. Do not
merge them. They serve different business audiences and evolve independently.

### 4.4 Material

Organization-scoped catalogue entry. Required before any MATERIAL-type procurement line
can be created.

```
Material
  id
  organizationId
  code                    unique within org
  name
  nameAr?
  description?
  materialCategoryId      FK → MaterialCategory
  defaultSpendCategoryId? FK → SpendCategory (can be overridden on the line)
  baseUnitOfMeasureId     FK → UnitOfMeasure
  status                  ACTIVE | INACTIVE | DISCONTINUED
```

**Rule MAT-001:** A MATERIAL-type procurement line requires `materialId`. A SERVICE or
OTHER-type line does not.

**Rule MAT-002:** Procurement users may override `defaultSpendCategoryId` on a line,
subject to permission `override:spend-category`.

**Rule MAT-003:** Deactivating a Material does not cancel open POs or MRs referencing it.
It only prevents new lines from being created.

### 4.5 ProcurementLineType

All procurement line entities (`MaterialRequestLine`, `PurchaseOrderLine`,
`GoodsReceiptLine`) carry:

```
lineType: MATERIAL | SERVICE | OTHER
```

Rules:

```
lineType = MATERIAL  →  materialId required
                     →  unitOfMeasureId must equal Material.baseUnitOfMeasureId
lineType = SERVICE   →  materialId must be null; free-text description required
                     →  two-way matching applies (no GRN requirement)
lineType = OTHER     →  controlled exceptional use; requires justification
```

---

## 5. Material Request

### 5.1 MaterialRequest

```
MaterialRequest
  id
  organizationId
  mrNumber            document sequence (MR-YYYYMM-NNNNN)
  requestScope        PROJECT | ORGANIZATION
  projectId?          required when requestScope = PROJECT; null when ORGANIZATION
  requestedBy
  requestedDate
  requiredByDate?
  description?
  status              DRAFT | SUBMITTED | APPROVED | PARTIALLY_ORDERED | FULLY_ORDERED
                      | CANCELLED | CLOSED
  approvalInstanceId?
  createdAt / updatedAt
```

**Rule MR-001:** `requestScope = PROJECT` requires `projectId`. Project membership
authorization applies.

**Rule MR-002:** `requestScope = ORGANIZATION` requires `projectId = null`.
`boqNodeId` must be null on all lines. Cost attribution (department/cost center) is
captured at line level and allocated later through the inventory issue or cost accrual.

**Rule MR-003:** MR status `APPROVED` is required before a `PurchaseOrderLineRequestAllocation`
can reference any of its lines.

### 5.2 MaterialRequestLine

```
MaterialRequestLine
  id
  materialRequestId
  lineNumber
  lineType            ProcurementLineType
  materialId?
  description         required for SERVICE/OTHER; optional memo for MATERIAL
  unitOfMeasureId
  requestedQuantity   Decimal
  approvedQuantity?   Decimal (set on approval; may differ from requestedQuantity)
  boqNodeId?          optional — not every project purchase maps to a BOQ node
  spendCategoryId?    overrides Material.defaultSpendCategoryId if set
  departmentId?
  costCenterId?
  projectCostCategoryId?
  notes?
```

**Rule MR-004:** For MATERIAL lines in PROJECT scope, `boqNodeId` is optional. Indirect
project costs (site office, safety equipment, temporary works) are valid without a BOQ node.
Do not enforce BOQ node presence on every MATERIAL line.

**Rule MR-005:** `∑ PurchaseOrderLineRequestAllocation.allocatedQuantity` for a given
`materialRequestLineId` must not exceed `MaterialRequestLine.approvedQuantity` without an
approved over-procurement exception.

---

## 6. Purchase Order and Revision Model

### Decision — Immutable PO Revisions

**Why:** A GRN received against a PO line at $120/unit must always show $120/unit as the
commercial terms that existed at receipt time. If PO lines were mutable, a later revision
to $135/unit would silently rewrite the historical receipt's commercial context — destroying
the audit trail.

**Alternative considered:** Mutable amendment with an amendments sub-table. Rejected
because audit evidence for the accountant reviewing a GRN six months later would require
reconstructing state from amendments rather than reading the immutable line directly.

### 6.1 PurchaseOrder

Stable business identity. Carries the PO number and a pointer to the current active revision.

```
PurchaseOrder
  id
  organizationId
  supplierId          FK → Supplier
  poNumber            document sequence (PO-YYYYMM-NNNNN)
  currentRevisionId?  FK → PurchaseOrderRevision (set after first revision is ACTIVE)
  status              OPEN | CLOSED | CANCELLED
  createdAt / updatedAt
```

### 6.2 PurchaseOrderRevision

One record per revision. Immutable once status = `ACTIVE`.

```
PurchaseOrderRevision
  id
  purchaseOrderId     FK → PurchaseOrder
  revisionNumber      1, 2, 3... sequential within PO
  status              DRAFT | SUBMITTED | APPROVED | ACTIVE | SUPERSEDED | CANCELLED
  currencyCode
  effectiveFrom       date
  reason?             required for revisionNumber > 1
  deliveryAddress?
  expectedDeliveryDate?
  approvedBy?
  approvedAt?
  approvalInstanceId?
  createdAt / updatedAt
```

**Rule PO-001:** Once a revision is `ACTIVE`, its lines are immutable. Any change creates
a new revision. The previous revision is marked `SUPERSEDED`.

**Rule PO-002:** Only one revision may be `ACTIVE` or `DRAFT` at any time per PO.

**Rule PO-003:** If a PO is revised after approval (revisionNumber > 1) and the total amount
change triggers a different DOA approval tier, the new revision must go through approval
before becoming ACTIVE. The approval snapshot records `evaluatedAmount` and
`matchedPolicyVersion`.

### 6.3 PurchaseOrderLine

```
PurchaseOrderLine
  id
  purchaseOrderRevisionId  FK → PurchaseOrderRevision
  lineNumber
  lineType                 ProcurementLineType
  materialId?
  description
  unitOfMeasureId
  orderedQuantity          Decimal
  unitPrice                Decimal
  taxCodeId?
  extendedAmount           Decimal  (orderedQuantity × unitPrice, stored)
  notes?
```

**Rule PO-004:** `PurchaseOrderLine` records are immutable once their revision is `ACTIVE`.
No UPDATE is permitted. Corrections require a new revision.

---

## 7. MR ↔ PO Allocation Model

### Decision — Many-to-Many Lineage

**Why:** A QS consolidating site material requests across three projects into one PO, or
splitting one MR line across two suppliers, requires a junction rather than a strict 1:1
link. Designing 1:1 lineage would force artificial request reshaping for legitimate
operational scenarios.

**Alternative considered:** Strict 1:1 (`PurchaseOrderLine.materialRequestLineId`).
Rejected because it blocks consolidation and split purchasing — both normal in construction.

### 7.1 PurchaseOrderLineRequestAllocation

```
PurchaseOrderLineRequestAllocation
  id
  organizationId
  purchaseOrderLineId       FK → PurchaseOrderLine
  materialRequestLineId     FK → MaterialRequestLine
  allocatedQuantity         Decimal
```

**Rule ALLOC-001:** `∑ allocatedQuantity` grouped by `materialRequestLineId` must not
exceed `MaterialRequestLine.approvedQuantity`. Enforced at service layer with a
`SELECT FOR UPDATE` on the MR line before insert.

**Rule ALLOC-002:** Cost dimensions (projectId, boqNodeId, departmentId, costCenterId)
are sourced from the `MaterialRequestLine` through this allocation — not from the
`PurchaseOrderLine`. A consolidated PO line carries multiple projects' worth of cost
attribution through the allocation chain. The PO line itself carries only the commercial
terms (quantity, price, UoM).

**Rule ALLOC-003:** When the `CommitmentLedger` is written at PO approval, one entry is
created per allocation, carrying the allocation's source MR line dimensions. This preserves
per-project/BOQ cost attribution even for consolidated orders.

---

## 8. Goods Receipt and Allocation

### 8.1 GoodsReceiptNote

```
GoodsReceiptNote
  id
  organizationId
  grnNumber           document sequence (GRN-YYYYMM-NNNNN)
  purchaseOrderId     FK → PurchaseOrder
  purchaseOrderRevisionId  FK → PurchaseOrderRevision (the revision being received against)
  supplierId
  deliveryDate
  deliveryNoteRef?
  status              DRAFT | SUBMITTED | POSTED | EXCEPTION_PENDING | CANCELLED
  exceptionReason?
  postedAt?
  postedBy?
  createdAt / updatedAt
```

### 8.2 GoodsReceiptLine

Records **what physically arrived**, not only what was accepted. This distinction is
mandatory for site audit and supplier dispute resolution.

```
GoodsReceiptLine
  id
  goodsReceiptNoteId
  purchaseOrderLineId       FK → PurchaseOrderLine (specific revision's line)
  lineNumber
  lineType
  materialId?
  unitOfMeasureId
  orderedQuantity           Decimal  (copied from POLine at GRN creation)
  previouslyReceivedQty     Decimal  (from prior GRNs against same POLine)
  receivedQuantity          Decimal  (total physical delivery this GRN)
  acceptedQuantity          Decimal  (passed quality inspection)
  rejectedQuantity          Decimal  (failed quality inspection)
  rejectionReason?
  qualityStatus             ACCEPTED | PARTIALLY_ACCEPTED | REJECTED | PENDING_INSPECTION
  notes?
```

**Invariant GRN-001:** `acceptedQuantity + rejectedQuantity = receivedQuantity`. Enforced
at service layer before GRN is posted.

**Invariant GRN-002:** Rejected goods remain on the GRN as immutable evidence. They are
not removed. Returns are handled via a future `SupplierReturn` entity.

**Rule GRN-003:** Only `acceptedQuantity` moves from `COMMITTED` to `ACCRUED` in the
CommitmentLedger. `rejectedQuantity` keeps the corresponding commitment open (or pending
return/replacement).

### 8.3 GoodsReceiptLineAllocation

Preserves per-allocation attribution for the CommitmentLedger ACCRUED movements. Pre-
populated from the PO allocation ratios when the GRN is created; receiver only adjusts
quantities if the actual delivery distribution differs.

```
GoodsReceiptLineAllocation
  id
  organizationId
  goodsReceiptLineId
  purchaseOrderLineRequestAllocationId
  receivedQuantity       Decimal
  acceptedQuantity       Decimal
  rejectedQuantity       Decimal
```

**Invariant GRNALLOC-001:**
`∑ GoodsReceiptLineAllocation.acceptedQuantity = GoodsReceiptLine.acceptedQuantity`

**Rule GRNALLOC-002:** CommitmentLedger ACCRUED entries are written per
`GoodsReceiptLineAllocation`, not per `GoodsReceiptLine`. This ensures project/BOQ cost
attribution is correct for consolidated POs.

### 8.4 Over-Receipt Policy

```
OverReceiptPolicy
  id
  organizationId
  spendCategoryId?      null = org default
  purchaseOrderId?      null = not PO-specific
  overReceiptPercent    Decimal  (e.g. 5.00 = 5%)
  status
  effectiveFrom
  effectiveTo?
```

Resolution hierarchy: PO-specific → SpendCategory → Organization default.
Missing policy = hard block.

**Rule OVREC-001:** Receipt within tolerance → `COMMITTED +toleranceDelta` compensating
entry written before the `COMMITTED→ACCRUED` movement. Committed balance never goes negative.

**Rule OVREC-002:** Receipt above tolerance → GRN enters `EXCEPTION_PENDING` status.
No commitment movement is effective until the exception is approved or a PO revision is raised.

---

## 9. Supplier Bill Matching

### Decision — Model B: GRN-Prefilled Bill with Explicit Matching Result

**Why:** Allowing accountants to type supplier bills from scratch against paper invoices
without system context produces mismatches in account codes, quantities, and project
attribution. Pre-filling from GRN data preserves the procurement lineage automatically
and reduces data entry errors.

**Matching remains explicit:** A bill prefilled from GRN data still requires a formal
matching result. "Linked by construction" is not the same as "matched." An auditor six
months later must see why the bill was accepted — within tolerance or with an approved
exception.

### 9.1 SupplierBill (updated from Sprint 4)

The existing Sprint 4 `SupplierBill` entity gains:

```
SupplierBill (additions from Sprint 5)
  matchStatus    NOT_RUN | MATCHED | MATCHED_WITH_TOLERANCE | EXCEPTION | APPROVED_EXCEPTION
```

`SupplierBill` **cannot be posted** until:

```
matchStatus IN (MATCHED, MATCHED_WITH_TOLERANCE, APPROVED_EXCEPTION)
```

### 9.2 SupplierBillMatch

```
SupplierBillMatch
  id
  supplierBillId
  matchType           TWO_WAY | THREE_WAY
  status              NOT_RUN | MATCHED | MATCHED_WITH_TOLERANCE | EXCEPTION | APPROVED_EXCEPTION
  matchedAt?
  matchedBy?
  approvedBy?         required if APPROVED_EXCEPTION
  approvedAt?
  approvalReason?
  approvalInstanceId? for large exceptions routed through DOA
```

**Rule MATCH-001:** MATERIAL lines require THREE_WAY matching (PO ↔ GRN ↔ Bill).
SERVICE lines require TWO_WAY matching (PO ↔ Bill). No GRN is needed for services.

**Rule MATCH-002:** Matching tolerance missing from policy = `MATCHING_TOLERANCE_MISSING`
hard block. Never silently allow unlimited variance.

### 9.3 SupplierBillMatchLine

```
SupplierBillMatchLine
  id
  supplierBillMatchId
  supplierBillLineId
  purchaseOrderLineId
  goodsReceiptLineId?
  poQuantity
  receivedQuantity?
  billedQuantity
  poUnitPrice
  billedUnitPrice
  quantityVariance
  priceVariance
  amountVariance
  toleranceResult     WITHIN_TOLERANCE | EXCEPTION
  exceptionReason?
```

### 9.4 MatchingTolerancePolicy

```
MatchingTolerancePolicy
  id
  organizationId
  purchaseOrderId?
  supplierId?
  spendCategoryId?
  priceVariancePercent?
  priceVarianceAbsolute?
  quantityVariancePercent?
  quantityVarianceAbsolute?
  amountVarianceAbsolute?
  effectiveFrom
  effectiveTo?
  status
  approvedBy?
```

Resolution hierarchy: PO-specific → Supplier → SpendCategory → Organization default.

**Rule MATCH-003:** Over-receipt (billedQuantity > receivedQuantity) is a **separate**
control from price variance. Keep quantity and price tolerance policies distinct.

---

## 10. Commitment Ledger

### Decision — Separate Immutable CommitmentLedger

**Why:** Deriving committed/accrued/actual cost at query time by joining PO, GRN, and Bill
tables becomes progressively more complex as revisions, partial GRNs, cancellations, matching
exceptions, and future returns accumulate. The same structural argument that led to the
double-entry GL in Sprint 4 applies to procurement cost tracking: a ledger of signed
movements is auditable, queryable, and correct by construction.

**Alternative considered:** Derived at query time from FK chain. Rejected because:
1. PO revision deltas cannot be correctly represented without traversing revision history
2. Over-receipt compensating entries would be invisible in a pure join
3. Cross-project attribution on consolidated POs requires allocation joins that compound
4. Immutable ledger entries cannot be silently "fixed" — corrections are visible

**Boundary:** `CommitmentLedger` is separate from `JournalLine` (GL). They solve different
problems. A PO approval creates a commitment but no GL journal. A Supplier Bill posting
creates both a commitment ACTUAL entry and a GL JournalEntry.

### 10.1 CommitmentLedgerEntry

```
CommitmentLedgerEntry
  id
  organizationId
  projectId?
  boqNodeId?
  departmentId?
  costCenterId?
  materialId?
  supplierId?
  spendCategoryId?
  stage                COMMITTED | ACCRUED | ACTUAL
  amount               Decimal (signed — positive = increase, negative = decrease)
  currencyCode
  reportingAmount      Decimal (in org base currency)
  exchangeRateSnapshot Decimal
  sourceDocumentType   PURCHASE_ORDER_REVISION | GOODS_RECEIPT | SUPPLIER_BILL
                       | PO_CANCELLATION | GRN_REVERSAL | BILL_REVERSAL
                       | OVER_RECEIPT_ADJUSTMENT | EXCEPTION_APPROVAL
  sourceDocumentId
  sourceLineId?
  sourceRevision?
  eventType
  idempotencyKey       unique — prevents duplicate on retry
  occurredAt
  accountingDate
  createdAt
```

**Rule CL-001:** Entries are immutable. `UPDATE commitment_ledger_entries` is prohibited.
Corrections create compensating entries.

**Rule CL-002:** Every commitment transition records both sides of the movement in the same
database transaction as the triggering business document.

```
PO approved        →  COMMITTED +X   (per allocation, per project/BOQ)
GRN posted         →  COMMITTED -X   (accepted quantity value)
                      ACCRUED   +X
Bill posted        →  ACCRUED   -X
                      ACTUAL    +X
```

**Rule CL-003:** `∑ COMMITTED ≥ 0` at all times per allocation. Use compensating entries
before moving cost downstream rather than allowing negative committed balances.

**Rule CL-004:** PO revision delta (only unfulfilled portion changes):
```
Release Rev 1 remainder:  COMMITTED -(unfulfilled_qty × rev1_unitPrice)
Establish Rev 2 remainder: COMMITTED +(unfulfilled_qty × rev2_unitPrice)
```
Historical receipts are untouched.

**Rule CL-005:** Idempotency key prevents duplicate commitments on retry. Composed of:
`organizationId + eventType + sourceDocumentId + sourceLineId + sourceRevision + stage`

### 10.2 Cost Exposure Report (query template)

```sql
SELECT
  stage,
  projectId,
  boqNodeId,
  SUM(amount) as balance
FROM commitment_ledger_entries
WHERE organizationId = ?
  AND projectId = ?
GROUP BY stage, projectId, boqNodeId
```

Reports become: `COMMITTED = open orders`, `ACCRUED = received not yet billed`,
`ACTUAL = posted bills`. No reconstruction from document joins.

---

## 11. DOA Conditional Routing

### Decision — Extend Existing Workflow Engine with Condition Expressions

**Why:** Procurement DOA is inherently value-based (different approval tiers for different
PO amounts). Creating a separate procurement-specific approval system would fragment the
audit trail and duplicate governance infrastructure. The existing `WorkflowRequirementPolicy`
engine is extended with a generic condition layer that works for procurement and any future
value-conditional approval need.

**Alternative considered:** Procurement-specific `ProcurementApprovalMatrix`. Rejected
because it would create two separate approval audit systems.

### 11.1 WorkflowRequirementPolicy (extensions for Sprint 5)

New fields added to the existing entity:

```
WorkflowRequirementPolicy (additions)
  conditionField     DOCUMENT_AMOUNT | PROJECT_ID | DEPARTMENT_ID
                     | SPEND_CATEGORY | CURRENCY (enum)
  conditionOperator  EQ | NE | GT | GTE | LT | LTE | BETWEEN | IN
  conditionValue     string (serialized — amount in base currency, id, etc.)
  conditionValue2?   string (used for BETWEEN upper bound)
```

Multiple condition rows per policy are AND-combined. Priority resolves ambiguity.

### 11.2 ApprovalInstance (extensions for Sprint 5)

Immutable snapshot of why this approval chain was selected:

```
ApprovalInstance (additions)
  evaluatedAmount      Decimal  (transaction amount in base currency at submission)
  reportingCurrencyCode string
  matchedPolicyId      cuid
  matchedPolicyVersion int
  conditionSnapshot    JSON   (the condition values at evaluation time)
```

**Rule DOA-001:** Threshold comparison uses the **reporting/base currency equivalent**
(USD for ACCO). Exchange rate is snapshotted at submission. This prevents inconsistency
when a PO is denominated in a foreign currency.

**Rule DOA-002:** If a PO revision changes the amount in a way that would trigger a
different DOA tier, approval is invalidated. The revised PO must be resubmitted.

**Rule DOA-003:** If multiple policies match at the same precedence level:
`WORKFLOW_POLICY_AMBIGUOUS` — hard block, no submission. Never silently pick a policy.

**Resolution precedence:** PO-specific override → SpendCategory → Project → Organization default.

**Actual threshold values:** Architecture locked. Specific dollar thresholds and approver
chains are pending confirmation from Eng Ahmed Shirie and ACCO's financial officer. Do not
hardcode values in the application — they must be configurable through `WorkflowRequirementPolicy`.

---

## 12. Matching and Over-Receipt Policies

### Over-receipt tolerance

```
Ordered: 100 bags
Tolerance: 5%

≤ 105 bags received  →  warning + COMMITTED compensating entry + COMMITTED→ACCRUED movement
> 105 bags received  →  GRN_EXCEPTION_PENDING; no commitment movement until resolved
```

### Three-way matching threshold

MATERIAL lines: PO ↔ GRN ↔ Bill. All three must be linked and within tolerance.
SERVICE lines: PO ↔ Bill only. No GRN requirement.

### Tolerance resolution

```
PO-specific override
→ Supplier-specific policy
→ SpendCategory policy
→ Organization default
```

Missing policy at the end of resolution = hard block.

Separate controls:
- `quantityVariancePercent` / `quantityVarianceAbsolute` — received vs billed quantities
- `priceVariancePercent` / `priceVarianceAbsolute` — PO unit price vs bill unit price
- `amountVarianceAbsolute` — extended amount (catches rounding not caught by separate checks)

---

## 13. UoM and Classification

### UoM invariants

- MATERIAL lines: `procurementLine.unitOfMeasureId = Material.baseUnitOfMeasureId`
- No conversion in Sprint 5. `UoMConversion` deferred to Sprint 7.
- `UnitOfMeasure.status = INACTIVE` on any UoM with historical references — never delete.

### Classification invariants

- `MaterialCategory` and `SpendCategory` are **two separate entity tables**. No merge.
  Do not reintroduce a single `ProcurementCategory` table.
- `Material.defaultSpendCategoryId?` provides a default; procurement lines may override
  subject to permission `override:spend-category`.
- SERVICE lines: `materialId = null`, `spendCategoryId` required.
- MATERIAL lines: `materialId` required, `spendCategoryId` sourced from Material default
  or line override.

---

## 14. AP Integration

Procurement integrates with the Sprint 4 AP module at the Supplier Bill layer:

```
GoodsReceiptNote (Procurement)
  → Finance creates SupplierBill (AP)
  → System pre-fills from GRN/PO context
  → Accountant validates against paper invoice
  → Matching engine runs: SupplierBillMatch + SupplierBillMatchLine created
  → If MATCHED or MATCHED_WITH_TOLERANCE: bill proceeds to approval and posting
  → If EXCEPTION: blocked until approved or PO revised
  → Bill posted: AP JournalEntry created + CommitmentLedger ACTUAL entry written
```

The `SupplierBill.purchaseOrderId` (nullable FK added in Sprint 4 in anticipation of this)
is populated at bill creation time. `SupplierBillLine.purchaseOrderLineId` identifies the
specific revision line.

`SupplierBill` record ownership: once created, belongs to the Accounting/AP domain.
Procurement holds a reference but does not own or modify it after creation.

**Rule AP-001:** `SupplierBill` posting is blocked if `matchStatus NOT IN (MATCHED,
MATCHED_WITH_TOLERANCE, APPROVED_EXCEPTION)`. This gate is enforced in the AP posting
service, not in the Procurement module.

---

## 15. BOQ and Project Cost Traceability

### Traceability chain

```
CommitmentLedgerEntry
  → sourceLineId (GoodsReceiptLineAllocationId or PurchaseOrderLineRequestAllocationId)
  → GoodsReceiptLineAllocation.purchaseOrderLineRequestAllocationId
  → PurchaseOrderLineRequestAllocation.materialRequestLineId
  → MaterialRequestLine.boqNodeId (if present)
  → BOQNode (project cost node)
```

This chain allows a cost control report to answer: "How much of our committed and accrued
cost on BOQ node X came from which supplier orders?"

### BOQNode variation readiness (Sprint 5 preparation)

Add to `BOQNode` (existing entity):

```
BOQNode (additions)
  sourceType          BASELINE | VARIATION  (default BASELINE)
  sourceChangeOrderId? cuid? (null until Variations sprint adds ChangeOrder)
```

**Rule BOQ-001:** Procurement must not assume `sourceType = BASELINE`. When displaying a
BOQ node to a procurement user in Sprint 5, treat `sourceType = VARIATION` as valid even
though `ChangeOrder` does not yet exist. The FK is nullable and will be populated in Sprint 6.

**Rule BOQ-002:** There is no `changeOrderId` field on `MaterialRequestLine`,
`PurchaseOrderLine`, `GoodsReceiptLine`, or `CommitmentLedgerEntry`. Variation cost
traceability flows through the BOQ node's provenance, not through duplicate cross-domain FKs.

---

## 16. Deferred Variations

The original Sprint 5 roadmap entry listed "Variations / Change Orders" in scope. This is
formally deferred to Sprint 6 for these reasons:

1. Sprint 5 already carries substantial scope: Material Catalogue, MR, PO revisions,
   MR↔PO allocation, GRN allocation, matching, tolerance policies, CommitmentLedger,
   and DOA conditional routing. Building both simultaneously increases the risk that
   procurement and variation workflows destabilize each other.

2. Variations require: `ChangeOrderRequest`, `ChangeOrderPricing`, `ChangeOrder`,
   `Contract` value adjustment, BOQ version integration, and IPA/IPC commercial impact.
   That is a bounded domain by itself.

3. Because Procurement already understands `boqNodeId`, and BOQNode will carry
   `sourceType = VARIATION` and `sourceChangeOrderId` from Sprint 5, Procurement
   automatically inherits variation traceability when Sprint 6 adds ChangeOrder entities.
   No procurement redesign will be required.

---

## 17. Invariants and Database Constraints

| Rule | Invariant |
|---|---|
| UOM-001 | UoM with historical references → INACTIVE only, never delete |
| UOM-002 | MATERIAL lines: procurementLine.uomId = Material.baseUomId |
| CAT-001 | MaterialCategory and SpendCategory are separate tables — no merge |
| MAT-001 | MATERIAL lineType requires materialId |
| MR-001 | requestScope = PROJECT requires projectId |
| MR-002 | requestScope = ORGANIZATION requires projectId = null and boqNodeId = null |
| MR-005 | ∑ POLineRequestAllocation.qty ≤ MRLine.approvedQty (per MRLine) |
| PO-001 | PO lines are immutable once revision is ACTIVE |
| PO-002 | Only one ACTIVE or DRAFT revision per PO at a time |
| ALLOC-001 | ∑ allocatedQty per MRLine ≤ MRLine.approvedQty |
| GRN-001 | acceptedQty + rejectedQty = receivedQty |
| GRNALLOC-001 | ∑ GRNAllocation.acceptedQty = GRNLine.acceptedQty |
| OVREC-001 | Committed balance never goes negative — compensating entry before movement |
| MATCH-001 | MATERIAL → THREE_WAY; SERVICE → TWO_WAY |
| MATCH-002 | Missing tolerance policy = hard block, not silent pass |
| CL-001 | CommitmentLedgerEntry is immutable — no UPDATE |
| CL-002 | Both sides of every transition written in one transaction |
| CL-003 | ∑ COMMITTED ≥ 0 per allocation at all times |
| DOA-001 | Threshold comparison uses base currency equivalent |
| DOA-002 | PO revision that changes DOA tier → approval invalidated |
| DOA-003 | Ambiguous policy → WORKFLOW_POLICY_AMBIGUOUS hard block |
| BOQ-001 | Procurement accepts sourceType = BASELINE or VARIATION |
| BOQ-002 | No changeOrderId on procurement lines — variation traces through BOQ node |
| AP-001 | SupplierBill posting blocked unless matchStatus clears |

---

## 18. State Machines

### MaterialRequest status

```
DRAFT
  ↓ submit
SUBMITTED
  ↓ approve          ↓ reject → back to DRAFT
APPROVED
  ↓ as PO allocations are created:
PARTIALLY_ORDERED    (some lines have PO allocations, some do not)
  ↓ all lines fully allocated:
FULLY_ORDERED
  ↓ all GRNs complete:
CLOSED
```

`CANCELLED` reachable from `DRAFT`, `SUBMITTED`, `APPROVED`, `PARTIALLY_ORDERED`.
Not from `FULLY_ORDERED` or `CLOSED`.

### PurchaseOrderRevision status

```
DRAFT → SUBMITTED → APPROVED → ACTIVE
                  → REJECTED → (new DRAFT revision)

ACTIVE → SUPERSEDED  (when next revision becomes ACTIVE)

DRAFT/SUBMITTED → CANCELLED
```

Only one `ACTIVE` or `DRAFT` revision per PO at any time.

### GoodsReceiptNote status

```
DRAFT → SUBMITTED → POSTED
                  → EXCEPTION_PENDING → POSTED (after exception approved)
                                     → CANCELLED

DRAFT/SUBMITTED → CANCELLED
```

`POSTED` is terminal — no edits. Corrections via compensating GRN or SupplierReturn.

### SupplierBillMatch status

```
NOT_RUN → MATCHED
        → MATCHED_WITH_TOLERANCE
        → EXCEPTION → APPROVED_EXCEPTION
                    → (block posting until resolved)
```

---

## 19. Atomicity Requirements

Each of the following must complete in a **single database transaction**:

| Business event | Must include atomically |
|---|---|
| PO Revision approved → ACTIVE | Revision status update + CommitmentLedger COMMITTED entries per allocation |
| PO Revision superseded | Old revision SUPERSEDED + CommitmentLedger delta entries (release old, establish new) |
| GRN posted | GRN status POSTED + GRNLine acceptedQty + CommitmentLedger COMMITTED→ACCRUED per allocation |
| GRN exception approved | GRN status POSTED + over-receipt compensating COMMITTED entry + ACCRUED entries |
| SupplierBill posted | AP JournalEntry + CommitmentLedger ACCRUED→ACTUAL per allocation |
| PO cancelled | PO status CANCELLED + CommitmentLedger COMMITTED reversal entries |

---

## 20. Test Matrix and Definition of Done

Sprint 5 is **not accepted** based on TypeScript compilation alone. All of the following
must pass before acceptance:

### Procurement chain integration test

```
Create Material → Create MR (PROJECT scope) → Approve MR
→ Create PO Rev 1 against MR allocations → Approve PO → ACTIVE
→ Verify CommitmentLedger: COMMITTED per allocation (one per project/BOQ node)
→ Create GRN (partial receipt, 80%) → Post GRN
→ Verify CommitmentLedger: COMMITTED reduced, ACCRUED created for accepted quantity
→ Create Supplier Bill from GRN → Run matching → MATCHED
→ Post Supplier Bill
→ Verify CommitmentLedger: ACCRUED → ACTUAL
→ Verify GL JournalEntry created with correct debit/credit
→ Verify SupplierBillMatch.status = MATCHED
```

### PO revision integration test

```
PO Rev 1 approved (100 × $120 = $12,000 COMMITTED)
GRN: 40 units received and accepted
  → COMMITTED -$4,800, ACCRUED +$4,800
PO Rev 2 approved (remaining 60 units × $135)
  → COMMITTED delta: release $7,200, establish $8,100
Verify: COMMITTED = $8,100, ACCRUED = $4,800, ACTUAL = $0
```

### Consolidation + allocation test

```
MR-A (Project A, BOQ-1): 200 bags
MR-B (Project B, BOQ-2): 150 bags
MR-C (Project C): 100 bags (no BOQ node)
PO consolidated: 450 bags, unit price $10
Verify CommitmentLedger at PO approval:
  Project A / BOQ-1  COMMITTED +$2,000
  Project B / BOQ-2  COMMITTED +$1,500
  Project C          COMMITTED +$1,000
GRN: 450 bags received and accepted, allocated by project
Verify ACCRUED entries match per-project allocation
```

### Matching invariants

- MATERIAL lines: posting blocked if matchStatus ≠ MATCHED/MATCHED_WITH_TOLERANCE/APPROVED_EXCEPTION
- Missing tolerance policy → hard block, not silent pass
- Exception approval logged with approver, reason, and timestamp

### Over-receipt tests

- 5% tolerance: 104 bags accepted → warning + compensating COMMITTED entry + ACCRUED movement
- 106 bags: GRN → EXCEPTION_PENDING; no ledger movement until resolved

### Organization isolation

- All CommitmentLedger queries must filter on `organizationId`
- Cross-org data access is a security violation — every repository method enforces org scope

### DOA conditional routing

- PO < threshold-low → routes to correct approver
- PO ≥ threshold-high → routes to CFO/CEO chain
- PO revision crossing tier → approval invalidated, resubmission required
- Ambiguous policy → hard block

### Accounting invariants (unchanged from Sprint 4)

- 87/87 Sprint 4 tests continue passing
- ∑ CommitmentLedger per allocation never goes negative committed

---

## Relationship to Other ADRs

| ADR | Relationship |
|---|---|
| ADR-001 (Platform) | Auth, multi-tenancy, RBAC patterns — unchanged |
| ADR-002 (Construction) | BOQ, Project, Contract — extended with sourceType on BOQNode |
| ADR-003 (Sprint 1) | DOA engine — extended with condition expressions |
| ADR-004 (Sprint 2 corrections) | BOQ versioning pattern — followed by PO revisions |
| ADR-005 (Sprint 3) | IPC, PaymentReceipt — CommitmentLedger is separate from these |
| ADR-006 (Sprint 4) | Accounting Foundation — CommitmentLedger is separate from JournalLine |
| ADR-007 (this) | Sprint 5 Procurement — superseded by Sprint 6 when Variations are built |
