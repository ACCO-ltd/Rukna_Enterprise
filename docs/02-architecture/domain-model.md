# Construction Domain Model

Version: 5.1.0
Status: Active
Last Updated: 2026-08-12
Changes: v5.1 — Post-Sprint 5 architecture review. No new schema entities. Platform service
         layer additions: `CommitmentLedgerWriter` (application service over
         `CommitmentLedgerRepository` — provides `committed()`, `accrued()`, `actual()`
         with auto-computed `reportingAmount`/`occurredAt`; replaces direct repo injection
         in `PurchaseOrderService`, `GoodsReceiptService`, `SupplierBillService`).
         `CommandGovernanceService` new seam in `platform/workflows` (hides resolver +
         ApprovalInstance creation; wired to Projects + IPA). `GovernedEntity` type added
         to `@erp/types`. `SupplierBillService.commitmentLedgerRepo` changed from
         `@Optional()` to required. All 7 business modules now use
         `TransactionalAuditOutboxService` (ADR-008 complete).

         v5 — Sprint 5 planning (ADR-007). Added procurement domain: UnitOfMeasure,
         MaterialCategory, SpendCategory, Material catalogue, MaterialRequest (dual-scope),
         PurchaseOrder (immutable revisions), PurchaseOrderLineRequestAllocation (many-to-many
         MR↔PO), GoodsReceiptNote + GoodsReceiptLineAllocation, SupplierBillMatch + MatchLine,
         MatchingTolerancePolicy, OverReceiptPolicy, CommitmentLedgerEntry (COMMITTED→ACCRUED→
         ACTUAL). DOA engine extended with condition expressions. BOQNode.sourceType added.
         Variations deferred to Sprint 6. Sprint numbering updated (Variations = 6,
         Inventory = 7, AR/Cash = 8, Site = 9, Financial Close = 10).

---

## Aggregate Boundaries

`Project` is the central business scope and reporting root. It is **not** a DDD
God Aggregate. The following are each independent aggregate roots:

```
Project                         Aggregate root — lifecycle, membership, metadata
Contract                        Aggregate root — references projectId, clientId
BOQ + BOQVersion                Aggregate root — references projectId
InterimPaymentApplication       Aggregate root — references contractId, projectId
InterimPaymentCertificate       Aggregate root — references applicationId
PaymentReceipt                  Aggregate root — finance; references clientId
MaterialRequest                 Aggregate root — dual-scope PROJECT|ORGANIZATION (Sprint 5)
PurchaseOrder                   Aggregate root — immutable revisions (Sprint 5)
GoodsReceiptNote                Aggregate root — references purchaseOrderId (Sprint 5)
CommitmentLedgerEntry           Ledger record  — immutable, signed (Sprint 5)
ChangeOrder                     Aggregate root — references contractId (Sprint 6)
StockTransfer                   Aggregate root (Sprint 7)
Subcontract                     Aggregate root — references projectId (Sprint 6)
DailyProgressReport             Aggregate root — references projectId (Sprint 9)
ProjectSuspension               Event record   — references projectId
```

Cross-aggregate communication occurs through public interfaces and domain events.
No aggregate may directly modify the internal state of another.

---

## Platform Application Services (Post-Sprint 5)

These are not entities — they are service-layer abstractions injected into business services.

| Service | Location | Purpose |
|---|---|---|
| `TransactionalAuditOutboxService` | `platform/audit-logs/application/` | Writes `AuditLog` + `AuditOutboxEvent` in same transaction as business mutation. All 7 business modules use this. |
| `CommandGovernanceService` | `platform/workflows/application/` | Single entry point for workflow governance on state transitions. Returns `null` (proceed) or `{ gated, approvalInstanceId }` (block). Business services must not import `WorkflowTriggerResolverService` directly. |
| `CommitmentLedgerWriter` | `procurement/commitment-ledger/application/` | Writes commitment ledger entries at the correct stage (`committed`, `accrued`, `actual`). Auto-computes `reportingAmount = amount × rate` and sets `occurredAt`. Injected into `PurchaseOrderService`, `GoodsReceiptService`, `SupplierBillService`. |
| `ProjectAccessService` | `platform/project-access/` | Resolves membership scope for collection queries: `scopedUserId()` returns `undefined` (bypass role — see all) or `userId` (filter to own projects). `hasBypass` is private. |

---

## Entity Map

```
Organization
│
├── OrganizationMembership  (explicit user ↔ org join — Sprint 2)
│   └── OrganizationMembershipRole
│
├── Users, Roles, Permissions
├── WorkflowDefinition (DOA approval chains)
├── WorkflowPolicyVersion (effective-dated governance envelope)
│   ├── WorkflowPolicyRule (data-driven thresholds, routing and pending decisions)
│   └── SegregationOfDutiesRule (central prohibited-actor controls)
├── WorkflowTriggerBinding (trigger event → workflow mapping — Sprint 2)
├── WorkflowRequirementPolicy (per-transition requirement: REQUIRED|OPTIONAL|NONE — Sprint 3)
├── ApprovalInstance (created by CommandGovernanceService when a transition is gated)
├── AuditLog (immutable audit evidence)
└── AuditOutboxEvent (post-commit idempotent publication)
├── ExchangeRate (currency × date → rate)
├── Client (minimal aggregate — Sprint 3)
│   └── ClientContact
│
└── Project  ◄── BUSINESS SCOPE ROOT (not a DDD God Aggregate)
    │         commercialModel: CLIENT_CONTRACT | INTERNAL_CAPITAL  (Sprint 3)
    │         participationModel: SOLE | JOINT_VENTURE              (Sprint 3)
    │
    ├── ProjectSuspension (active suspension record — separate from lifecycle)
    ├── ProjectMember
    │   └── ProjectMemberRole
    │
    ├── BOQ [separate aggregate — Sprint 2 Phase 4]
    │   └── BoqVersion (DRAFT | BASELINED | SUPERSEDED | CANCELLED)
    │       └── BoqNode (versioned tree — section → item)
    │           measurementMethod: QUANTITY | PERCENTAGE | MILESTONE  (Sprint 3)
    │           pricingBasis: UNIT_RATE | LUMP_SUM                    (Sprint 3)
    │
    ├── Contract [separate aggregate — Sprint 3]
    │   ├── ContractRetentionTerms (1:1)
    │   ├── ContractAdvanceTerm (1:many)
    │   ├── ContractGuarantee (1:many)
    │   │   └── GuaranteeAttachment → Platform File
    │   ├── ContractMilestone (schema only — Sprint 3)
    │   └── ContractAttachment → Platform File
    │
    ├── InterimPaymentApplication [separate aggregate — Sprint 3]
    │   ├── InterimPaymentApplicationItem (leaf BOQ nodes — cumulative)
    │   ├── InterimPaymentApplicationDeduction (retention, advance recovery, etc.)
    │   └── IpaAttachment → Platform File
    │
    ├── InterimPaymentCertificate [separate aggregate — Sprint 3]
    │   ├── InterimPaymentCertificateItem (line-level, immutable)
    │   ├── InterimPaymentCertificateDeduction
    │   └── IpcAttachment → Platform File
    │
    ├── PaymentReceipt [separate aggregate — Sprint 3]
    │   └── ReceiptAllocation (→ InterimPaymentCertificate, many-to-many)
    │
    ├── Procurement Chain [Sprint 5 — separate aggregate roots]
    │   ├── MaterialRequest [separate aggregate]
    │   │   └── MaterialRequestLine
    │   │       boqNodeId?            optional — indirect costs do not require BOQ node
    │   │       spendCategoryId?      overrides Material.defaultSpendCategoryId
    │   │       requestScope          PROJECT | ORGANIZATION
    │   │
    │   ├── PurchaseOrder [separate aggregate]
    │   │   └── PurchaseOrderRevision  (DRAFT | APPROVED | ACTIVE | SUPERSEDED | CANCELLED)
    │   │       └── PurchaseOrderLine  (immutable once revision ACTIVE)
    │   │           └── PurchaseOrderLineRequestAllocation  (many-to-many MR↔PO junction)
    │   │
    │   ├── GoodsReceiptNote [separate aggregate]
    │   │   └── GoodsReceiptLine
    │   │       receivedQuantity / acceptedQuantity / rejectedQuantity
    │   │       └── GoodsReceiptLineAllocation  (per-project attribution for CommitmentLedger)
    │   │
    │   ├── SupplierBillMatch  (explicit matching audit per SupplierBill)
    │   │   └── SupplierBillMatchLine
    │   │
    │   ├── MatchingTolerancePolicy  (hierarchical: PO → Supplier → SpendCategory → Org)
    │   └── OverReceiptPolicy        (hierarchical: PO → SpendCategory → Org)
    │
    ├── CommitmentLedgerEntry [immutable ledger — Sprint 5]
    │   stage: COMMITTED | ACCRUED | ACTUAL
    │   signed Decimal amount per allocation (project/BOQ/department attribution)
    │   NOT merged with JournalLine (GL) — separate bounded model
    │
    ├── Master Data [Sprint 5]
    │   ├── UnitOfMeasure  (org-configurable; code unique per org; INACTIVE not deleted)
    │   ├── MaterialCategory  (hierarchy via parentCategoryId; operational classification)
    │   ├── SpendCategory     (hierarchy via parentCategoryId; financial governance)
    │   └── Material          (materialCategoryId + defaultSpendCategoryId + baseUomId)
    │
    ├── ChangeOrder (Sprint 6)
    ├── CostLedger / StockLedger (Sprint 7)
    └── Subcontract (Sprint 6)
```

---

## Entity Descriptions — Implemented (Sprint 2)

---

### Organization

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| name | string | |
| slug | string | unique — used as subdomain |
| status | enum | `ACTIVE`, `SUSPENDED` |
| createdAt / updatedAt | timestamp | |

---

### OrganizationMembership

Explicit record linking a user to an organization. Every authenticated request
validates an active membership record. JWT guard rejects tokens where membership
is `SUSPENDED` or `REMOVED`.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | FK → Organization |
| userId | cuid | FK → User (CASCADE on delete) |
| status | enum | `ACTIVE`, `SUSPENDED`, `REMOVED` |
| isDefault | boolean | user's default org on login |
| joinedAt | DateTime | |
| removedAt | DateTime? | |
| removedBy | cuid? | |

Unique constraint: `(organizationId, userId)`.

### OrganizationMembershipRole

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| membershipId | cuid | FK → OrganizationMembership (CASCADE) |
| roleId | cuid | FK → Role (CASCADE) |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

---

### WorkflowTriggerBinding

Maps a trigger event (document submission or state transition) to a workflow
definition. Looked up in 4-step priority order by `WorkflowTriggerResolverService`.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid? | null = tenant-wide default |
| triggerKind | enum | `DOCUMENT`, `STATE_TRANSITION` |
| entityType | string | e.g. `"Project"`, `"PurchaseOrder"` |
| transactionType | enum? | `WorkflowTransactionType` — set for DOCUMENT kind |
| fromState | string? | source state — null = any source state |
| toState | string? | destination state |
| workflowDefinitionId | cuid | FK → WorkflowDefinition |
| priority | int | higher wins when multiple bindings match |
| isActive | boolean | false = binding exists but is inactive (Sprint 2: all false) |
| createdAt | DateTime | |

**4-step resolution order** (highest priority first):
1. org-specific + exact fromState + toState
2. org-specific + toState only (fromState = null)
3. tenant-default + exact fromState + toState
4. tenant-default + toState only

---

### Project

Business scope root. Every construction transaction references a Project.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | FK → Organization |
| code | string(30) | unique within org — **immutable after creation** |
| name | string | |
| nameAr | string? | |
| description | string? | |
| status | enum | see lifecycle below |
| clientName | string? | client/employer name |
| contractValue | decimal(18,2)? | paired with `currency` |
| currency | string(3)? | ISO 4217 — paired with `contractValue` |
| startDate | date? | |
| expectedEndDate | date? | |
| createdBy | cuid | User who created the project |
| createdAt / updatedAt | timestamp | |

**Lifecycle:**

```
DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION → CLOSEOUT → CLOSED
```

`CANCELLED` is reachable from `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE` only.
`CANCELLED` is **prohibited** from `PRACTICAL_COMPLETION` and `CLOSEOUT`.

Suspension is **not** a lifecycle status. See `ProjectSuspension` below.

Fields editable only in `DRAFT` status: all fields except `code` (immutable).

---

### ProjectSuspension

Separate operational condition. A suspended project retains its lifecycle status.
Lifecycle transitions (`/approve`, `/activate` etc.) are blocked while suspended.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | FK → Project (RESTRICT) |
| reason | string | required |
| suspendedAt | DateTime | default now() |
| suspendedBy | cuid (User) | |
| resumedAt | DateTime? | null = currently active suspension |
| resumedBy | cuid? | |

**Constraint:** Only one active suspension per project at a time.
Enforced by service AND partial unique index:

```sql
CREATE UNIQUE INDEX "project_suspensions_one_active_per_project"
ON "project_suspensions"("project_id")
WHERE "resumed_at" IS NULL;
```

---

### ProjectMember

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | FK → Project (RESTRICT) |
| userId | cuid | FK → User (RESTRICT) |
| joinedAt | DateTime | default now() |
| joinedBy | cuid | User who added this member |
| removedAt | DateTime? | null = currently active member |
| removedBy | cuid? | |

Soft-delete: members are deactivated via `removedAt`, not hard-deleted.

Partial unique index ensures one active membership per project+user:

```sql
CREATE UNIQUE INDEX "project_members_one_active_per_project_user"
ON "project_members"("project_id", "user_id")
WHERE "removed_at" IS NULL;
```

### ProjectMemberRole

A member may hold multiple project roles simultaneously.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| memberId | cuid | FK → ProjectMember (CASCADE) |
| role | enum | `ProjectRole` — see values below |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

**ProjectRole enum values:**
```
PROJECT_MANAGER
QUANTITY_SURVEYOR
SITE_ENGINEER
COMMERCIAL_MANAGER
FINANCE_REVIEWER
VIEWER
```

---

### BOQ vocabulary (ADR-016)

These seven terms are fixed. Use them in code, in the API, and on screen; do not invent
synonyms for them.

| Term | Definition |
|---|---|
| **Working Draft** | The single editable version (`status = DRAFT`). At most one per BOQ. |
| **Approved Baseline** | A `BASELINED` version. Permanently immutable. |
| **Contract Baseline** | The version referenced by `Contract.boqVersionId`. May be older than the current Approved Baseline. |
| **Revision** | A Working Draft deep-copied from the Approved Baseline, each node carrying `originNodeId`. |
| **Variation Item** | A node with `sourceType = VARIATION` and a `sourceChangeOrderId`. |
| **Pricing Complete** | Every billable item has unit, quantity, rate and the BOQ currency. |
| **Baseline Ready** | Structurally valid, Pricing Complete, ≥1 billable item, no duplicate codes, lifecycle permits it. |

**Billable item** = `isLeaf = true`. Sections are structural and never billable.

**Ownership boundaries.** BOQ owns scope structure and pricing — nothing else writes a
`BoqNode`. Contract owns the negotiated contract value; a BOQ total never replaces it.
Programme owns time and progress. Procurement and Accounting reference BOQ nodes as a cost
dimension but never mutate them. Rate and amount visibility is enforced server-side, not
by hiding fields in the UI.

---

### Boq

BOQ aggregate root. One BOQ per project. Carries three version pointers — each
maintained by the application layer, not FK-constrained in Prisma.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | unique FK → Project |
| organizationId | cuid | denormalized for query performance |
| originalBaselineVersionId | cuid? | **immutable once set** — the original contract baseline |
| currentApprovedVersionId | cuid? | currently approved (BASELINED) version |
| currentDraftVersionId | cuid? | currently open draft version (null if none) |
| createdAt / updatedAt | timestamp | |

**Three-pointer semantics:**
- `originalBaselineVersionId`: set on first `baseline()` call; never overwritten. Preserves the original contract baseline even after subsequent revisions.
- `currentApprovedVersionId`: updated on every `baseline()` call.
- `currentDraftVersionId`: set when a draft is created; cleared on baseline or cancel.

---

### BoqVersion

Snapshot of the BOQ tree at a point in time. Only `DRAFT` versions accept mutations.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| boqId | cuid | FK → Boq |
| versionNumber | int | sequential per BOQ, auto-incremented |
| status | enum | `DRAFT`, `BASELINED`, `SUPERSEDED`, `CANCELLED` |
| notes | string? | revision notes |
| baselinedAt | DateTime? | set when status → BASELINED |
| baselinedBy | cuid? | User who baselined |
| createdBy | cuid | |
| createdAt / updatedAt | timestamp | |

**Status transitions:**
- `DRAFT` → `BASELINED` (via `/baseline`) — the previous approved version becomes `SUPERSEDED`
- `DRAFT` → `CANCELLED` (via `/cancel`)
- `BASELINED` and `CANCELLED` are **terminal** — no further status change

Unique constraint: `(boqId, versionNumber)`.

---

### BoqNode

Self-referential tree node within a single `BoqVersion`. Nodes are version-scoped —
the same physical line item gets a new node ID in each version copy.

| Field | Type | Notes |
|---|---|---|
| id | cuid | version-scoped — new ID on each version copy |
| boqId | cuid | denormalized FK → Boq |
| versionId | cuid | FK → BoqVersion |
| parentId | cuid? | null = root node (within same version) |
| path | string | materialized path: `"rootId/childId/grandchildId"` |
| depth | int | 0 = root; auto-maintained |
| sortOrder | int | display order among siblings |
| code | string(50) | human-readable section code e.g. `"1.2.3"` |
| description | string | line item description (English) |
| descriptionAr | string? | Arabic description |
| isLeaf | boolean | true = can carry quantity/rate; false = summary section |
| unit | string(20)? | measurement unit — leaf nodes only, e.g. `m³`, `ton` |
| quantity | decimal(18,3)? | leaf nodes only |
| unitRate | decimal(18,2)? | leaf nodes only |
| currency | string(3)? | ISO 4217 — paired with unitRate |
| totalAmount | decimal(18,2)? | `quantity × unitRate`, stored for performance |
| originNodeId | cuid? | source node ID from the prior version (copy lineage) |
| createdAt / updatedAt | timestamp | |

**Path format:** `"rootId/childId/grandchildId"` (no leading slash, `/`-delimited node IDs).

Move algorithm uses two raw SQL updates:
1. Update moved node's `parentId`, `path`, `depth`, `sortOrder`
2. Bulk-update all descendants: replace `oldPath` prefix with `newPath` via `REPLACE + LIKE`

**Leaf vs summary distinction:**
- `isLeaf = false` (summary): has children; `quantity`, `unitRate`, `totalAmount` are null; `computedTotal` is aggregated from children at query time
- `isLeaf = true` (item): has no children; carries `quantity × unitRate = totalAmount`

---

## Entity Descriptions — Planned (Sprint 3, ADR-005)

---

### Client

Minimal aggregate representing a client/employer organisation. Referenced by `Contract`.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | FK → Organization (tenant-scoped) |
| code | string(30) | unique within org — immutable after creation |
| name | string | |
| nameAr | string? | |
| taxNumber | string? | |
| defaultCurrency | string(3)? | ISO 4217 |
| status | enum | `ACTIVE`, `INACTIVE` |
| createdAt / updatedAt | DateTime | |

### ClientContact

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| clientId | cuid | FK → Client (CASCADE) |
| name | string | |
| role | string? | |
| email | string? | |
| phone | string? | |
| isPrimary | boolean | default false |

---

### WorkflowRequirementPolicy

Per-entity, per-transition table. Checked by `WorkflowTriggerResolverService` before binding
lookup. A `REQUIRED` transition with no active binding is **rejected** — never silently bypassed.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| entityType | string | e.g. `"Project"`, `"InterimPaymentApplication"` |
| fromState | string? | null = any source state |
| toState | string | |
| requirement | enum | `REQUIRED`, `OPTIONAL`, `NONE` |
| organizationId | cuid? | null = tenant-wide default |

### WorkflowPolicyVersion and WorkflowPolicyRule

`WorkflowPolicyVersion` is the effective-dated approval-policy envelope. It
holds reporting currency, amount basis, activation status, and the effective
window. Only an `ACTIVE` version whose window includes the evaluation timestamp
may route a transaction. `WorkflowPolicyRule` stores thresholds, workflow
requirements, routing data, and explicit `PENDING` decisions as configuration.
This prevents unconfirmed roles or VAT treatment from entering services as
hardcoded logic.

`SegregationOfDutiesRule` belongs to a policy version and is evaluated centrally
from transaction actor facts. A rule is only enforced when both it and its policy
version are active and effective.

### AuditLog and AuditOutboxEvent

`AuditLog` is immutable evidence for a command: actor and permission context,
resource snapshots, reason, source command, correlation/request IDs, IP, and
approval instance where applicable. `AuditOutboxEvent` references one audit log,
has a unique idempotency key, and tracks only delivery state. Both are created in
the same tenant transaction as the business mutation; publication happens after
commit.

---

### Contract

Aggregate root. One contract per project for `CLIENT_CONTRACT` projects.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | FK → Project (RESTRICT) |
| organizationId | cuid | denormalized |
| clientId | cuid | FK → Client (RESTRICT) |
| boqVersionId | cuid | FK → BoqVersion — contractual scope baseline |
| contractNumber | string(50) | unique within org |
| contractValue | Decimal(18,2) | independent from BOQ total |
| currency | string(3) | ISO 4217 |
| billingModel | enum | `MEASURED_IPC`, `MILESTONE`, `TIME_AND_MATERIAL`, `HYBRID` |
| status | enum | see lifecycle below |
| clientNameSnapshot | string | immutable at ACTIVE |
| clientTaxSnapshot | string? | immutable at ACTIVE |
| startDate | date? | |
| expectedEndDate | date? | |
| createdBy | cuid | |
| createdAt / updatedAt | DateTime | |

**Lifecycle:**
```
DRAFT → UNDER_REVIEW → PENDING_SIGNATURE → ACTIVE → FINAL_ACCOUNT_PENDING → CLOSED
CANCELLED: from DRAFT, UNDER_REVIEW, PENDING_SIGNATURE only
TERMINATED: from ACTIVE only
```
`FINAL_ACCOUNT_PENDING` triggered when the Project reaches `PRACTICAL_COMPLETION`.

**Commercial term lifecycle (CONST-COM-001/002/008 — see ADR-017).** The contract's
commercial baseline (header, retention, advances, guarantees, milestones as a set) is
mutable only in `DRAFT`; once past DRAFT it is frozen and material change must flow through
Variations (deferred). The single backend gate is `CommercialTermPolicy.evaluate(status,
mutationKind)`; a blocked mutation returns `409`. Operational exceptions: guarantee **status**
changes are allowed in any non-terminal status; milestone **completion** is allowed in
`ACTIVE`/`FINAL_ACCOUNT_PENDING`. Every nested child mutation is scoped by
`organizationId + contractId + childId` (CONST-COM-002) and audited (CONST-COM-005).

### ContractRetentionTerms (1:1 with Contract)

| Field | Type | Notes |
|---|---|---|
| contractId | cuid | FK → Contract (CASCADE, UNIQUE) |
| retentionRate | Decimal(5,4) | e.g. 0.0500 = 5% |
| retentionCap | Decimal(5,4) | e.g. 0.1000 = 10% of contract value |
| retentionSplitOnPC | Decimal(5,4) | fraction released at practical completion |
| retentionReleasedAt | DateTime? | |

### ContractAdvanceTerm (1:many with Contract)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| contractId | cuid | FK → Contract (CASCADE) |
| advanceType | enum | `MOBILIZATION`, `MATERIAL_ON_SITE`, `EQUIPMENT`, `OTHER` |
| description | string? | |
| amount | Decimal(18,2)? | fixed amount (mutually exclusive with percentage) |
| percentage | Decimal(5,4)? | % of contract value |
| recoveryRate | Decimal(5,4) | % deducted from each IPA until fully recovered |

Actual disbursements and recoveries are separate financial transactions.

### ContractGuarantee (1:many with Contract)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| contractId | cuid | FK → Contract (CASCADE) |
| guaranteeType | string | configurable — `PERFORMANCE`, `ADVANCE_PAYMENT` confirmed |
| amount | Decimal(18,2) | |
| currency | string(3) | |
| issuer | string | e.g. bank name |
| beneficiary | string | |
| issueDate | date | |
| expiryDate | date | expiry alerts required |
| status | enum | stored legal lifecycle: `ACTIVE`, `DISCHARGED`, `EXPIRED`, `CALLED` |
| notes | string? | |

**Derived attention (A7 — see ADR-017).** Expiry attention (`NONE | EXPIRING_SOON |
EXPIRED`) is derived by `deriveGuaranteeAttention(expiryDate, status, now)` from an
authoritative backend clock — never the browser clock — using a provisional 30-day
"expiring soon" window. It is kept separate from the stored legal lifecycle above.

### ContractMilestone (schema foundation only — Sprint 3)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| contractId | cuid | FK → Contract (CASCADE) |
| name | string | |
| description | string? | |
| dueDate | date? | |
| completedAt | DateTime? | |
| completedBy | cuid? | |
| sortOrder | int | |

Full milestone certification and invoice-generation deferred.

---

### InterimPaymentApplication

ACCO's internal commercial valuation document. Aggregate root.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| contractId | cuid | FK → Contract (RESTRICT) |
| projectId | cuid | denormalized |
| organizationId | cuid | denormalized |
| applicationNumber | int | unique per contract — assigned at APPROVED_FOR_SUBMISSION |
| displayNumber | string | immutable snapshot; format is org-configurable |
| status | enum | see lifecycle below |
| periodStart / periodEnd | date | billing period |
| grossAmount | Decimal(18,2) | sum of item periodAmounts |
| totalDeductions | Decimal(18,2) | sum of deduction amounts |
| netAmount | Decimal(18,2) | grossAmount − totalDeductions |
| currency | string(3) | |
| exchangeRateSnapshot | Json | rate, baseCurrency, date — frozen at creation |
| submittedAt | DateTime? | |
| createdBy | cuid | |
| createdAt / updatedAt | DateTime | |

**Lifecycle:**
```
DRAFT → PENDING_INTERNAL_APPROVAL → APPROVED_FOR_SUBMISSION → SUBMITTED
RETURNED_FOR_REVISION: from PENDING_INTERNAL_APPROVAL → back to DRAFT
CANCELLED: from DRAFT or RETURNED_FOR_REVISION only
```
DOA workflow fires at `PENDING_INTERNAL_APPROVAL`. Completed workflow → `APPROVED_FOR_SUBMISSION`.
`SUBMITTED` is a separate explicit command. Immutable once `SUBMITTED`.

**Numbering:** `UNIQUE(contractId, applicationNumber)`, gaps permitted, never reused.

### InterimPaymentApplicationItem

One row per leaf BOQ node being claimed.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| applicationId | cuid | FK → InterimPaymentApplication |
| boqNodeId | cuid | FK → BoqNode (leaf nodes only) |
| measurementMethodSnapshot | enum | immutable copy of `BoqNode.measurementMethod` at submission |
| unitRateSnapshot | Decimal(18,2) | immutable copy from BOQ version |
| currencySnapshot | string(3) | |
| cumulativeClaimed | Decimal(18,3) | total claimed to date including this application |
| previousEffectiveCertified | Decimal(18,3) | certified on last effective certificate |
| periodQuantity | Decimal(18,3) | derived: cumulativeClaimed − previousEffectiveCertified |
| periodAmount | Decimal(18,2) | derived: periodQuantity × unitRateSnapshot |

### InterimPaymentApplicationDeduction

Immutable deduction-line records applied at IPA header level.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| applicationId | cuid | FK → InterimPaymentApplication |
| deductionType | string | e.g. `RETENTION`, `ADVANCE_RECOVERY`, `TAX` |
| sourceTermId | cuid? | FK → ContractRetentionTerms or ContractAdvanceTerm |
| rate | Decimal(5,4)? | |
| basis | Decimal(18,2) | amount the rate is applied to |
| amount | Decimal(18,2) | computed deduction amount |

---

### InterimPaymentCertificate

Client/consultant's response to a submitted IPA. Independent aggregate root.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| applicationId | cuid | FK → InterimPaymentApplication (RESTRICT) |
| status | enum | `CERTIFIED`, `PARTIALLY_CERTIFIED`, `REJECTED` — terminal |
| certifiedGrossAmount | Decimal(18,2) | |
| totalDeductions | Decimal(18,2) | |
| certifiedNetAmount | Decimal(18,2) | |
| currency | string(3) | |
| exchangeRateSnapshot | Json | frozen at issuance |
| isEffective | boolean | domain-controlled — not directly editable |
| effectiveAt | DateTime? | set when this certificate becomes effective |
| supersededAt | DateTime? | set when this certificate is superseded |
| supersededById | cuid? | FK → InterimPaymentCertificate |
| supersessionReason | string? | required on supersession |
| issuedAt | DateTime | |
| issuedBy | cuid | |

**Effective certificate rule:** At most one effective certificate per application.
Partial unique index: `WHERE is_effective = true` on `application_id`.
First valid certificate → automatically effective. Later revision → explicit atomic supersession.

**Immutable on issue.**

### InterimPaymentCertificateItem

Line-level certification — immutable once certificate is issued.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| certificateId | cuid | FK → InterimPaymentCertificate |
| applicationItemId | cuid | FK → InterimPaymentApplicationItem |
| certifiedQuantity | Decimal(18,3) | |
| certifiedAmount | Decimal(18,2) | |
| varianceQuantity | Decimal(18,3) | derived: certified − claimed |
| varianceReason | string? | **required** when certifiedQuantity ≠ claimedQuantity |

### InterimPaymentCertificateDeduction

Same structure as `InterimPaymentApplicationDeduction`. Client-side deductions are separate
from application deductions.

---

### PaymentReceipt

Finance aggregate. Records a payment received from a client.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | |
| clientId | cuid | FK → Client |
| receiptDate | date | |
| amount | Decimal(18,2) | |
| currency | string(3) | |
| exchangeRate | Decimal(18,6)? | |
| reference | string? | bank reference / payment advice |
| notes | string? | |
| createdBy | cuid | |
| createdAt | DateTime | |

### ReceiptAllocation

Many-to-many bridge between `PaymentReceipt` and `InterimPaymentCertificate`.
`PAID`/`PARTIALLY_PAID`/`UNPAID` is **derived** from allocation records — not a status field.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| receiptId | cuid | FK → PaymentReceipt |
| certificateId | cuid | FK → InterimPaymentCertificate |
| allocatedAmount | Decimal(18,2) | |
| allocatedAt | DateTime | |
| allocatedBy | cuid | |

---

## Entities Not Yet Implemented

| Entity | Sprint |
|---|---|
| BudgetAuthorization (INTERNAL_CAPITAL projects) | Sprint 4 |
| ContractMilestone certification + invoice-generation | Sprint 4+ |
| Subcontract, SubcontractCertificate | Sprint 4+ |
| MaterialRequest, PurchaseOrder, GoodsReceiptNote | Sprint 4+ |
| StockLedger, StockTransfer | Sprint 4+ |
| CostLedger | Sprint 4+ (after Procurement + Inventory stable) |
| DailyProgressReport, MeasurementSheet, ITC | Sprint 4+ |
| LabourAttendance, EquipmentLog | Sprint 4+ |
| Platform File aggregate (storage) | Sprint 4+ |

---

## Glossary

| Term | Definition |
|---|---|
| BOQ | Bill of Quantities — the priced schedule of work items forming the basis of a construction contract |
| BoqVersion | An immutable snapshot of the BOQ at a point in time. BASELINED versions are permanent. |
| Baseline | The act of locking a DRAFT version as the approved BOQ — analogous to signing the contract schedule |
| IPA | InterimPaymentApplication — ACCO's internal commercial valuation document submitted for client billing |
| IPC | InterimPaymentCertificate — the client/consultant's certificate in response to an IPA |
| DOA | Delegation of Authority — the framework defining who can approve what, up to what value |
| WTB | WorkflowTriggerBinding — the mapping from a business event to a DOA approval chain |
| WRP | WorkflowRequirementPolicy — per-transition table controlling whether a workflow is REQUIRED, OPTIONAL, or NONE |
| ReceiptAllocation | Bridge record linking a PaymentReceipt to an InterimPaymentCertificate for partial/multi-payment settlement |
| Effective Certificate | The one active InterimPaymentCertificate per IPA that drives cumulative certified quantity calculations |
| Supersession | The atomic command that replaces the current effective certificate with a revised one, preserving audit history |
| CONTRACT_BASELINE | The specific BoqVersion explicitly referenced by a Contract — distinct from any prior working baseline |
| originNodeId | Lineage field on BoqNode — points to the source node in the prior version on deep copy |
| Materialized Path | Tree traversal technique storing the full ancestor chain as a path string for O(1) subtree queries |
| TenantContext | AsyncLocalStorage context carrying tenantId, tenantSlug, PrismaClient — set by TenancyMiddleware |
| RequestIdentity | request.user object set by JwtAuthGuard — carries userId, activeOrganizationId, roles, permissions |
| commercialModel | PROJECT field: CLIENT_CONTRACT (requires signed Contract for IPC) or INTERNAL_CAPITAL (requires budget authorization) |
| participationModel | PROJECT field: SOLE or JOINT_VENTURE — orthogonal to commercialModel |
| Project Actual P&L | Statutory project view: posted GL revenue and posted project-cost lines only. Excludes commitments. Ship-thin capability over the existing dimensioned P&L. Never presented to a PM as the complete picture. (ADR-013) |
| Project Financial Position | PM/control view: BOQ budget · certified · invoiced · received · actual cost · **remaining committed cost** · forecast cost · forecast margin. Built on the shared spine (BOQ + CommitmentLedger + GL actuals + commercial). Committed cost is mandatory here. (ADR-010, ADR-013) |
| Counterparty | The other party on a Contract, selected by contractKind: a Client (CLIENT_CONTRACT) or a Supplier (SUBCONTRACT). Modelled as `clientId` XOR `supplierId` with counterparty snapshots. (ADR-012) |
| Certification Direction | Whether a PaymentApplication/Certificate settles RECEIVABLE (client → AR) or PAYABLE (subcontractor → AP). Derived from Contract.contractKind; branches only at the posting boundary. (ADR-012) |
| Commitment Source | A document that writes the CommitmentLedger (COMMITTED→ACCRUED→ACTUAL): a PurchaseOrder today, and a SUBCONTRACT Contract once built. The certificate→SupplierBill non-PO path does not commit by itself. (ADR-012) |
