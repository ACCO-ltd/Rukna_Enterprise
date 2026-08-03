# ADR-005: Sprint 3 — Commercial Management Module

Status: ACCEPTED
Date: 2026-08-03
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)
Supersedes: Nothing — extends ADR-002 and ADR-004 for Sprint 3 scope.

---

## Context

Sprint 2 delivered: platform infrastructure (TenantContext/RequestIdentity, LRU Prisma client
cache, OrganizationMembership guard, WorkflowTriggerResolverService), the Project module
(full 8-state lifecycle, suspend/resume, membership), and the BOQ module (versioning with
three-pointer model, materialized-path tree, raw SQL move).

Sprint 3 establishes the **commercial management foundation** — the contractual and billing
layer that all subsequent operational modules (procurement, inventory, cost control) depend on.

The correct build order is:
```
Project → BOQ → Contract → Commercial Billing → Procurement → Inventory → Cost → Finance
```

This ADR records all Sprint 3 architectural decisions locked during the planning grill.

---

## Scope Boundary

**Sprint 3 delivers:**
- Platform: Client aggregate, WorkflowRequirementPolicy, BOQ node extensions, Project hardening
- Contract module: Contract + commercial terms (retention, advances, guarantees, milestones schema)
- IPC module: InterimPaymentApplication + InterimPaymentCertificate
- Finance module: PaymentReceipt + ReceiptAllocation

**Deferred to Sprint 4+:**
- BudgetAuthorization (INTERNAL_CAPITAL projects)
- ContractMilestone certification and invoice-generation workflows
- TIME_AND_MATERIAL and HYBRID billing execution
- Subcontracts, SubcontractCertificates
- Procurement chain (MaterialRequest → PurchaseOrder → GRN)
- StockLedger, CostLedger, DailyProgressReport, LabourAttendance, EquipmentLog

---

## Decision 1 — Project Commercial and Participation Classification

**Rule CONST-PROJ-010:** Add two orthogonal classification fields to `Project`.

```
commercialModel    CLIENT_CONTRACT | INTERNAL_CAPITAL
participationModel SOLE | JOINT_VENTURE
```

These are independent axes:
- A `CLIENT_CONTRACT` project requires a signed Contract before IPC billing can begin.
- An `INTERNAL_CAPITAL` project uses an internal budget authorization (Sprint 4) instead of a
  client contract. Client-commercial workflows are **blocked** on INTERNAL_CAPITAL projects.
- Either commercial model may use SOLE or JOINT_VENTURE participation.

**Rule CONST-PROJ-011:** Project categories (residential, commercial, infrastructure,
renovation, etc.) are configurable records in a separate table — not hardcoded enums.
Do not add category labels to the classification enums above.

**Migration required:** `ALTER TABLE projects ADD COLUMN commercial_model ...`

---

## Decision 2 — Client Aggregate (Minimal)

**Rule CONST-CLIENT-001:** Introduce a minimal `Client` aggregate in Sprint 3.
`Contract.clientId` must reference `Client`. Do **not** store client names and contacts as
plain text fields on `Contract` — that is technical debt with no justification.

**Client entity fields:**
```
id               cuid
organizationId   cuid         FK → Organization (tenant-scoped)
code             string(30)   unique within org — immutable after creation
name             string
nameAr           string?
taxNumber        string?
defaultCurrency  string(3)?   ISO 4217
status           enum         ACTIVE | INACTIVE
createdAt        DateTime
updatedAt        DateTime
```

**ClientContact entity fields (1:many with Client):**
```
id         cuid
clientId   cuid      FK → Client (CASCADE)
name       string
role       string?
email      string?
phone      string?
isPrimary  boolean   default false
```

**Not in Sprint 3:** CRM features, credit limits, client portal, client-side login.

**Rule CONST-CLIENT-002:** At Contract activation (`status → ACTIVE`), snapshot the client's
legal name, tax number, and address as immutable fields on Contract for historical and legal
accuracy. The live Client record may change; the contract snapshot must not.

---

## Decision 3 — Contract Lifecycle

**Rule CONST-CONTRACT-001:** Contract lifecycle:

```
DRAFT → UNDER_REVIEW → PENDING_SIGNATURE → ACTIVE → FINAL_ACCOUNT_PENDING → CLOSED
```

- `CANCELLED`: reachable from `DRAFT`, `UNDER_REVIEW`, `PENDING_SIGNATURE` (pre-signature abandonment)
- `TERMINATED`: reachable from `ACTIVE` only (early termination after activation)
- `CLOSED` and `CANCELLED` and `TERMINATED` are terminal

`FINAL_ACCOUNT_PENDING` is triggered by Project reaching `PRACTICAL_COMPLETION` status.
Final account settlement, claims, retention release, and guarantee discharge occur before `CLOSED`.

**Not Contract statuses:** LOI (Letter of Intent), contract award — these are separate
pre-contract commercial records for a future sprint.

---

## Decision 4 — Contract Aggregate Structure

**Rule CONST-CONTRACT-002:** `Contract` owns a Commercial Terms group. These concepts must
not be scattered as ad-hoc fields on downstream entities:

- RetentionTerms (1:1)
- AdvanceTerms (1:many)
- Guarantees (1:many)
- Billing model
- Currency
- Taxes (future — structure reserved)

**Contract fields:**
```
id                     cuid
projectId              cuid              FK → Project (RESTRICT)
organizationId         cuid              denormalized
clientId               cuid              FK → Client (RESTRICT)
boqVersionId           cuid              FK → BoqVersion — the contractual scope baseline
contractNumber         string(50)        unique within org
contractValue          Decimal(18,2)     signed value — independent from BOQ total
currency               string(3)         ISO 4217
billingModel           enum              MEASURED_IPC | MILESTONE | TIME_AND_MATERIAL | HYBRID
status                 enum              see lifecycle above
clientNameSnapshot     string            immutable snapshot at ACTIVE
clientTaxSnapshot      string?           immutable snapshot at ACTIVE
startDate              Date?
expectedEndDate        Date?
createdBy              cuid
createdAt / updatedAt  DateTime
```

**Rule CONST-CONTRACT-003:** `contractValue` is stored independently from the BOQ version
total. They are related but represent different business concepts and may legitimately differ
after negotiation.

**Rule CONST-CONTRACT-004:** `boqVersionId` references the exact BOQ version accepted as the
contractual scope baseline. BOQ baselining does NOT imply a Contract exists. The Contract
creation is an explicit, separate business event.

---

## Decision 5 — ContractRetentionTerms (1:1)

**Rule CONST-CONTRACT-005:** One retention configuration per Contract for Sprint 3.
Multi-pool retention (separate Civil, MEP, or performance pools) is not implemented
unless a real customer requires it.

```
ContractRetentionTerms fields:
  contractId            cuid       FK → Contract (CASCADE, UNIQUE)
  retentionRate         Decimal(5,4)   e.g. 0.0500 = 5%
  retentionCap          Decimal(5,4)   e.g. 0.1000 = 10% of contract value
  retentionSplitOnPC    Decimal(5,4)   fraction released at practical completion, e.g. 0.5000
  retentionReleasedAt   DateTime?
```

---

## Decision 6 — ContractAdvanceTerm (1:many)

**Rule CONST-CONTRACT-006:** Multiple advance types may be configured per Contract.

```
ContractAdvanceTerm fields:
  id             cuid
  contractId     cuid        FK → Contract (CASCADE)
  advanceType    enum        MOBILIZATION | MATERIAL_ON_SITE | EQUIPMENT | OTHER
  description    string?
  amount         Decimal(18,2)?   set if advance is a fixed amount
  percentage     Decimal(5,4)?    set if advance is a % of contract value
  recoveryMethod string       description of recovery approach
  recoveryRate   Decimal(5,4)    % deducted from each IPC until fully recovered
```

Actual advance disbursements and recovery deductions are separate financial transactions —
not stored on this entity.

---

## Decision 7 — ContractGuarantee (1:many)

**Rule CONST-CONTRACT-007:**

```
ContractGuarantee fields:
  id             cuid
  contractId     cuid        FK → Contract (CASCADE)
  guaranteeType  string      configurable — PERFORMANCE and ADVANCE_PAYMENT confirmed for ACCO
  amount         Decimal(18,2)
  currency       string(3)
  issuer         string      e.g. bank name
  beneficiary    string
  issueDate      Date
  expiryDate     Date
  status         enum        ACTIVE | DISCHARGED | EXPIRED | CALLED
  notes          string?
```

**Rule CONST-CONTRACT-008:** Guarantee types are organization-configurable strings.
PERFORMANCE and ADVANCE_PAYMENT are confirmed ACCO requirements. Retention, tender/bid,
warranty, and other types are supported structurally but not yet confirmed.

**Rule CONST-CONTRACT-009:** Guarantee expiry alerts are required. The alert mechanism
(notification, email, dashboard badge) is a platform concern — not defined here.

---

## Decision 8 — ContractMilestone (schema foundation only)

**Rule CONST-CONTRACT-010:** Name is `ContractMilestone` (not `Milestone`). Future sprints
will introduce `ProjectMilestone`, `ScheduleMilestone`, and `BillingMilestone` — the entity
type must be unambiguous.

```
ContractMilestone fields (foundation schema only — no workflow):
  id             cuid
  contractId     cuid     FK → Contract (CASCADE)
  name           string
  description    string?
  dueDate        Date?
  completedAt    DateTime?
  completedBy    cuid?
  sortOrder      int
```

Full milestone certification and invoice-generation workflows are deferred.

---

## Decision 9 — BOQ Node Extensions (Sprint 3 migration)

**Rule CONST-BOQ-010:** Add two fields to `BoqNode` (migration against existing table):

```
measurementMethod   enum    QUANTITY | PERCENTAGE | MILESTONE
pricingBasis        enum    UNIT_RATE | LUMP_SUM
```

**Rule CONST-BOQ-011:**
- `measurementMethod` is a property of the BOQ leaf item. It defines the contractual
  measurement method and must remain consistent across all payment applications referencing
  that node. `InterimPaymentApplicationItem` uses this method and stores an immutable
  snapshot at submission — but does NOT independently select a different method.
- `LUMP_SUM` is a pricing basis, not a measurement method. A lump-sum item may still be
  measured by percentage or milestone completion.
- Application items must map only to claimable **leaf** BOQ nodes. Parent/structural nodes
  are for grouping and subtotals, not billing.
- Lump-sum or milestone claims are represented as explicit leaf BOQ items with the
  appropriate `measurementMethod`.

Future `pricingBasis` values (`SCHEDULE_OF_RATES`, `TARGET_COST`) are not added until a
real requirement exists.

---

## Decision 10 — WorkflowRequirementPolicy

**Rule PLAT-WF-010:** Introduce a `WorkflowRequirementPolicy` table scoped by entity
type and transition. The resolver checks this table **before** binding lookup.

```
WorkflowRequirementPolicy fields:
  id             cuid
  entityType     string    e.g. "Project", "InterimPaymentApplication"
  fromState      string?   null = any source state
  toState        string
  requirement    enum      REQUIRED | OPTIONAL | NONE
  organizationId cuid?     null = tenant-wide default
```

**Rule PLAT-WF-011:** When `requirement = REQUIRED` and no active binding is found,
the transition is **rejected**. Missing configuration must never implicitly authorize
an operation.

**Rule PLAT-WF-012:** Do not model controlled entities as a hardcoded set in the resolver.
Requirements differ per transition and may differ per organization. Do not place the flag
on `WorkflowDefinition` — requirement resolution occurs before selecting a definition.

**Seeded as REQUIRED (Sprint 3):**
```
InterimPaymentApplication: DRAFT              → PENDING_INTERNAL_APPROVAL
InterimPaymentApplication: RETURNED_FOR_REV  → PENDING_INTERNAL_APPROVAL
Project:                   DRAFT             → APPROVED
Project:                   ACTIVE            → CANCELLED
Project:                   CLOSEOUT          → CLOSED
Project:                   PRACTICAL_COMPL.  → ACTIVE        (reopening)
Project:                   CLOSEOUT          → PRACTICAL_COMPL. (reopening)
```

**Rule PLAT-WF-013:** Remove all silent pass-through from `project.service.ts`. Every
approval-controlled transition must check `WorkflowRequirementPolicy` before proceeding.

---

## Decision 11 — InterimPaymentApplication Lifecycle

**Rule CONST-IPC-010:** The IPA is ACCO's internal commercial document. Lifecycle:

```
DRAFT → PENDING_INTERNAL_APPROVAL → APPROVED_FOR_SUBMISSION → SUBMITTED
```

- `RETURNED_FOR_REVISION`: from `PENDING_INTERNAL_APPROVAL` → back to `DRAFT`
- `CANCELLED`: from `DRAFT` or `RETURNED_FOR_REVISION` only

The DOA workflow fires at `PENDING_INTERNAL_APPROVAL`. Workflow completion automatically
advances to `APPROVED_FOR_SUBMISSION`. `SUBMITTED` is a **separate explicit command**.

**Rule CONST-IPC-011:** IPA is immutable once `SUBMITTED`.

**Rule CONST-IPC-012:** IPA application numbers are sequential integers per Contract:
- `UNIQUE(contractId, applicationNumber)`
- Assigned at `APPROVED_FOR_SUBMISSION` (not at DRAFT creation)
- Gaps permitted; numbers are never reused
- Display string (e.g., `IPA-ACCO-PROJ-001-003`) stored as an immutable snapshot
- Display format is organization-configurable — not hardcoded

**Rule CONST-IPC-013:** Store `exchangeRateSnapshot` (rate, base currency, date) on IPA
at creation. Historical totals must not change when exchange rates are updated.

---

## Decision 12 — InterimPaymentApplicationItem

**Rule CONST-IPC-014:**

```
InterimPaymentApplicationItem fields:
  id                          cuid
  applicationId               cuid        FK → InterimPaymentApplication
  boqNodeId                   cuid        FK → BoqNode — leaf nodes only
  measurementMethodSnapshot   enum        immutable copy of BoqNode.measurementMethod at submission
  unitRateSnapshot            Decimal(18,2)  immutable copy from BOQ version at submission
  currencySnapshot            string(3)
  cumulativeClaimed           Decimal(18,3)  total quantity/% claimed to date including this application
  previousEffectiveCertified  Decimal(18,3)  certified value from last effective certificate (denormalized)
  periodQuantity              Decimal(18,3)  derived: cumulativeClaimed − previousEffectiveCertified
  periodAmount                Decimal(18,2)  derived: periodQuantity × unitRateSnapshot
```

**Rule CONST-IPC-015:** Claimed and certified values are always stored separately.
Cumulative quantities are used (not period-only) for a self-correcting audit trail.

---

## Decision 13 — InterimPaymentApplicationDeduction

**Rule CONST-IPC-016:** Deductions are applied at IPA header level as immutable
deduction-line records — not embedded as scalar fields.

```
InterimPaymentApplicationDeduction fields:
  id             cuid
  applicationId  cuid           FK → InterimPaymentApplication
  deductionType  string         e.g. RETENTION, ADVANCE_RECOVERY, TAX
  sourceTermId   cuid?          FK → ContractRetentionTerms or ContractAdvanceTerm
  rate           Decimal(5,4)?
  basis          Decimal(18,2)  amount the rate is applied to
  amount         Decimal(18,2)  computed deduction amount
```

Application deductions and client-certificate deductions are **separate entities**.

---

## Decision 14 — InterimPaymentCertificate (Independent Aggregate)

**Rule CONST-IPC-020:** `InterimPaymentCertificate` is an independent aggregate root.
It references `applicationId` but is not owned by the IPA aggregate.

**Rationale:** Zero or more certificates may exist per application — partial, revised,
withdrawn, or superseding certificates all occur in practice.

**Lifecycle (terminal statuses — no further change):**
```
CERTIFIED | PARTIALLY_CERTIFIED | REJECTED
```

**Rule CONST-IPC-021:** At most one certificate may be "effective" per application.
Enforced by partial unique index:

```sql
CREATE UNIQUE INDEX "ipc_one_effective_per_application"
ON "interim_payment_certificates"("application_id")
WHERE "is_effective" = true;
```

`isEffective` is a domain-controlled field — not exposed as a normal editable boolean.

**Rule CONST-IPC-022:** First valid certificate (`CERTIFIED` or `PARTIALLY_CERTIFIED`)
becomes effective automatically on issue.

**Rule CONST-IPC-023:** A later revised certificate supersedes the current effective
certificate through an **explicit atomic command** only:
- Old certificate: `isEffective = false`, `supersededAt`, `supersededById`, `reason` set
- New certificate: `isEffective = true`, `effectiveAt` set
- Audit history preserved; no effective certificate is ever hard-deleted

**Rule CONST-IPC-024:** `InterimPaymentCertificate` is immutable once issued.
Store `exchangeRateSnapshot` at issuance.

---

## Decision 15 — InterimPaymentCertificateItem

**Rule CONST-IPC-025:** Certificates contain line-level `InterimPaymentCertificateItem`
records linked to the original application items.

```
InterimPaymentCertificateItem fields:
  id                  cuid
  certificateId       cuid        FK → InterimPaymentCertificate
  applicationItemId   cuid        FK → InterimPaymentApplicationItem
  certifiedQuantity   Decimal(18,3)
  certifiedAmount     Decimal(18,2)
  varianceQuantity    Decimal(18,3)   derived: certifiedQuantity − claimedQuantity
  varianceReason      string?         REQUIRED when certifiedQuantity ≠ claimedQuantity
```

All rows are immutable once the certificate is issued.

**Rule CONST-IPC-026:** To validate line-level vs header-level certification practice,
obtain a real ACCO certificate sample. Rukna supports line-level certification as the
canonical model.

---

## Decision 16 — InterimPaymentCertificateDeduction

Same structure as `InterimPaymentApplicationDeduction`. Client-certificate deductions
(retention, advance recovery, tax, penalties) are separate from application deductions.

---

## Decision 17 — PaymentReceipt and ReceiptAllocation

**Rule CONST-FIN-010:** `PAID`, `PARTIALLY_PAID`, `UNPAID` are **not** statuses on
`InterimPaymentCertificate`. Payment state is derived from `ReceiptAllocation` records.

```
PaymentReceipt fields:
  id               cuid
  organizationId   cuid
  clientId         cuid        FK → Client
  receiptDate      Date
  amount           Decimal(18,2)
  currency         string(3)
  exchangeRate     Decimal(18,6)?
  reference        string?      bank reference / payment advice number
  notes            string?
  createdBy        cuid
  createdAt        DateTime
```

```
ReceiptAllocation fields:
  id               cuid
  receiptId        cuid        FK → PaymentReceipt
  certificateId    cuid        FK → InterimPaymentCertificate
  allocatedAmount  Decimal(18,2)
  allocatedAt      DateTime
  allocatedBy      cuid
```

**Rule CONST-FIN-011:** There is no direct FK from `PaymentReceipt` to
`InterimPaymentCertificate`. `ReceiptAllocation` is the join. This supports partial
payments and many-to-many settlement.

---

## Decision 18 — DocumentAttachment Pattern

**Rule PLAT-FILE-010:** Commercial entities must not store file paths or URLs directly.
Reference the platform file module through dedicated attachment join tables.

```
ContractAttachment:   contractId   + platformFileId
GuaranteeAttachment:  guaranteeId  + platformFileId
IpaAttachment:        applicationId + platformFileId
IpcAttachment:        certificateId + platformFileId
```

The platform `File` aggregate (future sprint) owns storage. Attachment join tables are
light bridge records.

---

## Phase Plan

| Phase | Deliverable | Key entities |
|---|---|---|
| 1 — Platform | Client aggregate, WorkflowRequirementPolicy, Project extensions, BOQ node extensions | Client, ClientContact, WorkflowRequirementPolicy; migrations on projects + boq_nodes |
| 2 — Contract | Full Contract module | Contract, ContractRetentionTerms, ContractAdvanceTerm, ContractGuarantee, ContractMilestone (schema only), ContractAttachment |
| 3 — IPC | Application and certificate | InterimPaymentApplication, InterimPaymentApplicationItem, InterimPaymentApplicationDeduction, InterimPaymentCertificate, InterimPaymentCertificateItem, InterimPaymentCertificateDeduction, IpaAttachment, IpcAttachment |
| 4 — Finance | Payment receipts | PaymentReceipt, ReceiptAllocation |

---

## Rules Index (Sprint 3)

```
CONST-PROJ-010   commercialModel / participationModel fields on Project
CONST-PROJ-011   Project categories are configurable records, not enums
CONST-CLIENT-001 Client aggregate is mandatory in Sprint 3 — no plain-text client fields on Contract
CONST-CLIENT-002 Contract snapshots client legal details at ACTIVE transition
CONST-CONTRACT-001 Contract lifecycle
CONST-CONTRACT-002 Contract owns Commercial Terms group
CONST-CONTRACT-003 contractValue is independent from BOQ version total
CONST-CONTRACT-004 boqVersionId = scope baseline; BOQ baselining ≠ Contract created
CONST-CONTRACT-005 ContractRetentionTerms is 1:1 with Contract
CONST-CONTRACT-006 ContractAdvanceTerm is 1:many with Contract
CONST-CONTRACT-007 ContractGuarantee is 1:many with Contract
CONST-CONTRACT-008 Guarantee types are organization-configurable
CONST-CONTRACT-009 Guarantee expiry alerts are required
CONST-CONTRACT-010 ContractMilestone (schema only) — name is unambiguous
CONST-BOQ-010   measurementMethod and pricingBasis added to BoqNode
CONST-BOQ-011   measurementMethod is leaf-node property; items must map to leaf nodes only
PLAT-WF-010     WorkflowRequirementPolicy table
PLAT-WF-011     REQUIRED transition with no active binding → rejected
PLAT-WF-012     Do not hardcode controlled-entity set; do not put flag on WorkflowDefinition
PLAT-WF-013     Remove all silent pass-through from project.service.ts
CONST-IPC-010   InterimPaymentApplication lifecycle
CONST-IPC-011   IPA immutable once SUBMITTED
CONST-IPC-012   IPA numbering: UNIQUE(contractId, applicationNumber), assigned at APPROVED_FOR_SUBMISSION
CONST-IPC-013   exchangeRateSnapshot frozen on IPA at creation
CONST-IPC-014   InterimPaymentApplicationItem structure
CONST-IPC-015   Cumulative quantities; claimed and certified always separate
CONST-IPC-016   Deductions as immutable deduction-line records
CONST-IPC-020   InterimPaymentCertificate is independent aggregate root
CONST-IPC-021   Partial unique index: one effective certificate per application
CONST-IPC-022   First valid certificate becomes effective automatically
CONST-IPC-023   Supersession is an explicit atomic command
CONST-IPC-024   IPC immutable on issue; exchangeRateSnapshot at issuance
CONST-IPC-025   InterimPaymentCertificateItem: line-level, varianceReason required on mismatch
CONST-IPC-026   Validate line-level certification against real ACCO certificate sample
CONST-FIN-010   PAID/PARTIALLY_PAID/UNPAID derived from ReceiptAllocation — not IPC status
CONST-FIN-011   No direct FK PaymentReceipt → IPC; use ReceiptAllocation
PLAT-FILE-010   Attachment join tables; no raw file paths on commercial entities
```
