# Construction Domain Model

Version: 2.0.0
Status: Active
Last Updated: 2026-08-02
Changes: ADR-004 corrections applied — lifecycle, aggregate boundaries, BOQ versioning,
         StockLedger nullability, CostLedger cost objects, OrganizationMembership.

---

## Aggregate Boundaries

`Project` is the central business scope and reporting root. It is **not** a DDD
God Aggregate. The following are each independent aggregate roots:

```
Project                    Aggregate root — lifecycle, membership, metadata
Contract                   Aggregate root — references projectId
BOQ + BOQVersion           Aggregate root — references projectId
PurchaseOrder              Aggregate root — references projectId
GoodsReceiptNote           Aggregate root — references projectId
MaterialRequest            Aggregate root — references projectId
StockTransfer              Aggregate root
IPC                        Aggregate root — references projectId, contractId
Subcontract                Aggregate root — references projectId
DailyProgressReport        Aggregate root — references projectId
ProjectSuspension          Event record   — references projectId
```

Cross-aggregate communication occurs through public interfaces and domain events.
No aggregate may directly modify the internal state of another.

---

## Entity Map

```
Organization
│
├── OrganizationMembership (users in this org)
│   └── OrganizationMembershipRole
│
├── Users, Roles, Permissions
├── ProjectRole (org-configurable project role catalogue)
├── WorkflowDefinition (DOA approval chains per transaction type)
├── WorkflowTriggerBinding (trigger event → workflow mapping)
├── ExchangeRate (currency × date → rate)
│
└── Project  ◄── BUSINESS SCOPE ROOT (not a DDD God Aggregate)
    │
    ├── ProjectSuspension (active suspension record — separate from lifecycle)
    ├── ProjectMember
    │   └── ProjectMemberRole
    │
    ├── Contract (optional — client projects only)
    │   ├── Milestone
    │   ├── RetentionTerms
    │   ├── AdvanceTerm
    │   ├── Guarantee
    │   └── Variation / ChangeOrder
    │
    ├── Subcontract (many per project) [separate aggregate]
    │   ├── SubcontractScope (BOQ lines awarded to sub)
    │   └── SubcontractCertificate (frozen on approval)
    │
    ├── BOQ [separate aggregate]
    │   ├── BOQVersion (DRAFT | BASELINED | SUPERSEDED | CANCELLED)
    │   │   └── BOQNode (versioned tree — Division → Section → Item)
    │   │       └── BOQCostBudget (budget per Cost Category per Item)
    │   └── BOQItemCertificationPolicy (evidence requirements per item)
    │
    ├── Site Documents [each a separate aggregate]
    │   ├── DailyProgressReport (DPR)
    │   │   └── ProgressEntry (BOQNode + qty/% /milestone)
    │   ├── InspectionTestReport (ITR)
    │   │   └── ITRLine (BOQNode + pass/fail)
    │   ├── MeasurementSheet
    │   │   └── MeasurementLine (BOQNode + certified qty)
    │   └── WorkCompletionRecord
    │       └── WCRLine (BOQNode + confirmed complete)
    │
    ├── IPC — Interim Payment Certificate [separate aggregate]
    │   └── IPCLine (references BOQVersion + BOQNode)
    │
    ├── Procurement Chain [each a separate aggregate]
    │   ├── MaterialRequest (MR)
    │   ├── PurchaseRequisition (PR)
    │   ├── RFQ + SupplierQuotation
    │   ├── PurchaseOrder (PO)  → posts COMMITTED to CostLedger
    │   │   └── POLine (material + qty + rate + BOQNode? + CostCategory)
    │   └── GoodsReceiptNote (GRN) → closes COMMITTED, posts ACCRUED
    │       └── GRNLine
    │
    ├── Inventory (Stock) [central warehouse is org-level, not project-level]
    │   ├── StoreLocation (central warehouse or site store)
    │   ├── MaterialCatalogue (item master)
    │   ├── StockLedger (immutable journal — every movement)
    │   └── StockTransfer [separate aggregate]
    │
    ├── Labour & Equipment
    │   ├── LabourAttendance (employee + site + date + hours)
    │   ├── Timesheet (approved allocation to BOQNode + CostCategory)
    │   └── EquipmentLog (unit + project + hours + fuel + maintenance)
    │
    ├── Supplier Invoices
    │   └── SupplierInvoice → closes ACCRUED, posts ACTUAL to CostLedger
    │
    ├── CostLedger (three-stage: COMMITTED / ACCRUED / ACTUAL)
    │
    ├── Client Receipts
    │   └── PaymentReceipt (matched to IPC / retention / advance)
    │
    ├── ProjectDocument (drawings, specs, photos — file attachments)
    │
    └── AuditLog (every state change on every entity)
```

---

## Key Entity Descriptions

### Project

Business scope root. Every project-specific construction transaction references a Project.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | tenant org |
| name / nameAr | string | bilingual |
| code | string | unique within org (immutable after APPROVED) |
| type | enum | `CLIENT`, `INTERNAL`, `JOINT_VENTURE` (immutable after APPROVED) |
| status | enum | see lifecycle below |
| location | string | |
| startDate / plannedEndDate / actualEndDate | date | |
| projectManagerId | cuid | User |
| createdAt / updatedAt | timestamp | |

**Lifecycle (CONST-LIFECYCLE-001):**

```
DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION → CLOSEOUT → CLOSED
```

Terminal states: `CLOSED`, `CANCELLED`

```prisma
enum ProjectStatus {
  DRAFT
  APPROVED
  MOBILIZING
  ACTIVE
  PRACTICAL_COMPLETION
  CLOSEOUT
  CLOSED
  CANCELLED
}
```

`CANCELLED` is only permitted from `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE`.
`CANCELLED` is **prohibited** from `PRACTICAL_COMPLETION` and `CLOSEOUT`.

Suspension is **not** a lifecycle state. See `ProjectSuspension` below.

Immutable fields after APPROVED: `type`, `code`, `organizationId`.

---

### ProjectSuspension

Separate operational condition. A suspended project retains its current lifecycle status.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | |
| suspendedAt | DateTime | |
| suspendedBy | cuid (User) | |
| reason | string | required |
| resumedAt | DateTime? | null = currently suspended |
| resumedBy | cuid? | |
| resumeReason | string? | |
| authorizedBy | cuid? | DoA approver |
| createdAt | DateTime | |

**Constraint:** Only one active suspension per project at a time.
Enforced by service validation AND a partial unique index:

```sql
CREATE UNIQUE INDEX uq_project_active_suspension
  ON project_suspensions (project_id)
  WHERE resumed_at IS NULL;
```

---

### OrganizationMembership

Explicit record of which users belong to which organization.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | |
| userId | cuid | |
| status | enum | `ACTIVE`, `SUSPENDED`, `REMOVED` |
| isDefault | boolean | user's default org on login |
| joinedAt | DateTime | |
| removedAt | DateTime? | |
| removedBy | cuid? | |

### OrganizationMembershipRole

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| membershipId | cuid | |
| roleId | cuid | |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

---

### ProjectRole

Organization-configurable role catalogue for project membership.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | |
| name | string | unique within org — controlled, not free text |
| nameAr | string | |
| permissions | string[] | |
| isActive | boolean | |
| createdAt | DateTime | |

### ProjectMember

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | |
| userId | cuid | |
| status | enum | `ACTIVE`, `REMOVED` |
| addedAt | DateTime | |
| addedBy | cuid (User) | |
| removedAt | DateTime? | |

### ProjectMemberRole

A member may hold multiple project roles simultaneously.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| memberId | cuid | |
| projectRoleId | cuid | references ProjectRole |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

---

### BOQ

BOQ root aggregate. A project may have one BOQ (extended in future sprints for multi-contract).

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | |
| projectId | cuid | |
| name | string | |
| baselineVersionId | cuid? | null until first baseline |
| currentDraftVersionId | cuid? | null when no draft in progress |

### BOQVersion

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| boqId | cuid | |
| versionNumber | int | sequential per BOQ |
| status | enum | `DRAFT`, `BASELINED`, `SUPERSEDED`, `CANCELLED` |
| derivedFromVersionId | cuid? | set on deep copy from prior version |
| variationId | cuid? | set when created from a Variation Order |
| approvedAt | DateTime? | set on BASELINED |
| approvedBy | cuid? | set on BASELINED |
| createdAt | DateTime | |

Rules:
- Only `DRAFT` versions permit mutations.
- `BASELINED` versions are permanently immutable.
- IPC records reference a specific `BOQVersion.id`.

### BOQNode

Self-referential tree within a single BOQVersion.

| Field | Type | Notes |
|---|---|---|
| id | cuid | stable — never changes across versions |
| versionId | cuid | FK → BOQVersion |
| parentId | cuid? | null = root node (within same version) |
| originNodeId | cuid? | FK → BOQNode in prior version (lineage on deep copy) |
| type | enum | `GROUP`, `ITEM` |
| stableCode | string | human-readable e.g. "01.02.003" |
| name / nameAr | string | bilingual |
| unit | string? | ITEM only |
| quantity | decimal? | ITEM only |
| unitRate / totalAmount | decimal? | ITEM only |
| measurementMethod | enum | `QUANTITY`, `PERCENTAGE`, `MILESTONE` (ITEM only) |
| path | string | ancestry using node IDs — never rewritten by sortOrder changes |
| depth | int | computed |
| sortOrder | int | display order — independent of path |

**Path format:** concatenated node IDs (e.g., `"7f3a2b.9c1d4e.a2f8b1"`).
Reordering siblings updates `sortOrder` only, never `path`.

### BOQCostBudget

| Field | Type | Notes |
|---|---|---|
| boqNodeId | cuid | |
| costCategory | enum | |
| budgetedAmount | decimal | |
| currencyCode | string | |

---

### StockLedger

Immutable. One row per movement. Never updated after insert.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| postedAt | timestamp | |
| locationId | cuid | warehouse or site store |
| materialId | cuid | |
| transactionType | enum | RECEIPT, ISSUE, TRANSFER_OUT, TRANSFER_IN, RETURN_TO_STORE, RETURN_TO_VENDOR, WASTAGE, THEFT_LOSS, SCRAP, ADJUSTMENT |
| quantity | decimal | negative for outflows |
| unitCost / totalValue | decimal | |
| currencyCode | string | |
| referenceDocType | string | PO, MIR, TRANSFER, etc. |
| referenceDocId | cuid | |
| projectId | cuid? | **nullable** — not all stock movements are project-specific |
| boqNodeId | cuid? | **nullable** — see CONST-INV-005 for validation by type |
| costCategory | enum? | **nullable** — see CONST-INV-005 |
| postedBy / approvedBy | cuid | User |

Note: `projectId`, `boqNodeId`, `costCategory` were mandatory in ADR-002.
ADR-004 Decision 13 makes them conditional. Central warehouse operations do not
require a project reference.

---

### CostLedger

Three-stage commitment accounting. One row per movement (immutable after insert).
Releases are explicit credit entries, not UPDATEs.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | always required |
| boqNodeId | cuid? | required when cost is BOQ-item-specific |
| costObjectType | enum | `BOQ_NODE`, `OVERHEAD`, `UNALLOCATED` |
| costCategory | enum | always required |
| stage | enum | `COMMITTED`, `ACCRUED`, `ACTUAL` |
| amount / currencyCode | decimal + string | |
| reportingRate / reportingAmount / reportingCurrency | decimal + string | locked at posting |
| referenceDocType | string | PO, GRN, INVOICE, etc. |
| referenceDocId | cuid | |
| postedAt | timestamp | |
| postedBy | cuid | |

Note: `boqNodeId` is nullable. Every cost must have a controlled `costObjectType`.
Unallocated costs require resolution within the organization's defined SLA.
`CONST-COST-001` from ADR-002 is amended by ADR-004 Decisions 12 and 13.

---

### IPC (Interim Payment Certificate)

Auto-generated from approved site documents. Immutable once FROZEN.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId / contractId | cuid | |
| boqVersionId | cuid | **references specific BOQVersion** |
| ipcNumber | int | unique per contract, monotonically increasing, assigned at FROZEN |
| periodFrom / periodTo | date | |
| status | enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `FROZEN` |
| totalGross / retentionAmount / advanceRecovery / taxAmount / netPayable | decimal | |
| currencyCode | string | |
| frozenAt / frozenBy | timestamp + cuid | set when FROZEN |

Note: `ipcNumber` is unique and monotonically increasing, but gaps are permitted
due to database sequence behavior. Void records are retained where regulation requires.
`CONST-IPC-002` from ADR-002 is replaced by ADR-004 Decision 15.

---

### Contract

Optional. Attached to a Project when there is a formal client agreement.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | |
| clientId | cuid | Client master |
| contractNumber | string | |
| type | enum | `FIXED_PRICE`, `UNIT_PRICE`, `COST_PLUS`, `MILESTONE`, `TIME_AND_MATERIAL` |
| value / currencyCode | decimal + string | |
| retentionPercentage | decimal | e.g. 5.00 |
| retentionCapPercentage | decimal | |
| advanceAmount | decimal | |
| advanceRecoveryPercentage | decimal | recovered per IPC |
| revenueRecognitionMethod | enum | `POC`, `BILLING_BASIS` |
| status | enum | `DRAFT`, `ACTIVE`, `COMPLETED`, `DISPUTED`, `CLOSED` |

**Revenue recognition:** The POC formula is for management reporting only.
Production accounting entries require written finance-policy sign-off.
See ADR-004 Decision 17.

---

## Glossary

| Term | Definition |
|---|---|
| BOQ | Bill of Quantities — the priced schedule of work items forming the basis of a construction contract |
| BOQVersion | An immutable snapshot of the BOQ at a point in time. BASELINED versions are permanent. |
| IPC | Interim Payment Certificate — a periodic billing document certifying completed work for client payment |
| DPR | Daily Progress Report — site record of work completed, labour, materials, and equipment for one day |
| ITR | Inspection and Test Report — QA/QC document confirming work meets specification before billing |
| DOA | Delegation of Authority — the framework defining who can approve what, up to what amount |
| POC | Percentage of Completion — the IFRS 15 revenue recognition method for long-term construction contracts |
| WIP | Work in Progress — the balance sheet asset representing revenue earned but not yet billed |
| GRN | Goods Receipt Note — the document confirming materials have been received and inspected |
| MIR | Material Issue Request — the authorised request for materials to be issued from a store to a work area |
| PO | Purchase Order — a committed obligation to purchase from a supplier at agreed terms |
| Variation | A formal change to the contracted scope, price, or schedule — also called a Change Order |
| Retention | A percentage of certified work withheld from each IPC as security until project completion |
| Advance | A mobilization payment made to the contractor/subcontractor before work begins, recovered from subsequent IPCs |
| originNodeId | Lineage field on BOQNode — points to the source node in the prior version when deep-copied |
