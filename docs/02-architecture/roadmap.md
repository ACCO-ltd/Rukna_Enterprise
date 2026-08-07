# Rukna ERP — Platform Roadmap

Version: 1.0.0
Last Updated: 2026-08-03
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
| **Sprint 4 Frontend** | Accounting Workspace UI | ⏳ Next — Frontend Engineer |
| **Sprint 5** | Procurement, AP Integration, and Commitment Control | ✅ Complete |
| **Sprint 5 Frontend** | Procurement Workspace UI | ⏳ Next — Frontend Engineer |
| **Sprint 6** | Variations / Change Management | Planned |
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

### Sprint 4 Frontend — Accounting Workspace UI ⏳

The backend is complete and API-ready. The frontend engineer (Abdimalik) now builds the
accounting workspace so Finance can operate it without using the API directly.

**What to build:** See `frontend-design.md` Section 11 — Accounting Workspace.

**Dependency:** All endpoints listed in `api-reference.md` Section 6.13 are live and tested.

---

### Sprint 5 — Procurement, AP Integration, and Commitment Control ⏳ Next

Builds the complete purchasing chain from site need to supplier payment, with full cost
commitment tracking and three-way bill matching. AP (SupplierBill, SupplierPayment) was
built in Sprint 4 — Sprint 5 integrates procurement into it rather than rebuilding it.

**Architecture decisions:** See `adr/ADR-007-sprint5-procurement.md`.

**What is built:**

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

**File attachments foundation (also Sprint 5):**
Sprint 5 builds the shared file-serving layer (S3-compatible storage + `Attachment` entity).
Each subsequent sprint adds attachment support to its own entities.

**Not in Sprint 5:** Variations/ChangeOrders, SupplierReturn, UoM conversion, warehouse
management, stock ledger, inventory valuation, Approved Supplier List.

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
