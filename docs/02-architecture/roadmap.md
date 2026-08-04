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
| **Sprint 4** | Accounting Foundation | ⏳ Next |
| **Sprint 5** | Procurement, Accounts Payable and Variations | Planned |
| **Sprint 6** | Inventory and Project Costing | Planned |
| **Sprint 7** | Accounts Receivable, Cash and Banking | Planned |
| **Sprint 8** | Site Operations, Labour and Equipment | Planned |
| **Sprint 9** | Financial Close and Reporting | Planned |

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

### Sprint 4 — Accounting Foundation ⏳

Build the double-entry posting backbone **before** procurement. Every future transaction
(supplier invoice, client receipt, stock issue) must post into the General Ledger correctly.
Building procurement first and retrofitting accounting later is technically high-risk.

**Core entities:**

| Entity | Purpose |
|---|---|
| `ChartOfAccounts` | Configurable account tree per organization |
| `Account` | Individual GL account (asset, liability, equity, income, expense) |
| `FiscalYear` | Org-level fiscal year definition |
| `AccountingPeriod` | Monthly period within a fiscal year; OPEN / LOCKED / CLOSED |
| `Journal` | Logical grouping of entries (General, AP, AR, Payroll, etc.) |
| `JournalEntry` | A balanced posting event (header) |
| `JournalLine` | One debit or credit line on an entry |
| `FinancialDimension` | Cross-cutting analysis tags (Project, Department, CostCentre) |
| `PostingRule` | Maps accounting events → account assignments |
| `AccountingEvent` | Normalized event emitted by business modules (IPC issued, PO received, etc.) |

**Fundamental rules (non-negotiable):**

```
∑ Debits = ∑ Credits  on every posted JournalEntry
```

- Posted entries are **immutable**. Corrections happen through reversal entries only.
- Draft → Approved → Posted → (Reversed if needed)
- No period may be posted into after it is CLOSED.
- Financial dimensions make every posting traceable to a project, department, or cost centre.

**Sprint 4 delivers:**

- Configurable chart of accounts
- Fiscal years and accounting periods (open / lock / close)
- Manual journal entry (draft → approved → posted)
- Balanced journal validation (debit = credit enforced at post time)
- Reversal and replacement journal workflow
- Multi-currency journal lines
- Posting-rule configuration foundation
- AccountingEvent emission from Sprint 3 modules (IPC, PaymentReceipt)
- Trial balance
- General ledger report (by account, by period, by dimension)
- Audit history on every posting action

**Sprint 4 does not include:**

- Full tax filing
- Payroll journal automation
- Fixed assets and depreciation
- Consolidation across legal entities
- Advanced bank reconciliation
- Statutory financial statement templates

---

### Sprint 5 — Procurement, Accounts Payable and Variations

The full supplier purchasing chain plus contract variation management, with GL posting at every step.

**Procurement entities:**

```
Supplier
→ PurchaseRequisition
→ RequestForQuotation
→ SupplierQuotation
→ PurchaseOrder
→ GoodsReceiptNote
→ SupplierInvoice
→ SupplierPayment
```

**Example GL postings:**

| Event | Debit | Credit |
|---|---|---|
| Goods received | Inventory / Project Receipt | Goods Received Not Invoiced (GRNI) |
| Supplier invoice matched | GRNI + Recoverable Tax | Accounts Payable |
| Supplier payment | Accounts Payable | Bank |

Every posting scenario must be validated by the financial officer before acceptance.

Also includes Subcontract management and SubcontractCertificate.

---

**Variations / Change Orders**

Change orders are inserted into Sprint 5 because they touch Contract, BOQ, IPA and IPC — all of which are already built in Sprint 3 — and active projects generate variation claims before Sprint 9 is reached. Adding them here ensures variation work is traceable in the system as soon as procurement begins, rather than continuing on WhatsApp and Excel.

**Entities:**

```
ChangeOrderRequest     — logged scope change (description, cause, initiator)
→ ChangeOrderPricing   — QS estimate of cost and time impact
→ ChangeOrder          — approved variation (linked to Contract)
→ BOQ node additions   — new or modified BOQ nodes under the variation
→ IPA items            — claimed against variation BOQ nodes (same IPA flow)
→ IPC items            — certified against variation BOQ nodes (same IPC flow)
```

**Variation lifecycle:**

```
DRAFT → SUBMITTED_FOR_INTERNAL_APPROVAL → APPROVED_INTERNALLY
      → SUBMITTED_TO_CLIENT → CLIENT_APPROVED → EXECUTED
      → CANCELLED / CLIENT_REJECTED
```

Client approval is required before variation work begins (except documented emergency instructions).

**Rules:**
- A variation must link to a Contract in ACTIVE or FINAL_ACCOUNT_PENDING status
- Variation BOQ nodes extend the contract's BOQ version — they do not create a new version
- Variation items on an IPA are claimed and certified using the same IPA/IPC flow as original scope
- The contract value increases automatically when a ChangeOrder reaches EXECUTED status
- Rejected or cancelled variations do not affect the contract value
- Every variation carries a cause code: CLIENT_INSTRUCTION, DESIGN_CHANGE, UNFORESEEN_CONDITION, SCOPE_OMISSION, OTHER

**File attachments foundation (also Sprint 5):**
Sprint 5 builds the shared file-serving layer (S3-compatible storage + `Attachment` entity). Each subsequent sprint adds attachment support to its own entities. This avoids retrofitting file handling across all modules after Sprint 9.

---

### Sprint 6 — Inventory and Project Costing

- Material catalogue
- Warehouses and site stores
- Immutable stock ledger (entries are never updated or deleted)
- Stock transfers, issues, returns, adjustments
- Inventory valuation
- Project material consumption
- `ProjectCostLedger`: COMMITTED → ACCRUED → ACTUAL at BOQ node level
- Budget vs commitments, received exposure, actual consumption reporting

> **Important distinction:**
> Buying material creates inventory or a supplier liability.
> Issuing material to a construction site creates project cost.
> Never charge a full warehouse purchase to one project unless it was a direct project purchase.

---

### Sprint 7 — Accounts Receivable, Cash and Banking

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

### Sprint 8 — Site Operations, Labour and Equipment

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

### Sprint 9 — Financial Close and Reporting

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
