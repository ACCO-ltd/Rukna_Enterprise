# Rukna ERP — Platform Roadmap

Version: 2.0.0
Last Updated: 2026-08-12
Owner: Abdulsalam (Backend Engineer)
Reviewed by: Eng Ahmed Shirie (CEO, ACCO Ltd)

---

## Statement to the CEO

We have built **financial operations for construction** — contracts, client billing, certified
amounts, receipts, retention, advances, and project commercial tracking.

We have **not yet built full accounting**.

Full accounting includes the General Ledger, Accounts Payable, Accounts Receivable, banking,
journal entries, trial balance, financial statements, period closing, and tax controls.

These are not the same thing. Construction billing tracks what is owed and what has been paid.
Full accounting tracks every financial transaction in a double-entry system, produces auditable
financial statements, and closes accounting periods formally.

Both are required. The roadmap below builds them in the correct sequence.

---

## Sprint Map

| Sprint | Title | Status |
|---|---|---|
| **Sprint 1** | Platform Foundation | ✅ Complete |
| **Sprint 2** | Projects and BOQ | ✅ Complete |
| **Sprint 3** | Contracts and Client Billing | ✅ Complete |
| **Sprint 4** | Accounting Foundation | ✅ Complete |
| **Sprint 4 Frontend** | Accounting Workspace UI | ✅ Complete (10 of 12 screens — see below) |
| **Sprint 5** | Procurement, AP Integration, and Commitment Control | ✅ Complete |
| **Sprint 5 Frontend** | Procurement Workspace UI | ⏳ Next — Frontend Engineer |
| **Post-Sprint 5** | Architecture Review + Cross-Cutting Quality Work | ✅ Complete |
| **Sprint 6 Backend** | Governance seam + loop-back, RBAC, Project Actual P&L, receipts fix | ✅ Delivered 2026-08-13 (merged to `main`, 197 tests) |
| **Sprint 6 Frontend** | Surface the governance/approval flow + project P&L (see `docs/01-capability-matrix.md` for what's built vs pending UI) | ⏳ Next — Frontend Engineer |
| **Sprint 6** | Variations / Change Management (ChangeOrder) | ⏳ Blocked on #51 (Eng Ahmed) |
| **Sprint 7** | Inventory and Project Costing | Planned |
| **Sprint 8** | Accounts Receivable, Cash and Banking | Planned |
| **Sprint 9** | Site Operations, Labour and Equipment | Planned |
| **Sprint 10** | Financial Close and Reporting | Planned |

---

## What Each Sprint Delivered or Will Deliver

### Sprint 1 — Platform Foundation ✅

Auth (JWT, HttpOnly refresh cookie, jti rotation), Users, Organizations, Roles, Permissions,
Audit Logs, Workflow/DOA engine (ApprovalInstance, ApprovalAction), Exchange Rates, i18n,
multi-tenancy (one PostgreSQL DB per tenant, subdomain resolution, LRU Prisma client cache).

### Sprint 2 — Projects and BOQ ✅

Project lifecycle (DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION →
CLOSEOUT → CLOSED, plus CANCELLED and reopen transitions), project membership, suspension,
BOQ versioning (DRAFT/BASELINED/SUPERSEDED), materialized-path tree, node move.

### Sprint 3 — Contracts and Client Billing ✅

Client aggregate, WorkflowRequirementPolicy, BOQ node extensions (measurementMethod,
pricingBasis), Project commercial/participation model, Contract lifecycle (DRAFT →
UNDER_REVIEW → PENDING_SIGNATURE → ACTIVE → FINAL_ACCOUNT_PENDING → CLOSED),
ContractRetentionTerms, ContractAdvanceTerm, ContractGuarantee, ContractMilestone,
InterimPaymentApplication, InterimPaymentApplicationItem, InterimPaymentApplicationDeduction,
InterimPaymentCertificate (isEffective partial unique index, supersession),
InterimPaymentCertificateItem (varianceReason enforcement),
PaymentReceipt, ReceiptAllocation (payment status derived from allocations).

> **What Sprint 3 is not:** It does not include a General Ledger, Accounts Payable, Accounts
> Receivable, journal entries, or financial statements. Those begin in Sprint 4.

---

### Sprint 4 — Accounting Foundation ✅ Complete

Built the complete double-entry accounting platform. The backend is production-ready and
verified with 87 integration tests across all accounting invariants.

**What was built:**

| Layer | Delivered |
|---|---|
| **Chart of Accounts** | Account hierarchy, account versions (immutable history), normal balance, account classes (ASSET, LIABILITY, EQUITY, INCOME, COST_OF_SALES, EXPENSE), control account policy |
| **Fiscal Years + Periods** | FiscalYear entity, AccountingPeriod (OPEN / LOCKED / CLOSED / REOPENED), period state machine |
| **Double-entry posting engine** | ∑ debits = ∑ credits enforced at commit, period validator, account version resolver, document sequence numbering |
| **Manual Journals** | DRAFT → SUBMITTED → APPROVED → POSTED lifecycle, CFO approval workflow, reversal with swapped Dr/Cr |
| **Accounts Receivable** | ClientInvoice (from IPC), post to AR control account, CustomerReceipt post, receipt-to-invoice allocation, reversal |
| **Accounts Payable** | SupplierBill create/post, SupplierPayment post, advance allocation to bill, reversal chain |
| **Opening Balances** | Migration wizard (trial balance + open AR invoices + open AP bills) |
| **General Ledger** | Account ledger with running balance, GL balance as-of-date, source document drill-down |
| **Trial Balance** | Opening / period movement / closing columns, debit=credit validation, CLOSED period uses frozen snapshot |
| **Profit & Loss** | Revenue / CoS / Gross Profit / Expenses / Net Income, excludes CLOSING entries, project/department filters, monthly comparison |
| **Balance Sheet** | Assets / Liabilities / Equity, Current Year Earnings (live P&L for open FY), equation validation, snapshot path for CLOSED periods |
| **PeriodAccountBalance snapshots** | Generated on period close, chained (period N opening = period N-1 closing), invalidated on reopen, sequential rebuild |
| **Period management** | lockPeriod (OPEN→LOCKED), closePeriod (LOCKED→CLOSED + snapshot), reopenPeriod (CLOSED→REOPENED + downstream invalidation), close-gate pre-flight |
| **Year-end close** | Closing journal (zero P&L → Retained Earnings), Period 12 snapshot, FiscalYear CLOSED |
| **REST API** | All 10 accounting modules have controllers, DTOs, JwtAuthGuard, Swagger docs |
| **Integration tests** | 87/87 passing — all accounting invariants verified |

**Verified accounting invariants:**

```
∑ Debits = ∑ Credits on every posted JournalEntry
Trial Balance total closing debit = total closing credit
Balance Sheet: Assets = Liabilities + Equity (within $0.01)
P&L net income = Current Year Earnings in Balance Sheet
P&L by project + P&L by department reconcile to company P&L
CLOSING entries excluded from P&L
Closed periods use PeriodAccountBalance snapshots
Reopened periods invalidate downstream snapshots
Period close gate blocks unresolved conditions
All queries org-scoped (cross-tenant access blocked)
```

**API reference:** See `api-reference.md` Section 6.13 onwards.

**Sprint 4 does not include:**

- Full tax filing or VAT return computation
- Payroll journal automation
- Fixed assets and depreciation
- Consolidation across legal entities
- Advanced bank reconciliation (statement import)
- Statutory financial statement PDF templates
- Cash Flow statement (deferred — requires direct method or indirect computation)

---

### Sprint 4 Frontend — Accounting Workspace UI ✅ Complete

Delivered 2026-08-09. Ten screens under `/finance/accounting`, each in English and Arabic
with RTL, working at 375px, and covered by tests. 730 frontend tests passing.

| Tier | Screens |
|---|---|
| **A — Setup** | Chart of Accounts · Fiscal Periods |
| **B — Entry** | Manual Journals — list, editor, and detail carrying the full DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED lifecycle |
| **C — Reporting** | Trial Balance · Profit & Loss · Balance Sheet · Account Ledger · Monthly Comparison |
| **D — Period management** | Lock · Close, with the close-gate pre-flight · Reopen · Snapshot rebuild · Year-end close |

**Four screens were cut, and each for a backend blocker rather than a scope choice.**

Tier B2 (Client Invoices) and B3 (Customer Receipts) sit on `/receipts`, where two
controllers are mounted at the same path — Sprint 3's `FinanceModule` registers first and
shadows Sprint 4's `CustomerReceipt` list, detail and allocate routes, returning the wrong
entity with a `200` ([#24](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/24)).

Supplier Bills and Supplier Payments are not buildable at all: `POST /bills` requires a
`supplierId`, and nothing in the API lists, creates or seeds a supplier
([#26](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/26)). Both are declared in the
navigation and disabled, so the gap reads as pending rather than forgotten.

**Open blockers**, all found by a contract sweep run *before* any screen was written:
[#24](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/24) the route collision ·
[#25](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/25) the accounting module has no
authorization of any kind, so any signed-in user can close a fiscal year ·
[#26](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/26) no supplier or posting-profile
endpoints.

Seven further contract and documentation defects are recorded as A4–A10 in
`docs/backend-requests/frontend-blockers.md`. Three of them — the create-bill body, the
create-account body, and every GL account code in the section — mean a request copied
faithfully out of `api-reference.md` §6.13–6.23 fails with a `400` or a `404`. **Read the
controllers, not the reference, until those are fixed.**

---

### Sprint 5 — Procurement, AP Integration, and Commitment Control ✅ Complete

Built the complete purchasing chain from site need to supplier payment, with full cost
commitment tracking and three-way bill matching. AP (SupplierBill, SupplierPayment) was
built in Sprint 4 — Sprint 5 integrates procurement into it rather than rebuilding it.

**Architecture decisions:** See `adr/ADR-007-sprint5-procurement.md`.

**What was built:**

| Layer | Delivered |
|---|---|
| **Master data** | `UnitOfMeasure` (org-configurable), `MaterialCategory`, `SpendCategory`, `Material` catalogue |
| **Material Request** | Dual-scope (PROJECT \| ORGANIZATION), multi-line, BOQ-linked, DOA approval |
| **Purchase Order** | Immutable revisions (`PurchaseOrder` + `PurchaseOrderRevision` + `PurchaseOrderLine`); DOA value-threshold routing |
| **MR↔PO allocation** | Many-to-many junction (`PurchaseOrderLineRequestAllocation`) for consolidation and split purchasing |
| **Goods Receipt** | `GoodsReceiptNote` + `GoodsReceiptLine` (received vs accepted vs rejected); `GoodsReceiptLineAllocation` for per-project attribution |
| **Bill matching** | `SupplierBillMatch` + `SupplierBillMatchLine` — explicit audit result; `MatchingTolerancePolicy` (hierarchical); THREE_WAY for materials, TWO_WAY for services |
| **Commitment Ledger** | Immutable `CommitmentLedgerEntry`: COMMITTED (PO) → ACCRUED (GRN) → ACTUAL (Bill posted); allocation-level attribution preserves project/BOQ breakdown |
| **DOA extension** | Condition expressions on `WorkflowRequirementPolicy`; immutable approval snapshot on `ApprovalInstance` |
| **Over-receipt** | Configurable tolerance band; `EXCEPTION_PENDING` above tolerance; no negative committed balances |
| **Variation readiness** | `BOQNode.sourceType: BASELINE \| VARIATION` and `BOQNode.sourceChangeOrderId?` prepared |

**Complete procurement chain:**

```
Material Request (approved)
  ↓ PurchaseOrderLineRequestAllocation (many-to-many MR↔PO)
Purchase Order Revision (ACTIVE)
  ↓ CommitmentLedger: COMMITTED +amount (per allocation, per project/BOQ)
Goods Receipt Note (POSTED)
  ↓ CommitmentLedger: COMMITTED −amount, ACCRUED +amount (accepted qty only)
Supplier Bill (prefilled from GRN, matched)
  ↓ CommitmentLedger: ACCRUED −amount, ACTUAL +amount
  ↓ GL JournalEntry: Dr Expense / Cr Accounts Payable
Supplier Payment (posted)
  ↓ GL JournalEntry: Dr Accounts Payable / Cr Bank
```

**File attachments foundation — NOT built (correction 2026-08-14):**
This was planned for Sprint 5 but was **not** delivered. There is no shared file-serving
layer, no S3-compatible storage, and no `PlatformFile`/`Attachment` aggregate in the code.
What exists today is **per-entity attachment metadata rows** (`ContractAttachment`,
`IpaAttachment`, `IpcAttachment`, `GuaranteeAttachment`, `JournalEntryAttachment`) that record
a reference but cannot store or serve a file. The design lives in ADR-014; implementation is
still pending. See `docs/01-capability-matrix.md`.

**Not in Sprint 5:** Variations/ChangeOrders, SupplierReturn, UoM conversion, warehouse
management, stock ledger, inventory valuation, Approved Supplier List.

---

### Post-Sprint 5 — Architecture Review + Cross-Cutting Quality Work ✅ Complete

After Sprint 5, a full codebase architecture review was run to eliminate technical debt
before Sprint 6. Five candidates were identified and resolved.

**ADR-008 completion — Transactional Audit Outbox fully wired:**

All 7 business modules now write `AuditLog` + `AuditOutboxEvent` in the same Prisma
transaction as their business mutation. The legacy HTTP interceptor is no longer the
compliance record for any of these commands.

| Module | Migrated command(s) |
|---|---|
| IPC | `ipc.certify`, `ipc.supersede` |
| IPA | `ipa.create`, `ipa.transition`, `ipa.cancel` |
| Projects | `project.transition`, `project.cancel`, `project.suspend`, `project.resume` |
| Contracts | `contract.transition`, `contract.cancel` |
| MaterialRequest | `mr.create`, `mr.submit`, `mr.approve`, `mr.reject`, `mr.cancel` |
| PurchaseOrder | `po.create`, `po.submit`, `po.approve`, `po.revise`, `po.cancel` |
| GoodsReceiptNote | `grn.create`, `grn.post`, `grn.cancel`, `grn.approve-exception` |

**CommandGovernanceService — new platform seam (ADR-009-adjacent):**

`CommandGovernanceService.gateStateTransition()` now hides `WorkflowTriggerResolverService`
and `ApprovalInstance` creation behind a single call. Services no longer import the resolver
directly. Throws `409 ConflictException` with `approvalInstanceId` in the body when a
transition is gated, so the frontend can redirect to the approval workflow.

**Architecture Review — 5 candidates resolved:**

| # | Candidate | What changed |
|---|---|---|
| 01 | BillMatchingService — typed repo queries | 4 `(prisma as any)` blocks moved to typed `BillMatchRepository` methods; latent `documentStatus`/`postingStatus` bug fixed |
| 02 | CommitmentLedgerWriter | New `CommitmentLedgerWriter` service wraps the repo — `committed()`, `accrued()`, `actual()` — auto-computing `reportingAmount` and `occurredAt`, eliminating 12+ field repetition across 3 services |
| 03 | SupplierBillService — required dependency | `@Optional() CommitmentLedgerRepository?` replaced with required `CommitmentLedgerWriter`; silent failure path eliminated |
| 04 | spendCategoryId casts | 7 `(line as any).spendCategoryId` casts removed — field was always in Prisma return type |
| 05 | GovernedEntity type | `type GovernedEntity` added to `@erp/types`; `gateStateTransition()` now typed at the entry point — typos are compile errors |

---

### Sprint 6 Backend — Governance, RBAC, Reporting ✅ Delivered 2026-08-13

The Sprint 6 backend prerequisites and the cross-cutting governance/quality work landed and
merged to `main`. **197 integration tests green.** ADRs 011–015 record the decisions.

| Area | Delivered |
|---|---|
| **RBAC** | `PermissionsGuard` wired as global `APP_GUARD`; accounting + procurement controllers declare `@RequirePermissions`; JWT carries permissions. Verified with an HTTP e2e returning `403`. Closes #25/#28. |
| **Approval seam (ADR-011)** | PO `submit`, SupplierBill `submit`, SupplierPayment `approve` route through `CommandGovernanceService.gateStateTransition` (the same seam IPA/Project use). `GovernedEntity` extended. Backward-compatible: no binding → proceeds. |
| **Approval loop-back (ADR-015)** | Re-drive mechanism — a gated command re-invoked after its instance is `APPROVED` consumes it and completes the transition. Governance is now **functional end-to-end**, not just armed. |
| **Project Actual P&L (ADR-013)** | `GET /projects/:id/pl` + `journal_lines` dimension indexes. Posted-GL-only; excludes commitments. The rich _Project Financial Position_ is a **separate read model — now built** (`GET /projects/:id/financial-position`, `ProjectFinancialPositionController/Service`): actual cost + remaining committed cost (COMMITTED + ACCRUED) + forecast margin. |
| **Receipts** | `POST /receipts` fixed (it 500'd on every call). The A12 domain question (one settlement ledger vs two) remains open for Eng Ahmed. |
| **Sweep landed** | Commitment-ledger fixes (#31), AP fixes (#33/#34/#35/#36/#42), B16 approval-gate (#45), plus ADR-008/009/010 subsystems, all committed and tested. |

**Not yet done (deliberately):** value-threshold routing (needs Eng Ahmed's CFO/CEO thresholds),
SoD wiring (`SegregationOfDutiesService` has no callers), and a dedicated `CONSUMED` approval
status. (The rich Project Financial Position read model has since been built — see ADR-013 and
`GET /projects/:id/financial-position`.) For the current backend/frontend status of every
capability, see `docs/01-capability-matrix.md`.

---

### Sprint 6 — Variations / Change Management

Builds the full contract variation workflow, now that Procurement is stable and
BOQ nodes already carry `sourceType` provenance.

**What is built:**

```
ChangeOrderRequest     — logged scope change (description, cause, initiator)
→ ChangeOrderPricing   — QS estimate of cost and time impact
→ ChangeOrder          — approved variation (linked to Contract)
→ BOQNode additions    — sourceType = VARIATION, sourceChangeOrderId populated
→ IPA items            — claimed against variation BOQ nodes (same IPA flow)
→ IPC items            — certified against variation BOQ nodes (same IPC flow)
→ SupplierReturn       — for rejected GRN goods
→ Approved Supplier List / Supplier Qualification
```

**Variation lifecycle:**

```
DRAFT → SUBMITTED_FOR_INTERNAL_APPROVAL → APPROVED_INTERNALLY
      → SUBMITTED_TO_CLIENT → CLIENT_APPROVED → EXECUTED
      → CANCELLED / CLIENT_REJECTED
```

Because Procurement already understands `boqNodeId` and BOQNode will carry
`sourceChangeOrderId`, Procurement automatically inherits variation cost traceability.
No procurement redesign required.

**Rules:**
- A variation must link to a Contract in ACTIVE or FINAL_ACCOUNT_PENDING status
- Variation BOQ nodes extend the contract's BOQ version — they do not create a new version
- The contract value increases automatically when a ChangeOrder reaches EXECUTED status
- Every variation carries a cause code: CLIENT_INSTRUCTION, DESIGN_CHANGE,
  UNFORESEEN_CONDITION, SCOPE_OMISSION, OTHER

---

### Sprint 7 — Inventory and Project Costing

- Warehouses and site stores
- Immutable stock ledger (entries are never updated or deleted)
- UoM conversion (`UoMConversion` entity)
- Stock transfers, issues, returns, adjustments
- Inventory valuation
- Project material consumption
- Budget vs commitments, received exposure, actual consumption reporting

> **Important distinction:**
> Buying material creates inventory or a supplier liability.
> Issuing material to a construction site creates project cost.
> Never charge a full warehouse purchase to one project unless it was a direct project purchase.

---

### Sprint 8 — Accounts Receivable, Cash and Banking

Upgrades Sprint 3's operational client billing records into formal accounting integration.

```
Certified IPC → Client Invoice (AR) → Receipt → Receipt Allocation → Bank
```

**Entities:**

- Customer accounts
- Accounts receivable ledger
- Client invoices and credit/debit notes
- Receipt posting (creates AR clearing entry)
- Receipt allocation to invoices
- AR aging report
- Cash and bank accounts
- Basic bank reconciliation (statement import, match, post difference)

Sprint 3's `PaymentReceipt` remains useful for operational tracking but will now generate
proper double-entry accounting entries through posting rules.

---

### Sprint 9 — Site Operations, Labour and Equipment

Feeds project costing and operational reporting from site sources.

- Daily progress reports
- Measurement sheets
- Labour attendance and timesheets
- Equipment logs and cost allocation
- Subcontract certificate processing
- Integration with payroll or labour accrual

All site cost sources feed into the `ProjectCostLedger` and through posting rules into
the General Ledger.

---

### Sprint 10 — Financial Close and Reporting

- Period closing checklist and workflow
- Accrual journals and reversing journals
- Trial balance (current and comparative periods)
- Profit and Loss statement
- Balance Sheet
- Cash Flow statement
- AP reconciliation
- AR reconciliation
- Project-to-GL reconciliation
- Foreign-exchange gain/loss calculation and posting
- Tax reporting (requirements confirmed with ACCO's financial officer)
- Opening balance migration tools
- Go-live controls and validation reports

---

## Pre-Sprint 4 Discovery: Financial Officer Requirements

Do not wait until Sprint 4 coding begins. Start discovery during the final days of Sprint 3.

Meet the financial officer and collect:

**Documents:**
- Current chart of accounts
- Trial balance (most recent)
- Existing accounting software and export formats
- Fiscal year and period rules
- Sample client invoice
- Sample supplier invoice
- Sample receipt / payment voucher
- Sample journal voucher
- Bank statement and reconciliation format
- Tax rules (VAT, WHT, or equivalent for Somalia)
- Currency conversion policy
- Project cost report format
- Month-end closing checklist
- Approval limits for posting

**Walk through real transactions and ask for each step:**

```
1. What document is created?
2. Which account is debited?
3. Which account is credited?
4. Which date and exchange rate apply?
5. Who approves posting?
6. Can it be reversed?
7. Which report changes?
```

**Transactions to walk through:**

```
Client certificate → client invoice → receipt → bank
PO → goods receipt → supplier invoice → supplier payment
Warehouse purchase → stock issue → project cost
Payroll → project labour allocation → payment
```

---

## Required Architecture Decision Record

Before Sprint 4 begins, write:

**ADR-006 — Native Financial Accounting Architecture**

It must decide:

1. Accounting basis: accrual
2. General Ledger as the financial source of truth
3. Double-entry posting engine design
4. Chart-of-accounts structure and account types
5. Financial dimensions (Project, Department, CostCentre)
6. Journal lifecycle and immutability rules
7. Fiscal period and closing rules
8. Multi-currency posting approach
9. How operational accounting events are emitted by business modules
10. Posting-rule ownership and configuration
11. Reversal and correction model
12. Project subledger-to-GL reconciliation strategy
13. AP and AR subledger boundaries
14. Opening-balance migration approach
15. Role segregation and approval controls for financial posting

**ADR-006 must be reviewed by Eng Ahmed Shirie and the financial officer before Sprint 4 implementation begins.**

---

## Guiding Sequence

```
Commercial operations (client billing, contracts)
        ↓
Accounting foundation (GL, journals, periods, posting rules)
        ↓
Procurement + Accounts Payable (supplier chain into GL)
        ↓
Inventory + Project Costing (cost sources into GL)
        ↓
Accounts Receivable + Cash + Banking (client receipts into GL)
        ↓
Site cost sources (labour, equipment, subcontracts into GL)
        ↓
Financial close and statutory reporting
```

This sequence ensures every future transaction enters a financially coherent system.
Building procurement or inventory before the GL is in place creates technical debt that
is extremely difficult to correct later.
