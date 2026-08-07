# ADR-006: Accounting Foundation — Architecture, Domain Model, and ACCO Configuration

**Status:** ACCEPTED — all decisions and business configuration questions resolved (2026-08-05)
**Date:** 2026-08-05
**Deciders:** Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd), Financial Officer
**Supersedes:** ADR-006 DRAFT (2026-08-03)

---

## Table of Contents

1. [Context and Problem Statement](#1-context-and-problem-statement)
2. [Part 1 — Accounting Architecture](#2-part-1--accounting-architecture)
3. [Part 2 — Domain Model and Invariants](#3-part-2--domain-model-and-invariants)
4. [Part 3 — ACCO Business Configuration](#4-part-3--acco-business-configuration)
5. [All 22 Accepted Decisions](#5-all-22-accepted-decisions)
6. [Alternatives Considered and Rejected](#6-alternatives-considered-and-rejected)
7. [Database and Transaction Constraints](#7-database-and-transaction-constraints)
8. [State Machines](#8-state-machines)
9. [Posting and Reversal Flows](#9-posting-and-reversal-flows)
10. [Control Accounts and Subledger Reconciliation](#10-control-accounts-and-subledger-reconciliation)
11. [Migration Implications for Sprint 3 Data](#11-migration-implications-for-sprint-3-data)
12. [Security, Permissions, Audit, and Immutability](#12-security-permissions-audit-and-immutability)
13. [Deferred Scope](#13-deferred-scope)
14. [Business Configuration Resolutions](#14-business-configuration-resolutions)
15. [Implementation Consequences](#15-implementation-consequences)
16. [Definition of Done](#16-definition-of-done)

---

## 1. Context and Problem Statement

### 1.1 What Sprints 1–3 Delivered

Sprints 1–3 delivered:

- **Sprint 1:** Authentication, Users, Organizations, Roles, Permissions, Audit Logs, Workflow Engine, Exchange Rates
- **Sprint 2:** Projects, Project Lifecycle and Membership, BOQ with versioning, Workflow integration
- **Sprint 3:** Commercial module — Client, Contract (with retention terms, advance terms, guarantees, milestones), IPA, IPC, PaymentReceipt, ReceiptAllocation

Sprint 3's PaymentReceipt module tracks **construction billing** — what is owed and what has been paid. It is not accounting. It has no General Ledger, no double-entry posting, no chart of accounts, no subledgers, and no financial statements.

### 1.2 Why Sprint 4 Cannot Be Deferred

Every future module — Procurement (Sprint 5), Inventory and Project Costing (Sprint 6), AR/AP maturity (Sprint 7), Payroll (Sprint 8), Financial Close (Sprint 9) — posts financial transactions into the General Ledger. Building any of these before the GL exists creates unrecoverable technical debt: transactions accumulate with no authoritative accounting record, and retrofitting double-entry posting after the fact requires reprocessing every historical transaction.

The accounting foundation must precede procurement. This is an irreversible sequencing constraint.

### 1.3 Business Discovery Summary

| Item | Confirmed Value |
|---|---|
| Current system | QuickBooks Desktop 2024 |
| Accounting basis | Accrual accounting |
| Reporting currency | USD |
| VAT rate | 5% |
| Withholding tax | None currently |
| Journal approval | Accountant → CFO → Post (four-eyes) |
| Period close | Monthly, with year-end close |
| Bank accounts | Multiple USD-denominated accounts |
| Bank reconciliation | Monthly, semi-automated (deferred to Cash & Banking phase) |
| Required reports | Trial Balance, GL, Balance Sheet, P&L, Cash Flow; P&L by Project and Department |
| Migration scope | COA, customers, suppliers, bank accounts, open invoices/bills, opening balances |

### 1.4 Scope of This ADR

This ADR defines the complete accounting architecture for Sprint 4 and beyond. It covers:

- The accounting platform's module structure, posting engine, subledger boundaries, and GL model
- All domain aggregates introduced in Sprint 4
- ACCO's initial business configuration
- Migration from Sprint 3
- What is explicitly deferred and why

---

## 2. Part 1 — Accounting Architecture

### 2.1 Fundamental Accounting Principles

**ACC-001 — Accrual basis.** Revenue is recognized when earned (IPC certified), not when cash is received. Expenses are recognized when incurred, not when paid.

**ACC-002 — GL as financial source of truth.** All financial reports (trial balance, P&L, balance sheet, cash flow) are derived exclusively from posted `JournalLine` records. Business modules are operational systems; they do not store financial totals that bypass the GL.

**ACC-003 — Balanced posting.** Every posted `JournalEntry` must satisfy `∑ debitAmount = ∑ creditAmount` (in reporting currency). Posting is rejected if the journal does not balance. Unbalanced entries may never exist in POSTED state.

### 2.2 Module Architecture and Boundaries

Sprint 4 introduces four bounded modules with explicit dependency rules.

```
┌─────────────────────────────────────────────────────────────────┐
│                      SUBLEDGER LAYER                            │
│                                                                 │
│  AccountsReceivableModule   AccountsPayableModule               │
│  ┌──────────────────┐       ┌──────────────────┐               │
│  │ ClientInvoice    │       │ SupplierBill      │               │
│  │ PaymentReceipt   │       │ SupplierPayment   │               │
│  │ ReceiptAlloc.    │       │ SupplierPaymentA. │               │
│  └────────┬─────────┘       └────────┬──────────┘               │
│           │                          │                          │
└───────────┼──────────────────────────┼──────────────────────────┘
            │                          │
            ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              AccountingPostingPort (interface)                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  AccountingCoreModule                           │
│                                                                 │
│  AccountingEvent         PostingRuleVersion                     │
│  PostingRuleLineTemplate PostingProfile                         │
│  TaxCode                 JournalEntry                           │
│  JournalLine             DocumentNumberSequence                 │
│  Posting validation      Control-account enforcement            │
└─────────────────────────┬───────────────────────────────────────┘
                          │  (read-only)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  GeneralLedgerModule (read-only)                │
│                                                                 │
│  Account ledger detail   Trial Balance                          │
│  Period movement reports Opening/closing balances               │
│  Dimension-filtered views Financial-statement data preparation  │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency rules:**

- Subledger modules (AR, AP) call `AccountingPostingPort` synchronously. They never import `JournalEntry` or `JournalLine` repositories directly.
- `AccountingCoreModule` implements `AccountingPostingPort`. It does not import AR or AP repositories.
- `GeneralLedgerModule` reads from `JournalEntry`, `JournalLine`, and `PeriodAccountBalance`. It owns no posting commands.
- Future subledgers (Procurement, Inventory, Payroll, Fixed Assets) follow the same pattern — they call `AccountingPostingPort`.
- The **caller owns the outer Prisma transaction** and passes the transaction-scoped client into the posting port, ensuring the business row and journal rows commit atomically.

### 2.3 General Ledger Model

The General Ledger is **a read-oriented service boundary, not a separate transactional table**.

```
JournalEntry
    └── JournalLine[]          ← canonical immutable ledger row
          │
          ▼
    GeneralLedgerModule        ← read-only query boundary
          │
          ├── Account Ledger (T-account view with running balance)
          ├── Trial Balance
          ├── Period Summaries
          └── Financial Statement Inputs
```

`JournalLine` is the General Ledger posting row. No separate `GeneralLedgerEntry` table exists. PostgreSQL views (`vw_posted_journal_lines`, `vw_account_ledger`) may be introduced as query projections but are never writable. Future materialized views are performance optimizations, not accounting truth.

**Account ledger algorithm:**

```
Opening balance = latest VALID PeriodAccountBalance snapshot before range start
                + live posted JournalLine movements after that snapshot and before range start

Running balance = opening balance
                + ordered JournalLine movements within requested range
                  (status = POSTED only; reversals are visible with their linkage)
```

### 2.4 Posting Engine

Every accounting entry follows this deterministic flow:

```
Business POST command
        │
        ▼ (1) Validate source document eligibility + optimistic revision check
        ▼ (2) Validate accounting period (status OPEN or REOPENED)
        ▼ (3) Create immutable AccountingEvent snapshot
        ▼ (4) Resolve effective PostingRuleVersion + all GL accounts
        ▼ (5) Generate and validate balanced JournalLines
        ▼ (6) Persist JournalEntry and JournalLines
        ▼ (7) Link journal to source document
        ▼ (8) Mark source document and event as POSTED; assign document number
        ▼
      COMMIT (all 8 steps or rollback)
```

If any step fails, the entire transaction rolls back. The source document remains APPROVED + NOT_POSTED. A `PostingAttempt` record is written in a separate small transaction after rollback to capture the failure reason.

**Account resolution strategies** (applied in order of precedence):

| Priority | Strategy | Description |
|---|---|---|
| 1 | Approved transaction-specific override | Requires dedicated permission + CFO approval |
| 2 | Project/contract posting-profile override | Project-level revenue or cost account mapping |
| 3 | Business-unit/department posting profile | Department-level default |
| 4 | Organization posting profile | Org-wide `PostingProfile` mapping |
| 5 | `ACCOUNT_SUBTYPE` | Org's configured control account for that subtype |
| 6 | Platform default template | Only if explicitly allowed |
| 7 | `POSTING_CONFIGURATION_MISSING` | **Always reject — never fall back to uncategorized** |

**Five resolution types:**

- `FIXED_ACCOUNT` — specific account ID hardcoded on the rule (rounding, retained earnings)
- `ACCOUNT_SUBTYPE` — org's single active control account for AR, AP, VAT Payable, etc.
- `POSTING_PROFILE` — account resolved from business classification (revenue category × contract type → account)
- `TAX_CODE` — tax code owns its output and input accounts; rate and accounts are co-located
- `TRANSACTION_ACCOUNT` — user selects from approved accounts (manual journals, bank account on receipts)

### 2.5 Subledger Architecture

```
Construction subledger:  IPA → IPC
                                │
                                ▼ (triggers draft)
AR subledger:            ClientInvoice → PaymentReceipt → ReceiptAllocation
                                │
                                ▼ (on POST command)
General Ledger:          JournalEntry + JournalLine (Dr AR / Cr Revenue / Cr VAT Payable)

AP subledger:            SupplierBill → SupplierPayment → SupplierPaymentAllocation
                                │
                                ▼ (on POST command)
General Ledger:          JournalEntry + JournalLine (Dr Expense / Cr AP)
```

The GL receives control-account movements. The subledger tracks document-level detail. They are always reconcilable: GL AR balance = sum of all ClientInvoice outstanding amounts.

### 2.6 Reporting Architecture

```
JournalLine (source of truth)
       │
       ├── PeriodAccountBalance snapshots (generated at period close)
       │
       ▼
GeneralLedgerModule reads:
  Closed periods  → PeriodAccountBalance snapshot (VALID)
  Open periods    → latest VALID snapshot + live JournalLine movements
```

`PeriodAccountBalance` is dimension-aware. Separate snapshot rows exist per unique combination of `(organization, period, account, project?, department?, costCenter?)`. Snapshots carry `snapshotVersion` — they are never overwritten; rebuilds create a new version. Reopening a period marks its snapshot and all downstream period snapshots `INVALID`; they are rebuilt when each period is re-closed.

**Reports delivered in Sprint 4:**

| Report | Source | Notes |
|---|---|---|
| Trial Balance | `PeriodAccountBalance` (closed) + live `JournalLine`s (open) | Standard debit/credit columns |
| Account Ledger | `JournalLine` ordered by accounting date | Running balance; reversals visible with linkage |
| Profit & Loss | `PeriodAccountBalance` — INCOME and EXPENSE accounts | By period, by project dimension, by department dimension |
| Balance Sheet | `PeriodAccountBalance` — ASSET, LIABILITY, EQUITY accounts | Requires retained-earnings carry-forward from year-end close |

**Cash Flow Statement — Explicitly Deferred:**
The direct-method and indirect-method cash flow statement requires classifying every `JournalLine` movement as Operating, Investing, or Financing. This classification cannot be inferred from account subtype alone — it requires explicit `cashFlowCategory` tagging on accounts or transaction types. This tagging is not in scope for Sprint 4. The Cash Flow Statement is deferred to the Cash & Banking maturity phase. Sprint 4 must not claim complete financial statement reporting while this report is absent.

---

## 3. Part 2 — Domain Model and Invariants

### 3.1 Account and AccountVersion

The COA versioning model separates **stable identity** from **versioned attributes**.

```
Account {
  id             String   // permanent, referenced by JournalLine
  organizationId String
  code           String   // 3–20 chars — permanent, unique per org, never changes
  normalBalance  NormalBalance  // DEBIT | CREDIT — permanent; cannot change without new identity
  status         AccountStatus  // ACTIVE | INACTIVE
  createdAt      DateTime
  createdBy      String
  @@unique([organizationId, code])
}

AccountVersion {
  id                      String
  accountId               String    // FK → Account (stable)
  versionNumber           Int       // 1, 2, 3, … monotonically increasing
  name                    String
  nameAr                  String?
  parentAccountId         String?   // FK → Account — hierarchy for reporting
  accountClass            AccountClass
  accountSubtype          AccountSubtype
  isPostingAllowed        Boolean
  isControlAccount        Boolean
  controlledSubledgerType SubledgerType?
  controlPostingPolicy    ControlPostingPolicy
  effectiveFrom           Date      // inclusive
  effectiveTo             Date?     // inclusive; null = currently active
  changedBy               String
  changeReason            String?   // required for classification changes
  @@unique([accountId, versionNumber])
}
```

**Rename / classification change → new AccountVersion on the same Account:**
```
Engineering account (code 42600) renamed to Technology Revenue:
  AccountVersion { versionNumber: 1, name: "Engineering Revenue", effectiveTo: 2026-12-31 }
  AccountVersion { versionNumber: 2, name: "Technology Revenue",  effectiveFrom: 2027-01-01, effectiveTo: null }
  Account.id and Account.code unchanged.
```

**New accounting identity → new Account root record; old Account.status → INACTIVE:**
```
Account 42600 Project Income split into 42610 + 42620:
  Account { code: "42600", status: INACTIVE }   ← original, no new postings allowed
  Account { code: "42610", ... }                 ← new Construction Revenue
  Account { code: "42620", ... }                 ← new Rental Revenue
  Historical journals continue referencing code 42600's Account.id.
```

**Historical version resolution:**
- `JournalLine` stores: `accountId` (FK to stable Account), `accountCodeSnapshot` (the code at post time), `accountNameSnapshot` (the name at post time — immutable).
- To reconstruct a historical report, the correct version is: `AccountVersion WHERE accountId = line.accountId AND effectiveFrom <= line.accountingDate AND (effectiveTo IS NULL OR effectiveTo >= line.accountingDate)`.
- Do **not** apply the current or period-end version retroactively. Snapshots on `JournalLine` are the authority when the version query would return no match (e.g. gap in dates).

**Invariants:**
- `UNIQUE (organizationId, code)` on `Account` is permanent — the same code never appears twice in the same org.
- At most one `AccountVersion` per account with `effectiveTo IS NULL` (the active version).
- Non-overlapping effective date ranges per `accountId` enforced by the application layer.
- `isControlAccount = true` on any version requires `controlledSubledgerType` to be set.
- `SYSTEM_ONLY` control accounts: the application layer and DB trigger check the **current active version** of the account at post time.
- INACTIVE accounts may not receive new postings but remain queryable for historical reports via their journal snapshots.

### 3.2 FiscalYear

```
FiscalYear {
  id                         String
  organizationId             String
  name                       String
  startDate                  Date
  endDate                    Date
  retainedEarningsAccountId  String   // must be EQUITY class, RETAINED_EARNINGS subtype
  status                     FiscalYearStatus // DRAFT | ACTIVE | CLOSING | CLOSED
  createdAt                  DateTime
}
```

### 3.3 AccountingPeriod

```
AccountingPeriod {
  id               String
  fiscalYearId     String
  organizationId   String
  periodNumber     Int
  name             String
  startDate        Date
  endDate          Date
  periodType       PeriodType   // OPERATING | ADJUSTMENT
  status           PeriodStatus // OPEN | LOCKED | CLOSED | REOPENED

  // Populated when period is reopened
  reopenReason     String?
  reopenedBy       String?
  reopenedAt       DateTime?
  reopenApprovedBy String?
  reopenApprovalId String?      // workflow approval reference
  previousCloseId  String?      // prior closing event reference
  recloseId        String?      // reference to the re-closing event
}
```

**State machine:** `OPEN → LOCKED → CLOSED → REOPENED → LOCKED → CLOSED`

**Invariants:**
- Periods within a fiscal year are non-overlapping and contiguous. Gaps are not permitted.
- `REOPENED` allows only correcting and adjusting entries. Normal operational postings are blocked.
- Reopening requires a controlled command: reason, reopenedBy, CFO approval, timestamp, scope.
- Period close fails if: any unbalanced journal exists, any unposted approved document remains, any DRAFT journal exists, snapshot generation fails.
- A fiscal year contains 12 OPERATING periods + 0..N ADJUSTMENT periods. **ACCO uses 12 OPERATING periods and 0 ADJUSTMENT periods.** Year-end adjustments and closing entries post into December (period 12). The platform still supports optional ADJUSTMENT periods for future organizations.

### 3.4 Party, ClientProfile, SupplierProfile

```
Party {
  id                  String
  organizationId      String
  partyType           PartyType    // ORGANIZATION | PERSON
  legalName           String
  displayName         String
  registrationNumber  String?
  taxNumber           String?
  status              PartyStatus  // ACTIVE | INACTIVE
  createdAt           DateTime
  updatedAt           DateTime
}

PartyAddress {
  partyId      String
  addressType  AddressType  // BILLING | SHIPPING | REGISTERED | SITE
  // address fields
  isPrimary    Boolean
}

PartyContact {
  partyId   String
  name      String
  role      String?
  email     String?
  phone     String?
  isPrimary Boolean
}

ClientProfile {
  id                          String
  partyId                     String   // UNIQUE — at most one per party
  organizationId              String
  clientCode                  String
  paymentTerms                String?
  creditLimit                 Decimal?
  receivableAccountOverrideId String?
  status                      ProfileStatus
}

SupplierProfile {
  id                        String
  partyId                   String   // UNIQUE — at most one per party
  organizationId            String
  supplierCode              String
  paymentTerms              String?
  defaultExpenseProfile     String?
  payableAccountOverrideId  String?
  status                    ProfileStatus
}
```

**Invariants:**
- Party → 0..1 ClientProfile + 0..1 SupplierProfile. The same legal entity may appear in both roles.
- AR and AP ledgers are never silently offset. A party's receivable and payable balances are independent.
- Duplicate detection uses: registration number, tax number, phone, email, normalized legal name. Auto-merge is prohibited. Manual merge requires CFO/admin confirmation, conflict preview, and full audit trail.
- **Sprint 3 migration:** Existing `Client` records gain a `partyId`. One `Party` is created per existing `Client`. The `Client` model evolves into `ClientProfile`. Existing `clientId` references are preserved during transition (see Section 11).

### 3.5 BankAccount

```
BankAccount {
  id              String
  organizationId  String
  glAccountId     String    // UNIQUE — 1:1 with GL Account (subtype BANK, posting-enabled)
  bankName        String
  accountName     String
  accountNumber   String
  iban            String?
  swiftCode       String?
  currencyCode    String
  branch          String?
  treasuryGroupId String?
  isReconcilable  Boolean
  allowsReceipts  Boolean
  allowsPayments  Boolean
  status          BankAccountStatus // ACTIVE | INACTIVE | CLOSED
  openedAt        Date?
  closedAt        Date?
}

TreasuryGroup {
  id             String
  organizationId String
  name           String
  status         String
}
```

**Invariants:**
- `UNIQUE (organizationId, glAccountId)` — one bank account per GL account.
- `UNIQUE (organizationId, accountNumber)` normalized.
- Linked GL account must be: same org, active, posting-enabled, subtype `BANK`, same currency.
- Bank balance is always derived from posted `JournalLine` aggregates for `glAccountId`. No mutable `currentBalance` field on `BankAccount`.
- `TreasuryGroup` is a reporting/grouping construct only — it never affects posting.

### 3.6 ClientInvoice

```
ClientInvoice {
  id                      String
  organizationId          String
  invoiceNumber           String?  // assigned at POST only
  invoiceDate             Date
  dueDate                 Date
  clientProfileId         String
  projectId               String?
  contractId              String?
  sourceCertificateId     String   // IPC that triggered this invoice
  currencyCode            String
  exchangeRateSnapshot    Decimal
  exchangeRateDate        Date
  exchangeRateSource      String
  subtotal                Decimal
  vatAmount               Decimal
  totalAmount             Decimal
  outstandingAmount       Decimal
  paymentTerms            String?
  billingAddressSnapshot  Json
  bankInstructionsRef     String?
  documentStatus          InvoiceDocStatus  // DRAFT | PENDING_APPROVAL | APPROVED | CANCELLED
  postingStatus           PostingStatus     // NOT_POSTED | POSTED | REVERSED
  postedJournalEntryId    String?
  postedAt                DateTime?
  postedBy                String?
  reversedAt              DateTime?
  reversedBy              String?
  reversalJournalEntryId  String?
  lastPostingAttemptAt    DateTime?
  lastPostingErrorCode    String?
  migrationBatchId        String?
  legacyIpcId             String?   // deprecated Sprint 4, removed Sprint 6
  revision                Int
  createdBy               String
  approvedBy              String?
  createdAt               DateTime
  updatedAt               DateTime
}
```

**Invariants:**
- One IPC normally generates one `ClientInvoice`. The platform does not enforce a hard 1:1 constraint globally, but ACCO enforces it via `UNIQUE (organizationId, sourceCertificateId)` at the service layer.
- `invoiceNumber` is assigned only at POST time via `DocumentNumberSequence`. Drafts carry no official number.
- A superseded IPC must not mutate a posted invoice. If the invoice is DRAFT, it may be regenerated or cancelled. If POSTED, correction requires a credit note + replacement invoice.
- `postingStatus = POSTED` → `postedJournalEntryId` required.
- `postingStatus = REVERSED` → both `postedJournalEntryId` and `reversalJournalEntryId` required.
- `outstandingAmount` decreases as `ReceiptAllocation` records are created; reaches zero when fully paid.

**GL posting on POST:**
```
Dr Accounts Receivable (ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE)   totalAmount
Cr Project Revenue     (POSTING_PROFILE: CLIENT_REVENUE)         subtotal
Cr Output VAT Payable  (TAX_CODE: VAT_5_OUTPUT)                  vatAmount
```

### 3.7 PaymentReceipt

Sprint 3 aggregate — extended in Sprint 4 with:
- `bankAccountId` (required, FK to `BankAccount`)
- `resolvedGlAccountId` (snapshot of the bank's GL account at posting)
- `documentStatus` / `postingStatus` separation
- `allocatedAmount` / `unallocatedAmount` explicitly tracked

**GL posting on POST:**
```
Dr Bank GL (resolved from bankAccountId.glAccountId)   totalAmount
Cr Accounts Receivable (ACCOUNT_SUBTYPE: AR)            totalAmount
```

### 3.8 ReceiptAllocation

Sprint 3 aggregate — migrated in Sprint 4:
- `clientInvoiceId` (required after migration)
- `ipcId` (deprecated Sprint 4 → read-only Sprint 5 → removed Sprint 6)

**Invariants:**
- `allocatedAmount > 0`
- Sum of allocations ≤ `PaymentReceipt.totalAmount`
- Allocation ≤ `ClientInvoice.outstandingAmount`
- Same organization, same currency
- Posted allocations are immutable; correction requires reversal + replacement

### 3.9 SupplierBill

```
SupplierBill {
  id                      String
  organizationId          String
  supplierProfileId       String
  billNumber              String?     // internal AP voucher number, assigned at POST
  supplierInvoiceNumber   String      // supplier's external number (preserved)
  billDate                Date
  dueDate                 Date
  currencyCode            String
  exchangeRateSnapshot    Decimal
  exchangeRateDate        Date
  exchangeRateSource      String
  purchaseOrderId         String?     // nullable; required only for PURCHASE_ORDER source type
  projectId               String?
  departmentId            String?
  billSourceType          BillSourceType
                          // DIRECT | PURCHASE_ORDER | SUBCONTRACT | RECURRING | ADJUSTMENT
  subtotal                Decimal
  vatAmount               Decimal
  totalAmount             Decimal
  outstandingAmount       Decimal
  documentStatus          BillDocStatus
  postingStatus           PostingStatus
  postedJournalEntryId    String?
  postedAt                DateTime?
  postedBy                String?
  reversedAt              DateTime?
  reversedBy              String?
  reversalJournalEntryId  String?
  lastPostingAttemptAt    DateTime?
  lastPostingErrorCode    String?
  revision                Int
  createdBy               String
  approvedBy              String?
}

SupplierBillLine {
  id                       String
  supplierBillId           String
  lineNumber               Int
  description              String
  quantity                 Decimal?
  unitPrice                Decimal?
  netAmount                Decimal
  vatCodeId                String?
  vatAmount                Decimal
  grossAmount              Decimal
  expenseAccountSource     String    // account resolution config key
  projectId                String?
  departmentId             String?
  costCenterId             String?
  boqNodeId                String?
  purchaseOrderLineId      String?   // nullable until Sprint 5
  goodsReceiptLineId       String?   // nullable until Sprint 6
}
```

**Invariants:**
- Duplicate detection: `UNIQUE (organizationId, supplierProfileId, supplierInvoiceNumber)` normalized. Warning + override controls.
- `billSourceType = PURCHASE_ORDER` → `purchaseOrderId` required (enforced by Sprint 5).
- Sprint 5 adds PO three-way matching against the same aggregate — no second AP document type.

**GL posting on POST (DIRECT expense):**
```
Dr Expense Account   (POSTING_PROFILE: resolved per line)   netAmount
Dr Recoverable VAT   (TAX_CODE: VAT_5_INPUT)                vatAmount  ← if RECOVERABLE; see ACC-TAX-001
Cr Accounts Payable  (ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE)    grossAmount
```

### 3.10 SupplierPayment

```
SupplierPayment {
  id                    String
  organizationId        String
  supplierProfileId     String
  bankAccountId         String
  paymentNumber         String?    // assigned at POST
  paymentDate           Date
  accountingDate        Date
  currencyCode          String
  exchangeRateSnapshot  Decimal
  totalAmount           Decimal
  allocatedAmount       Decimal    // sum of SupplierPaymentAllocation.allocatedAmount
  unallocatedAmount     Decimal    // totalAmount - allocatedAmount
  paymentMethod         String
  bankReference         String?
  documentStatus        PaymentDocStatus
  postingStatus         PostingStatus
  postedJournalEntryId  String?
  postedAt              DateTime?
  postedBy              String?
  revision              Int
  createdBy             String
  approvedBy            String?
}

SupplierPaymentAllocation {
  id                String
  supplierPaymentId String
  supplierBillId    String
  allocatedAmount   Decimal
  allocationDate    Date
  createdBy         String
}
```

**Invariants:**
- One `SupplierPayment` may settle multiple `SupplierBill`s. One `SupplierBill` may be settled by multiple `SupplierPayment`s.
- `allocatedAmount > 0` per allocation.
- Sum of allocations ≤ `SupplierPayment.totalAmount`.
- Allocation ≤ `SupplierBill.outstandingAmount`.
- Same org, same supplier, same currency.
- Posted allocations are immutable.

**GL posting on POST (bill-level traceability):**
```
Dr Accounts Payable — Bill A   (ACCOUNT_SUBTYPE: AP)   amountA
Dr Accounts Payable — Bill B                           amountB
Cr Bank GL          (TRANSACTION_ACCOUNT: bankAccountId.glAccountId)   totalAmount
```

### 3.11 PostingRuleVersion and PostingRuleLineTemplate

```
PostingRuleVersion {
  id              String
  organizationId  String
  eventType       String
  version         Int
  effectiveFrom   Date
  effectiveTo     Date?
  status          RuleStatus  // DRAFT | APPROVED | ACTIVE | SUPERSEDED
  createdBy       String
  approvedBy      String?
  approvedAt      DateTime?
}

PostingRuleLineTemplate {
  id                    String
  postingRuleVersionId  String
  lineNumber            Int
  lineRole              String
  debitOrCredit         DebitCredit   // DEBIT | CREDIT
  amountSource          String        // INVOICE_TOTAL | TAXABLE_AMOUNT | VAT_AMOUNT | LINE_AMOUNT | …
  accountResolutionType ResolutionType
                        // FIXED_ACCOUNT | ACCOUNT_SUBTYPE | POSTING_PROFILE | TAX_CODE | TRANSACTION_ACCOUNT
  fixedAccountId        String?
  accountSubtype        AccountSubtype?
  postingProfileId      String?       // FK → PostingProfile.id (replaces opaque postingProfileKey string)
  condition             String?       // optional filter expression
  requiredDimensions    String[]
  descriptionTemplate   String?
}
```

**Invariants:**
- A `PostingRuleVersion` is immutable once any transaction has been posted against it.
- Changes create a new version with a new `effectiveFrom` date.
- No two ACTIVE versions for the same `(organizationId, eventType)` may overlap in effective date.
- Configuration changes require: DRAFT → validation → CFO approval → effective date → ACTIVE.
- An impact preview must be shown before activation.

### 3.11a PostingProfile and PostingProfileVersion

A `PostingProfile` maps a semantic business classification to a GL account. When Finance remaps a profile to a different account (e.g. construction revenue migrates from account 42600 to 42610), the stable `PostingProfile.id` is preserved and a new version is added. Historical `PostingRuleLineTemplate` references are unchanged; historical journals already carry `JournalLine.resolutionSource` as an immutable snapshot.

```
PostingProfile {
  id             String
  organizationId String
  code           String   // semantic key, unique per org: PROJECT_REVENUE, MATERIAL_PURCHASE, …
  status         ProfileStatus  // ACTIVE | INACTIVE
  createdAt      DateTime
  createdBy      String
  @@unique([organizationId, code])
}

PostingProfileVersion {
  id               String
  postingProfileId String    // FK → PostingProfile (stable)
  versionNumber    Int
  name             String
  description      String?
  accountId        String    // FK → Account — the GL account this profile resolves to
  effectiveFrom    Date
  effectiveTo      Date?     // null = currently active
  changedBy        String
  approvedBy       String?
  approvedAt       DateTime?
  @@unique([postingProfileId, versionNumber])
}
```

**Version resolution at post time:**
```
SELECT ppv.*
FROM posting_profile_version ppv
WHERE ppv.posting_profile_id = :profileId
  AND ppv.effective_from <= :accountingDate
  AND (ppv.effective_to IS NULL OR ppv.effective_to >= :accountingDate)
ORDER BY ppv.version_number DESC
LIMIT 1
```
If no version covers the `accountingDate`, raise `POSTING_CONFIGURATION_MISSING`.

**`JournalLine.resolutionSource`** records `PostingProfile.code + '@v' + versionNumber` at post time (e.g. `PROJECT_REVENUE@v2`) — an immutable snapshot sufficient for audit without re-resolving.

**Initial ACCO profiles:**

| Code | Name | v1 Account |
|---|---|---|
| `PROJECT_REVENUE` | Project Revenue | 42600 Project Income |
| `MATERIAL_PURCHASE` | Material Purchase | 50303 Material Cost |
| `SUBCONTRACT_COST` | Subcontract Cost | (Finance to assign) |
| `OFFICE_EXPENSE` | Office & General Expense | (Finance to assign) |
| `ADVANCE_PAYMENT` | Advance Payment | (Finance to assign) |

**Invariants:**
- `UNIQUE (organizationId, code)` on `PostingProfile` is permanent.
- At most one `PostingProfileVersion` per profile with `effectiveTo IS NULL`.
- `PostingRuleLineTemplate.postingProfileId` references `PostingProfile.id` (stable). The engine resolves the correct version at post time using `accountingDate`.
- Account remapping → new `PostingProfileVersion`. Historical journals are unaffected.

### 3.12 TaxCode

```
TaxCode {
  id                  String
  organizationId      String
  code                String
  name                String
  rate                Decimal
  taxType             TaxType           // OUTPUT | INPUT | BOTH
  recoveryMethod      RecoveryMethod    // RECOVERABLE | NON_RECOVERABLE
  outputTaxAccountId  String?           // VAT Payable account
  inputTaxAccountId   String?           // Recoverable VAT account (if RECOVERABLE)
  effectiveFrom       Date
  effectiveTo         Date?
  status              TaxCodeStatus
}
```

**Resolved — ACC-TAX-001:** ACCO input VAT is `NON_RECOVERABLE`. The VAT amount is absorbed into the inventory or expense cost — no separate recoverable VAT GL account is posted. `inputTaxAccountId` is null for ACCO's `VAT_5_INPUT` code. The posting engine still branches on `recoveryMethod` at runtime, so future organizations can configure `RECOVERABLE` input VAT without any code change.

### 3.13 JournalEntry and JournalLine

```
JournalEntry {
  id                        String
  organizationId            String
  journalNumber             String         // assigned at POSTED only
  journalCategory           JournalCategory
                            // GENERAL | SALES | PURCHASE | RECEIPT | PAYMENT | BANK | OPENING | ADJUSTMENT
  entryPurpose              EntryPurpose
                            // STANDARD | OPENING_BALANCE | PERIOD_ADJUSTMENT | REVERSAL |
                            // REPLACEMENT | RECLASSIFICATION | CLOSING
  status                    JournalStatus
                            // DRAFT | PENDING_APPROVAL | APPROVED | POSTED | REVERSED | CANCELLED
  documentDate              Date
  accountingDate            Date
  postedAt                  DateTime?
  description               String
  currencyCode              String
  exchangeRateSnapshot      Decimal?
  sourceDocumentType        SourceDocType?
                            // MANUAL | CLIENT_INVOICE | SUPPLIER_BILL | PAYMENT_RECEIPT |
                            // SUPPLIER_PAYMENT | BANK_TRANSFER | OPENING_BALANCE | CLOSING_ENTRY | …
  sourceDocumentId          String?
  accountingEventId         String?
  postingRuleVersionId      String?
  reversalOfJournalEntryId  String?
  replacedByJournalEntryId  String?
  createdBy                 String
  submittedBy               String?
  approvedBy                String?
  postedBy                  String?
  reversedBy                String?
  reversalReason            String?
  revision                  Int
  createdAt                 DateTime
  updatedAt                 DateTime
}

JournalLine {
  id                       String
  journalEntryId           String
  lineNumber               Int
  accountId                String
  accountCodeSnapshot      String    // copied at post time
  accountNameSnapshot      String    // copied at post time
  debitAmount              Decimal   // exactly one of debitAmount or creditAmount > 0
  creditAmount             Decimal
  transactionCurrencyCode  String
  transactionAmount        Decimal?
  baseCurrencyAmount       Decimal   // reporting/base currency amount
  exchangeRateSnapshot     Decimal?
  description              String?
  postingOrigin            PostingOrigin  // SYSTEM | MANUAL | MIGRATION | ADJUSTMENT
  sourceSubledgerType      SubledgerType?
  resolutionSource         String?
  postingRuleVersionId     String?
  postingProfileVersionId  String?
  resolvedAccountId        String?
  // Dimensions
  projectId                String?
  departmentId             String?
  costCenterId             String?
  clientProfileId          String?
  supplierProfileId        String?
  contractId               String?
  boqNodeId                String?
  taxCodeId                String?
  createdAt                DateTime
}
```

**Invariants:**
- `∑ debitAmount = ∑ creditAmount` per `JournalEntry` (in base/reporting currency). Enforced at post time.
- Each line: exactly one of `debitAmount` or `creditAmount > 0`. Both non-zero, or both zero, is invalid.
- Posted entries are permanently immutable. No field on a POSTED `JournalEntry` or its lines may be updated or deleted.
- `UNIQUE (organizationId, sourceDocumentType, sourceDocumentId, accountingEventId)` — idempotency guard against duplicate system posting.
- `accountId` must belong to same organization, be ACTIVE, have `isPostingAllowed = true`, and comply with `controlPostingPolicy`.
- `accountingDate` must fall within a period whose status is OPEN or REOPENED (REOPENED permits only correcting entry purposes).

### 3.14 PeriodAccountBalance

```
PeriodAccountBalance {
  id                String
  organizationId    String
  fiscalYearId      String
  accountingPeriodId String
  accountId         String
  // Optional dimensions (row exists only if movements occurred for this combination)
  projectId         String?
  departmentId      String?
  costCenterId      String?
  // Balances
  openingDebit      Decimal
  openingCredit     Decimal
  periodDebit       Decimal
  periodCredit      Decimal
  closingDebit      Decimal
  closingCredit     Decimal
  baseCurrency      String
  snapshotVersion   Int
  generatedAt       DateTime
  generatedBy       String
  status            SnapshotStatus  // VALID | INVALID | REBUILDING
}
```

**Unique key:** `(organizationId, accountingPeriodId, accountId, projectId NULLS DISTINCT, departmentId NULLS DISTINCT, costCenterId NULLS DISTINCT)`

**Invariants:**
- Snapshots are never overwritten. Rebuild creates a new `snapshotVersion`.
- Reopening a period marks it and all downstream period snapshots `INVALID`. Rebuild occurs when each period is re-closed.
- `closingDebit = openingDebit + periodDebit - periodCredit` (for normal debit accounts; vice versa for credit accounts).

### 3.15 Department, DepartmentVersion, CostCenter, CostCenterVersion

The same identity/version separation applied to `Account` applies to dimensions. A `JournalLine` dimensioned to "Engineering" posted in 2025 must still report under "Engineering" on the 2025 P&L, even if that department was renamed "Technology" in 2027. The resolution uses `JournalLine.accountingDate`, not the period-end date.

```
Department {
  id             String
  organizationId String
  code           String   // permanent, unique per org
  status         DimensionStatus  // ACTIVE | INACTIVE
  createdAt      DateTime
  createdBy      String
  @@unique([organizationId, code])
}

DepartmentVersion {
  id                 String
  departmentId       String    // FK → Department (stable)
  versionNumber      Int
  name               String
  parentDepartmentId String?   // FK → Department (for hierarchy reporting)
  effectiveFrom      Date
  effectiveTo        Date?     // null = currently active
  changedBy          String
  changeReason       String?
  @@unique([departmentId, versionNumber])
}

CostCenter {
  id             String
  organizationId String
  code           String       // permanent, unique per org
  departmentId   String       // mandatory, stable — new identity if dept changes
  status         DimensionStatus
  createdAt      DateTime
  createdBy      String
  @@unique([organizationId, code])
}

CostCenterVersion {
  id             String
  costCenterId   String    // FK → CostCenter (stable)
  versionNumber  Int
  name           String
  effectiveFrom  Date
  effectiveTo    Date?     // null = currently active
  changedBy      String
  changeReason   String?
  @@unique([costCenterId, versionNumber])
}
```

**Rename → new version; new organisational identity → new root record:**
```
"Engineering" renamed to "Technology" in 2027:
  Department { code: "ENG", status: ACTIVE }   ← same root
  DepartmentVersion { v1, name: "Engineering", effectiveTo: 2026-12-31 }
  DepartmentVersion { v2, name: "Technology",  effectiveFrom: 2027-01-01 }

Engineering split into Frontend + Backend (two new departments):
  Department { code: "ENG",  status: INACTIVE }
  Department { code: "FRO",  name: "Frontend", status: ACTIVE }
  Department { code: "BCK",  name: "Backend",  status: ACTIVE }
  Historical journals continue referencing code ENG's Department.id.
```

**Historical dimension label resolution:**
- `JournalLine` stores `departmentId` (FK → stable Department) and `costCenterId` (FK → stable CostCenter).
- Label resolution for a historical report: `DepartmentVersion WHERE departmentId = line.departmentId AND effectiveFrom <= line.accountingDate AND (effectiveTo IS NULL OR effectiveTo >= line.accountingDate)`.
- Do **not** apply the current name retroactively. This is the same rule as Account versioning.

**Resolved — ACC-DIM-001:** `CostCenter.departmentId` is mandatory and is treated as stable identity — a cost center that moves to a different department is a new root record, not a new version. Posting validation enforces `COST_CENTER_DEPARTMENT_MISMATCH` when `JournalLine.costCenterId.departmentId ≠ JournalLine.departmentId`.

**Account-level dimension policy** (stored in `DimensionPolicy` — see §3.20):

| Policy | Meaning |
|---|---|
| `REQUIRED` | Journal line must carry this dimension |
| `OPTIONAL` | May be supplied; used for filtering if present |
| `PROHIBITED` | Must not carry this dimension (e.g., `project` on a Bank account) |

### 3.16 DocumentNumberSequence

```
DocumentNumberSequence {
  id             String
  organizationId String
  documentType   DocumentType   // CLIENT_INVOICE | JOURNAL | SUPPLIER_PAYMENT | PAYMENT_RECEIPT | …
  journalCategory JournalCategory?  // only for journal-type sequences
  prefix         String
  nextNumber     Int
  paddingLength  Int
  version        Int     // optimistic concurrency
  status         SequenceStatus
}
```

**Unique key:** `(organizationId, documentType, journalCategory NULLS DISTINCT)`

**Allocation protocol:**
```
BEGIN TRANSACTION
  SELECT DocumentNumberSequence FOR UPDATE
  n = nextNumber
  nextNumber = nextNumber + 1
  COMMIT
  → format: prefix + LPAD(n, paddingLength, '0')
```

**Invariants:**
- Number is allocated only at final POST — never on DRAFT creation.
- If the posting transaction rolls back, the number increment is also rolled back → **no gaps from failed postings**.
- Posted document numbers are immutable and never reused. VOIDED or CANCELLED documents retain their numbers.
- Sequences are continuous across fiscal years. The fiscal year appears in the document date, not the number.

### 3.17 PostingAttempt

```
PostingAttempt {
  id                  String
  organizationId      String
  sourceDocumentType  SourceDocType
  sourceDocumentId    String
  sourceRevision      Int
  attemptedBy         String
  attemptedAt         DateTime
  outcome             AttemptOutcome  // SUCCEEDED | FAILED
  errorCode           String?
  errorMessage        String?
  postingRuleVersionId String?
  journalEntryId      String?         // populated on SUCCEEDED
  correlationId       String
}
```

Written in a **separate small transaction after rollback** — the main posting transaction is already rolled back when this is written. Provides Finance with an operational queue of documents that require attention.

### 3.18 SubledgerControlAccountReconciliation

```
SubledgerControlAccountReconciliation {
  id                String
  organizationId    String
  accountId         String         // control account
  accountingPeriodId String
  glBalance         Decimal        // sum of JournalLine for this control account
  subledgerBalance  Decimal        // sum of outstanding subledger documents
  variance          Decimal        // glBalance - subledgerBalance (must be 0)
  status            ReconciliationStatus  // UNREVIEWED | REVIEWED | VARIANCE_NOTED
  reviewedBy        String?
  reviewedAt        DateTime?
  notes             String?
}
```

Period close should require zero variance for configured control accounts before allowing status to advance to LOCKED.

### 3.19 AccountingMigrationBatch

```
AccountingMigrationBatch {
  id           String
  organizationId String
  startedAt    DateTime
  completedAt  DateTime?
  performedBy  String
  approvedBy   String?
  status       MigrationStatus  // PENDING | IN_PROGRESS | COMPLETED | APPROVED | ROLLED_BACK
  checksum     String
  notes        String?
}
```

Every migrated document stores: `migrationBatchId`, `legacyIpcId`, `legacyReceiptAllocationId`.

### 3.20 AccountingConfiguration Module

`AccountingConfiguration` is a **module and settings facade**, not a single God Aggregate. Each policy domain retains its own aggregate lifecycle, its own DB table, and its own service. The `AccountingConfigurationModule` exposes a unified `AccountingConfigurationService` that other modules inject; they never query policy tables directly.

```
┌────────────────────────────────────────────────────────────┐
│             AccountingConfigurationModule                  │
│                                                            │
│  AccountingConfigurationService (facade read interface)    │
│     .getMonetaryPolicy(organizationId)                     │
│     .getFiscalCalendarPolicy(organizationId)               │
│     .getTaxPolicy(organizationId)                          │
│     .getNumberingPolicy(organizationId)                    │
│     .getPostingPolicy(organizationId)                      │
│     .getDimensionPolicy(organizationId)                    │
│     .getBankingPolicy(organizationId)                      │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Monetary     │  │ FiscalCal.   │  │ Tax          │     │
│  │ Policy       │  │ Policy       │  │ Policy       │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Numbering    │  │ Posting      │  │ Dimension    │     │
│  │ Policy       │  │ Policy       │  │ Policy       │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐                                          │
│  │ Banking      │                                          │
│  │ Policy       │                                          │
│  └──────────────┘                                          │
└────────────────────────────────────────────────────────────┘
```

Each policy aggregate:

```
MonetaryPolicy {
  organizationId        String @unique
  baseCurrencyCode      String   // USD for ACCO — immutable after first JournalEntry posted
  reportingCurrencyCode String   // USD for ACCO (may diverge in future)
  updatedBy             String
  updatedAt             DateTime
}

FiscalCalendarPolicy {
  organizationId       String @unique
  fiscalYearStartMonth Int      // 1 = January (ACCO)
  fiscalYearStartDay   Int      // 1 (ACCO)
  useAdjustmentPeriods Boolean  // false (ACCO — ACC-PER-001)
  updatedBy            String
  updatedAt            DateTime
}

TaxPolicy {
  organizationId         String @unique
  defaultOutputTaxCodeId String?   // VAT_5_OUTPUT for ACCO
  defaultInputTaxCodeId  String?   // VAT_5_INPUT for ACCO
  updatedBy              String
  updatedAt              DateTime
}

NumberingPolicy {
  organizationId String @unique
  numberingScope NumberingScope  // CONTINUOUS | RESET_ANNUALLY
  updatedBy      String
  updatedAt      DateTime
}

PostingPolicy {
  organizationId                String @unique
  requireFourEyesOnJournals     Boolean  // true (ACCO)
  draftJournalsBlockPeriodClose Boolean  // true (ACCO)
  enforceControlAccountAtDb     Boolean  // true — DB trigger active
  updatedBy                     String
  updatedAt                     DateTime
}

DimensionPolicy {
  organizationId              String @unique
  projectDimensionDefault     DimensionRequirement  // OPTIONAL | REQUIRED | PROHIBITED
  departmentDimensionDefault  DimensionRequirement  // OPTIONAL
  costCenterDimensionDefault  DimensionRequirement  // OPTIONAL
  updatedBy                   String
  updatedAt                   DateTime
}

BankingPolicy {
  organizationId                String @unique
  requireBankAccountForReceipts Boolean  // true
  requireBankAccountForPayments Boolean  // true
  requireBankReviewBeforeClose  Boolean  // false (ACCO — deferred)
  updatedBy                     String
  updatedAt                     DateTime
}
```

**Invariants:**
- One record per `organizationId` per policy table. Created during organization onboarding.
- `MonetaryPolicy.baseCurrencyCode` is immutable after the first `JournalEntry` is posted. Attempting to change it raises `BASE_CURRENCY_IMMUTABLE_AFTER_POSTING`.
- `PostingPolicy.requireFourEyesOnJournals = true` is enforced at the application layer regardless of the stored value — the platform never allows self-approval.
- Each policy table has its own audit log entry on change.
- Policy reads are cached per request in `AccountingConfigurationService`. Never bypass the service to query policy tables directly from another module.

**UI surface:** Each policy aggregate maps to one settings screen section. Finance can update policies independently without touching unrelated configuration.

---

## 4. Part 3 — ACCO Business Configuration

This section describes organization-level configuration that Finance manages through the UI. It is not application architecture — changes here do not require code changes.

### 4.1 Chart of Accounts

ACCO's initial COA is imported from QuickBooks using a 5-digit numeric scheme:

| Range | Class | Examples |
|---|---|---|
| 10000–19999 | ASSET | 11000 Accounts Receivable, 12100 Inventory Asset, 15000 Fixed Assets |
| 20000–29999 | LIABILITY | 20000 Accounts Payable |
| 30000–39999 | EQUITY | 31000 ASAS Group Capital |
| 40000–49999 | INCOME | 42600 Project Income |
| 50000+ | EXPENSE / COST_OF_SALES | 50000 Project Costs (grouping), 50303 Cement Cost |

Hierarchy is expressed via `parentAccountId`, not code ranges. The system does not infer account class from the numeric range.

**Initial control accounts** (all set `controlPostingPolicy = SYSTEM_ONLY` unless noted):

| Account | Subtype | Policy |
|---|---|---|
| 11000 Accounts Receivable | ACCOUNTS_RECEIVABLE | SYSTEM_ONLY |
| 20000 Accounts Payable | ACCOUNTS_PAYABLE | SYSTEM_ONLY |
| VAT Payable (to be assigned) | TAX_PAYABLE | SYSTEM_OR_APPROVED_ADJUSTMENT |
| Bank accounts (10100, 10200, 10500, …) | BANK | SYSTEM_OR_APPROVED_ADJUSTMENT |

### 4.2 Tax Codes

ACCO's initial tax codes:

| Code | Type | Rate | Recovery |
|---|---|---|---|
| VAT_5_OUTPUT | OUTPUT | 5% | N/A |
| VAT_5_INPUT | INPUT | 5% | NON_RECOVERABLE — included in inventory/expense gross amount |

**ACC-TAX-001 resolved.** Input VAT is absorbed into the cost of the expense or inventory item. No separate recoverable VAT GL account is used. `TaxCode.inputTaxAccountId = null` for ACCO. The posting engine still branches on `recoveryMethod` at runtime — future organizations needing `RECOVERABLE` input VAT require no code change, only configuration.

### 4.3 Bank Accounts (Initial Configuration)

Phase 1 must configure **all active ACCO bank accounts**, not only the three initially identified. Finance must provide the complete list (name, account number, linked QuickBooks GL code, currency) before Phase 1 is released to staging. Each account requires a `BankAccount` record linked 1:1 to its GL `Account` (subtype `BANK`).

**Minimum known accounts (to be completed by Finance):**

| Bank Account | GL Code | Currency | TreasuryGroup |
|---|---|---|---|
| Salaam Somali Bank | 10100 | USD | ACCO Treasury |
| Dahabshiil Bank | 10200 | USD | ACCO Treasury |
| Premier Bank | 10500 | USD | ACCO Treasury |
| _Additional accounts — Finance to provide_ | TBD | USD | ACCO Treasury |

Finance signs off on the complete `BankAccount` list as a Phase 1 go/no-go gate. No PaymentReceipt or SupplierPayment may be posted until all active bank accounts are configured.

### 4.4 FiscalYear and Periods (Initial Configuration)

ACCO operates on a calendar year (Jan 1 – Dec 31). Initial setup:

- 12 OPERATING periods (January–December)
- 0 ADJUSTMENT periods — **ACC-PER-001 resolved.** Year-end adjustments and closing entries post into December (period 12). The platform still supports optional ADJUSTMENT periods for future organizations; ACCO does not use them.

### 4.5 Number Sequences (Initial Configuration)

| Document | Prefix | Start | Example |
|---|---|---|---|
| ClientInvoice | INV- | From QuickBooks last invoice + 1 | INV-004282 |
| General Journal | GJ- | 1 | GJ-000001 |
| Sales Journal | SJ- | 1 | SJ-000001 |
| Purchase Journal | PJ- | 1 | PJ-000001 |
| Receipt Journal | RJ- | 1 | RJ-000001 |
| Payment Journal | PY- | 1 | PY-000001 |
| PaymentReceipt | REC- | 1 | REC-000001 |
| SupplierPayment | PAY- | 1 | PAY-000001 |

Legacy invoice numbers from QuickBooks are stored as `legacyNumber` on migrated `ClientInvoice` records.

### 4.6 Dimension Configuration (Initial)

- `Department`: to be configured by Finance (Construction, Administration, Logistics, etc.)
- `CostCenter`: to be configured by Finance; each cost center assigned to exactly one Department (`departmentId` mandatory)
- **ACC-DIM-001 resolved.** `CostCenter.departmentId` is mandatory. Posting validation: if a `JournalLine` carries both `costCenterId` and `departmentId`, the cost center's `departmentId` must match the line's `departmentId` — otherwise `COST_CENTER_DEPARTMENT_MISMATCH` is raised.

### 4.7 Posting Profiles (Initial Configuration)

ACCO's revenue categories map to specific income accounts:

| Revenue Category | Account |
|---|---|
| Construction Services | 42600 Project Income |
| Material Sales | (to confirm with Finance) |
| Truck Services | (to confirm with Finance) |
| Rental Income | (to confirm with Finance) |

---

## 5. All 22 Accepted Decisions

| # | Decision | Status |
|---|---|---|
| 1 | `AccountingPeriod` state machine: `OPEN → LOCKED → CLOSED → REOPENED → LOCKED → CLOSED`. Reopening allows correcting/adjusting entries only; posted history is permanently immutable. Reopening requires controlled command with full audit metadata. | Locked |
| 2 | `Account.code` is an opaque string (3–20 chars), unique per org. `parentAccountId` is the authoritative hierarchy. `accountClass` + `accountSubtype` drive all financial behavior. Code ranges are a human convention only. `isPostingAllowed = false` on grouping accounts. Historical journal lines store code/name snapshots. | Locked |
| 3 | `ClientInvoice` is a distinct AR aggregate, generated from an approved IPC. Posting is an explicit Finance command — not automatic on IPC approval. One IPC normally → one invoice; superseded IPCs cannot mutate a posted invoice. | Locked |
| 4 | Multi-line versioned `PostingRuleVersion` → `PostingRuleLineTemplate`. Five account-resolution strategies. Seven-level deterministic precedence. `POSTING_CONFIGURATION_MISSING` always rejects — no silent fallback. Rules are immutable once any transaction is posted against them. Configuration changes require CFO approval and impact preview. | Locked |
| 5 | `SupplierBill` is a standalone AP aggregate. `purchaseOrderId` is nullable. `BillSourceType` controls validation per source. Sprint 5 extends the same aggregate — no second AP document type. Duplicate detection on normalized `(org + supplier + supplierInvoiceNumber)`. | Locked |
| 6 | GL posting is **synchronous and atomic** within the tenant DB transaction (8-step sequence). Business row and journal rows commit together or both roll back. `PostingAttempt` records failures in a separate transaction after rollback. Async transactional outbox handles notifications and analytics only. | Locked |
| 7 | `Party` (shared identity) + `ClientProfile` (AR rules) + `SupplierProfile` (AP rules). Party → 0..1 ClientProfile + 0..1 SupplierProfile. AR and AP ledgers never silently offset. Sprint 3 `Client` migrates to this structure. | Locked |
| 8 | `BankAccount` 1:1 to one posting-enabled GL `Account` (subtype `BANK`). `TreasuryGroup` for reporting aggregation only — never for posting. Bank balance is always derived from posted `JournalLine` aggregates, never stored as a mutable balance field. | Locked |
| 9 | One unified `JournalEntry` / `JournalLine` table for all postings. Three orthogonal classifiers: `journalCategory`, `entryPurpose`, `sourceDocumentType`. `POSTED` entries and their lines are permanently immutable. Reversals are new journals linked via `reversalOfJournalEntryId`. | Locked |
| 10 | `TaxCode` architecture: `recoveryMethod: RECOVERABLE \| NON_RECOVERABLE` branches the posting engine at runtime. **ACC-TAX-001 resolved:** ACCO input VAT is `NON_RECOVERABLE` — absorbed into inventory/expense gross amount. No separate recoverable VAT GL line posted. `TaxCode.inputTaxAccountId = null` for ACCO. Future orgs may configure `RECOVERABLE` without code change. | Locked |
| 11 | `SupplierPayment` is a standalone AP payment aggregate. M:M via `SupplierPaymentAllocation`. Partial payment supported. `unallocatedAmount` preserved explicitly. GL posting: `Dr AP per bill / Cr Bank` (bill-level traceability). | Locked |
| 12 | `FiscalYear` org-scoped with configurable start/end dates. `AccountingPeriod` carries `periodType: OPERATING \| ADJUSTMENT`. 12 OPERATING + 0..N ADJUSTMENT periods. **ACC-PER-001 resolved:** ACCO uses 12 OPERATING periods + 0 ADJUSTMENT periods. Year-end adjustments and closing entries post into December (period 12). Platform continues to support optional ADJUSTMENT periods for future organizations. | Locked |
| 13 | `Department` and `CostCenter` are independent master-data entities. **ACC-DIM-001 resolved:** `CostCenter.departmentId` is mandatory — each cost center belongs to exactly one department. Posting validation enforces `COST_CENTER_DEPARTMENT_MISMATCH` when `JournalLine.costCenterId` does not belong to `JournalLine.departmentId`. Account/profile carries per-dimension policy: `REQUIRED \| OPTIONAL \| PROHIBITED`. | Locked |
| 14 | Sprint 3 `ReceiptAllocation` migration: **Option C — controlled cut-over** via `AccountingMigrationBatch`. `ipcId` deprecated Sprint 4 → read-only Sprint 5 → removed Sprint 6. CFO signs reconciliation report (Variance = $0.00) before cut-over becomes permanent. | Locked |
| 15 | `PeriodAccountBalance`: dimension-aware, versioned (`VALID \| INVALID \| REBUILDING`), never overwritten. Report algorithm: closed period → snapshot; open period → latest VALID snapshot + live `JournalLine`s. Reopening marks downstream snapshots `INVALID`. Period close fails if unbalanced/unposted/draft journals exist. | Locked |
| 16 | Sprint 4 enforces same-currency settlement. `CROSS_CURRENCY_SETTLEMENT_NOT_SUPPORTED` on currency mismatch. Every document and `JournalLine` stores transaction currency + reporting currency + exchange rate snapshot fields. FX gain/loss account subtypes reserved in taxonomy but not generated in Sprint 4. Realized FX and period-end revaluation deferred to Cash & Banking maturity phase. | Locked |
| 17 | Bank reconciliation engine deferred. Sprint 4 delivers BankAccount master data, atomic receipt/payment/transfer postings, live GL-derived bank balances, treasury view. Optional `BankAccountPeriodControl` record for period-close review. Org-level policy: `requireBankReviewBeforePeriodClose`. | Locked |
| 18 | Document numbers are continuous across fiscal years, scoped per `(organizationId, documentType, journalCategory?)`. Allocated via row-locked `DocumentNumberSequence` counter at POST time only — never on DRAFT. Posted numbers immutable and non-reusable. Void/cancelled documents retain their numbers. Migration imports legacy starting offset. | Locked |
| 19 | `GeneralLedgerModule` is a read-only service boundary. `JournalLine` is the canonical ledger row. No separate `GeneralLedgerEntry` table. PostgreSQL views are query projections only, never writable. Materialized views are future performance optimizations, not accounting truth. | Locked |
| 20 | `Account` carries: `isControlAccount`, `controlledSubledgerType`, `controlPostingPolicy: SYSTEM_ONLY \| SYSTEM_OR_APPROVED_ADJUSTMENT \| UNRESTRICTED`. `JournalLine` carries: `postingOrigin: SYSTEM \| MANUAL \| MIGRATION \| ADJUSTMENT`. DB trigger provides defense-in-depth for `MANUAL` posts to `SYSTEM_ONLY` accounts. `SubledgerControlAccountReconciliation` required per control account per period. | Locked |
| 21 | NestJS module boundaries: AR, AP, Cash, Procurement, Inventory call `AccountingPostingPort` synchronously. `AccountingCoreModule` owns posting logic and `JournalEntry`/`JournalLine`. `GeneralLedgerModule` is read-only. The caller owns the outer Prisma transaction and passes the scoped client into the posting port. | Locked |
| 22 | Source financial documents separate `documentStatus` (lifecycle) from `postingStatus: NOT_POSTED \| POSTED \| REVERSED` (accounting effect). `PostingAttempt` records failure history in a separate transaction. Concurrency via `SELECT ... FOR UPDATE` + optimistic revision check + idempotency unique constraint. No persisted `POSTING` intermediate state in the synchronous model. | Locked |

---

## 6. Alternatives Considered and Rejected

### 6.1 Async GL Posting (Rejected)

**Alternative:** Business documents commit first; GL posting happens asynchronously via an event queue.

**Rejected because:** AR subledger and GL would be inconsistent between the business commit and the GL post. Sprint 4 targets a modular monolith with a single tenant DB — eventual consistency is an unnecessary complexity with no compensating benefit at current scale.

### 6.2 Separate GeneralLedgerEntry Table (Rejected)

**Alternative:** Materialize every posted `JournalLine` into a separate `GeneralLedgerEntry` table for reporting.

**Rejected because:** Creates a third copy of the same data alongside `JournalLine` and `PeriodAccountBalance`, requiring continuous reconciliation between all three. `JournalLine` + dimension-aware snapshots is sufficient.

### 6.3 Period 13 as Hard Platform Requirement (Rejected)

**Alternative:** All organizations must have a period 13 adjustment period.

**Rejected because:** Some organizations prefer to post closing entries into December. Period 13 is configurable, not mandatory.

### 6.4 Resetting Document Numbers at Fiscal Year Boundary (Rejected)

**Alternative:** Invoice and journal numbers reset to 1 at the start of each fiscal year (INV-2026-000001).

**Rejected because:** Creates gaps at year boundaries and requires fiscal year to be encoded in the number. The fiscal year is captured by the document date and accounting period — not the number itself.

### 6.5 QuickBooks-style Flat Customer/Vendor Lists (Rejected)

**Alternative:** `Client` and `Supplier` as fully independent aggregates with no shared identity.

**Rejected because:** A company that is both a client and a supplier would have duplicate contact and legal records with no linkage. The `Party` model resolves this without introducing SAP Business Partner complexity.

### 6.6 MAX(id) + 1 for Document Numbering (Rejected)

**Alternative:** Compute next number from the maximum existing number.

**Rejected because:** Under concurrent load, two transactions can read the same MAX before either commits, producing duplicate numbers. Row-locked counter table guarantees atomicity.

### 6.7 Storing currentBalance on BankAccount (Rejected)

**Alternative:** Maintain a mutable `currentBalance` field on `BankAccount` and update it on every posting.

**Rejected because:** Creates a second source of financial truth that can drift from the GL. Bank balance is always derived from `JournalLine` aggregates for `BankAccount.glAccountId`.

### 6.8 Permanent Dual-Reference on ReceiptAllocation (Rejected)

**Alternative:** Keep `ipcId` permanently alongside a new `clientInvoiceId` on `ReceiptAllocation`.

**Rejected because:** The outstanding-balance query for invoices partially paid before Sprint 4 would require querying both references. Long-term technical debt in the AR subledger.

---

## 7. Database and Transaction Constraints

### 7.1 Critical Unique Constraints

```sql
-- Account codes unique per org
UNIQUE (organization_id, code) ON account

-- One bank account per GL account
UNIQUE (organization_id, gl_account_id) ON bank_account

-- Idempotency guard on system postings
UNIQUE (organization_id, source_document_type, source_document_id, accounting_event_id) ON journal_entry

-- Document number sequences
UNIQUE (organization_id, document_type, journal_category) ON document_number_sequence

-- One ClientProfile per Party
UNIQUE (party_id) ON client_profile

-- One SupplierProfile per Party
UNIQUE (party_id) ON supplier_profile

-- PeriodAccountBalance snapshot uniqueness
UNIQUE (organization_id, accounting_period_id, account_id, project_id NULLS DISTINCT,
        department_id NULLS DISTINCT, cost_center_id NULLS DISTINCT) ON period_account_balance

-- Duplicate supplier invoice detection
UNIQUE (organization_id, supplier_profile_id, supplier_invoice_number_normalized) ON supplier_bill
```

### 7.2 Check Constraints

```sql
-- JournalLine: exactly one of debit or credit must be positive
CHECK (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)

-- Same-currency settlement
CHECK PaymentReceipt.currency_code = ClientInvoice.currency_code (application layer)
CHECK SupplierPayment.currency_code = SupplierBill.currency_code (application layer)
```

### 7.3 Database Defense-in-Depth (Triggers)

```sql
-- Reject MANUAL postings to SYSTEM_ONLY control accounts
CREATE TRIGGER trg_reject_manual_control_account_posting
BEFORE INSERT ON journal_line
FOR EACH ROW
WHEN (NEW.posting_origin = 'MANUAL')
BEGIN
  IF (SELECT control_posting_policy FROM account WHERE id = NEW.account_id) = 'SYSTEM_ONLY' THEN
    RAISE EXCEPTION 'CONTROL_ACCOUNT_DIRECT_POSTING_PROHIBITED';
  END IF;
END;

-- Immutability: reject any update to a POSTED journal entry
CREATE TRIGGER trg_immutable_posted_journal
BEFORE UPDATE ON journal_entry
FOR EACH ROW
WHEN (OLD.status = 'POSTED') BEGIN
  RAISE EXCEPTION 'POSTED_JOURNAL_IS_IMMUTABLE';
END;

-- Immutability: reject any update or delete on journal lines of a POSTED entry
CREATE TRIGGER trg_immutable_posted_journal_line
BEFORE UPDATE OR DELETE ON journal_line
FOR EACH ROW
BEGIN
  IF (SELECT status FROM journal_entry WHERE id = NEW.journal_entry_id) = 'POSTED' THEN
    RAISE EXCEPTION 'POSTED_JOURNAL_LINE_IS_IMMUTABLE';
  END IF;
END;
```

### 7.4 Posting Transaction Protocol

```typescript
// The calling subledger module owns the outer Prisma transaction
await prisma.$transaction(async (tx) => {
  // 1. Lock and validate source document
  const invoice = await tx.clientInvoice.findUniqueOrThrow({
    where: { id, organizationId },
    ...{ lock: { mode: 'ForUpdate' } }   // SELECT FOR UPDATE
  });
  if (invoice.postingStatus !== 'NOT_POSTED') throw new AlreadyPostedError();
  if (invoice.revision !== expectedRevision) throw new OptimisticConcurrencyError();

  // 2–8. Delegate to posting port (AccountingCoreModule)
  const result = await accountingPostingPort.post({
    tx,        // pass the transaction-scoped Prisma client
    sourceDocumentType: 'CLIENT_INVOICE',
    sourceDocumentId: invoice.id,
    // … event data
  });

  // 8. Update source document status
  await tx.clientInvoice.update({
    where: { id },
    data: {
      postingStatus: 'POSTED',
      postedJournalEntryId: result.journalEntryId,
      postedAt: new Date(),
      postedBy: userId,
      invoiceNumber: result.documentNumber,
      revision: { increment: 1 },
    }
  });
}, { timeout: 10_000 });
```

---

## 8. State Machines

### 8.1 AccountingPeriod

```
OPEN ──────────────────► LOCKED ──────────────────► CLOSED
                            │                          │
                            │ (CFO reopen command)     │ (CFO reopen command)
                            ▼                          ▼
                        REOPENED ◄────────────────────┘
                            │
                            │ (correcting entries posted; close command)
                            ▼
                        LOCKED ──────────────────► CLOSED
```

| State | What is permitted |
|---|---|
| OPEN | All normal and accounting postings |
| LOCKED | Only authorized closing/adjustment entries |
| CLOSED | No postings of any kind |
| REOPENED | Only specifically authorized correcting/adjusting entries; existing records immutable |

### 8.2 Source Financial Document (ClientInvoice, SupplierBill, PaymentReceipt, SupplierPayment)

```
documentStatus:   DRAFT → PENDING_APPROVAL → APPROVED → CANCELLED
                                                 │
postingStatus:                             NOT_POSTED → POSTED → REVERSED
```

### 8.3 JournalEntry (Manual)

```
DRAFT → PENDING_APPROVAL → APPROVED → POSTED → REVERSED
                                    └── CANCELLED (only before POSTED)
```

### 8.4 FiscalYear

```
DRAFT → ACTIVE → CLOSING → CLOSED
```

### 8.5 PostingRuleVersion

```
DRAFT → APPROVED → ACTIVE → SUPERSEDED
```

---

## 9. Posting and Reversal Flows

### 9.1 ClientInvoice Posting (Example: USD 240,000 + 5% VAT)

```
POST /client-invoices/:id/post

→ Dr Accounts Receivable   252,000   (ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE)
   Cr Project Revenue       240,000   (POSTING_PROFILE: CLIENT_REVENUE)
   Cr Output VAT Payable     12,000   (TAX_CODE: VAT_5_OUTPUT)

JournalEntry: journalCategory=SALES, entryPurpose=STANDARD, sourceDocumentType=CLIENT_INVOICE
```

### 9.2 PaymentReceipt Posting

```
POST /payment-receipts/:id/post

→ Dr Bank GL (Salaam Bank USD)   252,000   (TRANSACTION_ACCOUNT: bankAccountId → glAccountId)
   Cr Accounts Receivable         252,000   (ACCOUNT_SUBTYPE: ACCOUNTS_RECEIVABLE)

JournalEntry: journalCategory=RECEIPT, entryPurpose=STANDARD, sourceDocumentType=PAYMENT_RECEIPT
```

### 9.3 SupplierBill Posting (DIRECT — NON_RECOVERABLE VAT, ACC-TAX-001 resolved)

```
POST /supplier-bills/:id/post

→ Dr Inventory / Expense   1,050   (POSTING_PROFILE: per SupplierBillLine — gross amount including VAT)
   Cr Accounts Payable     1,050   (ACCOUNT_SUBTYPE: ACCOUNTS_PAYABLE)

JournalEntry: journalCategory=PURCHASE, entryPurpose=STANDARD, sourceDocumentType=SUPPLIER_BILL
```

VAT of 50 is absorbed into the expense/inventory cost — no separate recoverable-VAT GL line is posted. The gross amount (1,050) is the single debit.

**VAT line detail is preserved at the subledger level.** `SupplierBillLine.vatCodeId`, `SupplierBillLine.vatAmount`, and `SupplierBillLine.netAmount` are all retained. This serves: (a) VAT-return reporting that must show input VAT charged even when non-recoverable; (b) future re-classification if ACCO's VAT treatment changes; (c) audit trail of the original supplier VAT amount. The GL sees only the gross posting; the subledger retains the full breakdown.

### 9.4 Reversal Flow (Error Correction)

```
1. Finance identifies error in POSTED journal (e.g., wrong account)
2. Finance prepares REVERSAL journal:
   → All lines negated
   → reversalOfJournalEntryId = original journal ID
   → entryPurpose = REVERSAL
3. CFO approves reversal
4. Finance posts reversal:
   → Original journal: reversedAt, reversedBy, reversalJournalEntryId set
   → Reversal journal: status = POSTED
5. Finance prepares REPLACEMENT journal:
   → Correct amounts and accounts
   → entryPurpose = REPLACEMENT
6. CFO approves and Finance posts replacement

Original + Reversal + Replacement are all visible in the GL with their linkage.
```

### 9.5 Period Closing Flow

```
1. [HARD BLOCK] Source documents with status APPROVED + postingStatus NOT_POSTED within the target period
   → Finance must post or void all approved, unposted documents before close

2. [HARD BLOCK] Source documents with postingStatus = FAILED within the target period
   → Finance must retry or void each failed document until postingStatus is no longer FAILED
   → Gate queries postingStatus on the document itself, NOT historical PostingAttempt records
   → A successful retry sets postingStatus = POSTED; the gate then passes (see §17.4)

3. [HARD BLOCK] JournalEntry records with status APPROVED (unposted) within the target period
   → Must be posted or cancelled

4. [HARD BLOCK] Any JournalEntry within the target period that does not balance (∑ debit ≠ ∑ credit)
   → System prevents this state; surfaced as an integrity alert

5. [HARD BLOCK] SubledgerControlAccountReconciliation.variance ≠ 0 for any configured control account
   → Finance must investigate and resolve before close

6. [POLICY GATE — configurable] JournalEntry records with status DRAFT within the target period
   → Blocks close only if organizationPolicy.draftJournalsBlockPeriodClose = true
   → Default for ACCO: true (Finance must promote or discard all drafts)

7. [POLICY GATE — configurable] Bank account period-review not complete
   → Blocks close only if organizationPolicy.requireBankReviewBeforePeriodClose = true
   → Default for ACCO: false (deferred to Cash & Banking phase)

8. Generate PeriodAccountBalance snapshot (atomic with the close command)

9. Validate snapshot: ∑ closingDebit = ∑ closingCredit (integrity check, not a user gate)

10. Mark period LOCKED (review window for Finance)

11. CFO confirms → period CLOSED
```

Only items 1–5 are always-blocking. Items 6–7 are organization-policy-controlled gates. No other condition blocks closure — in particular, DRAFT documents in *other* periods do not affect the target period's close.

### 9.6 Year-End Close — Dedicated Controlled Capability

Year-end close is a distinct, high-risk finance operation. It is **not a small task** and must not be bundled informally into the Phase 4 checklist. Sprint 4 delivers the **foundation and retained-earnings posting model**. Full automation and hardening of the close sequence are a distinct deliverable that may be completed in a follow-on hardening cycle.

**What Sprint 4 must deliver:**

1. `FiscalYear.status` state machine: `DRAFT → ACTIVE → CLOSING → CLOSED`
2. `retainedEarningsAccountId` on `FiscalYear` (must be EQUITY class, RETAINED_EARNINGS subtype)
3. A protected **year-end close command** accessible only to CFO:
   - All 12 periods must be CLOSED before the fiscal year close can begin
   - Command generates the P&L zeroing entry:
     ```
     Dr All INCOME accounts   (year-to-date credit balances)
     Cr All EXPENSE accounts  (year-to-date debit balances)
     Cr/Dr Retained Earnings  (net profit or net loss)

     JournalEntry: journalCategory=GENERAL, entryPurpose=CLOSING
     accountingDate = last day of December (period 12 close date)
     ```
   - The closing entry posts into **December** (period 12) for ACCO. Period is briefly REOPENED → LOCKED → CLOSED around this entry via the controlled reopen command.
   - All INCOME and EXPENSE account balances become zero in the new fiscal year.
   - `FiscalYear.status` advances to CLOSED.
4. Opening balance carry-forward: the closing snapshot for the closed year produces correct opening balances for ASSET, LIABILITY, and EQUITY accounts in the new fiscal year.

**What is deferred (hardening phase):**
- Automated pre-close checklist and sign-off workflow
- Interim close preview report ("what would the closing entry look like?")
- Multi-entity consolidation on close
- Year-end audit package generation

Historical journal lines are permanently immutable and are never rewritten during close.

---

## 10. Control Accounts and Subledger Reconciliation

### 10.1 Control Account Rules

| Account | Subtype | Policy | What posts to it |
|---|---|---|---|
| Accounts Receivable | ACCOUNTS_RECEIVABLE | SYSTEM_ONLY | ClientInvoice, PaymentReceipt, credit notes |
| Accounts Payable | ACCOUNTS_PAYABLE | SYSTEM_ONLY | SupplierBill, SupplierPayment, credit notes |
| Output VAT Payable | TAX_PAYABLE | SYSTEM_OR_APPROVED_ADJUSTMENT | ClientInvoice output VAT line only |
| Recoverable VAT | TAX (input) | SYSTEM_OR_APPROVED_ADJUSTMENT | SupplierBill input VAT — **not used by ACCO** (NON_RECOVERABLE); reserved for future orgs |
| Bank accounts | BANK | SYSTEM_OR_APPROVED_ADJUSTMENT | PaymentReceipt, SupplierPayment, bank transfers |
| Inventory Control | INVENTORY | SYSTEM_ONLY | Inventory movements (Sprint 6) |

Manual journals targeting `SYSTEM_ONLY` accounts are rejected at the application layer. A database trigger provides defense-in-depth.

### 10.2 Reconciliation Requirement

```
AR control GL balance
= ∑ ClientInvoice.outstandingAmount (all POSTED invoices)

AP control GL balance
= ∑ SupplierBill.outstandingAmount (all POSTED bills)

Bank GL balance (per account)
= ∑ JournalLine.debitAmount - ∑ JournalLine.creditAmount for bankAccount.glAccountId

VAT Payable GL balance (ACCO)
= ∑ output VAT posted from ClientInvoices
  (ACCO input VAT is NON_RECOVERABLE — absorbed into expense cost; no offset entry)
```

`SubledgerControlAccountReconciliation` is computed per control account per period. Period close requires zero variance for all configured control accounts.

---

## 11. Migration Implications for Sprint 3 Data

### 11.1 ReceiptAllocation Migration (Decision 14)

Sprint 3's `ReceiptAllocation` references `ipcId` (IPC). The correct AR target in Sprint 4 is `ClientInvoice`. Migration uses a controlled cut-over:

**Phase 1 — Freeze:** No new IPC-level allocations after Sprint 4 deployment.

**Phase 2 — Generate ClientInvoices:** For each effective IPC, generate a `ClientInvoice` record. Preserve invoice date, currency, amounts, exchange rate. Assign invoice numbers from the configured starting sequence.

**Phase 3 — Migrate Allocations:** Repoint each `ReceiptAllocation.clientInvoiceId` to the generated invoice. Record `legacyIpcId` on the invoice.

**Phase 4 — Validate:**
```
For every migrated invoice:
  invoice.totalAmount = migrated sum of allocations + outstandingAmount
  Σ migrated invoice totals = Σ effective IPC values
  Variance = $0.00 (hard failure otherwise)
```

**Phase 5 — CFO Approval:** Finance reviews and signs the migration reconciliation report before cut-over becomes permanent.

**Phase 6 — Deprecation schedule:**
- Sprint 4: `ipcId` deprecated (warn on use)
- Sprint 5: `ipcId` read-only
- Sprint 6: `ipcId` removed

### 11.2 Client → Party + ClientProfile Migration

For each existing `Client` record:
1. Create `Party` (copy legalName, taxNumber, address, contacts)
2. Set `Client.partyId = Party.id`
3. Evolve `Client` model to `ClientProfile` (add AR-specific fields)
4. Existing `clientId` references in `Contract`, `ClientInvoice`, etc. remain valid during transition

### 11.3 Opening Balance Cut-Over and Reconciliation Requirements

Opening balances are imported from QuickBooks as of the go-live date. A correct cut-over requires that the GL opening balances are **reconcilable** to the subledger documents imported in the same batch. The following reconciliation identities must hold before CFO sign-off:

```
AR control account opening balance
  = Σ outstandingAmount of all migrated open ClientInvoice records
  Variance = $0.00 (hard failure)

AP control account opening balance
  = Σ outstandingAmount of all migrated open SupplierBill records
  Variance = $0.00 (hard failure)

Bank account opening balance (per GL account)
  = opening balance supplied by Finance for that bank account
  Cross-checked against: latest QuickBooks bank register balance as of cut-over date
  Variance = $0.00 (hard failure)

Retained Earnings opening balance
  = carried-forward net equity from QuickBooks balance sheet as of cut-over date
```

**Import procedure:**

1. Finance exports: (a) trial balance, (b) open AR invoice list, (c) open AP bill list, (d) bank balances, all as of the same cut-over date.
2. Migration utility generates one balanced `JournalEntry` (`journalCategory = OPENING`, `entryPurpose = OPENING_BALANCE`). Each account balance becomes one `JournalLine`.
3. Net journal must balance (Σ debits = Σ credits).
4. Validation report runs the four reconciliation identities above.
5. CFO approves the reconciliation report. Approval is logged in `AccountingMigrationBatch.approvedBy`.
6. Migration batch is posted. Opening balances are immutable from this point.

Historical transactions remain in QuickBooks for reference. Only the opening trial balance enters Rukna in Sprint 4.

### 11.4 Legacy PaymentReceipt Bank-Account Resolution

**Correction to R-06:** ACCO has multiple active bank accounts. Legacy `PaymentReceipt` records from Sprint 3 carry no `bankAccountId`. These cannot be automatically assigned to a single historical account, because receipts may have been deposited into any of ACCO's active accounts.

**Resolution strategy:**

1. A **Finance-approved bank-resolution migration** assigns `bankAccountId` to each legacy receipt based on Finance's review of the QuickBooks deposit register. Finance provides a mapping CSV: `{receiptId → bankAccountId}`.
2. Any receipt that Finance cannot conclusively assign is placed into a **migration exception queue** (`PaymentReceiptMigrationException` entity) with reason `BANK_ACCOUNT_UNRESOLVABLE`.
3. Exception-queue receipts are migrated with `postingStatus = MIGRATION_EXCEPTION` and cannot be posted until Finance resolves them manually in the UI.
4. The migration reconciliation report lists exception-queue counts. Finance must reduce exceptions to zero (or explicitly accept and document each) before CFO signs off on go-live.

```
PaymentReceiptMigrationException {
  id                  String
  paymentReceiptId    String
  organizationId      String
  reason              String   // BANK_ACCOUNT_UNRESOLVABLE | AMOUNT_MISMATCH | DUPLICATE
  status              ExceptionStatus  // OPEN | RESOLVED | DISMISSED
  resolvedBankAccountId String?
  resolvedBy          String?
  resolvedAt          DateTime?
  notes               String?
}
```

### 11.5 IPC → ClientInvoice Draft Integration

When an IPC is approved (status transitions to EFFECTIVE), the system must automatically generate a `ClientInvoice` in DRAFT status. This is a first-class integration between the construction subledger (Sprint 3) and the AR subledger (Sprint 4) — not an optional hook.

```
IPC approved (EFFECTIVE)
        │
        ▼ (async command dispatch within the same bounded context)
ClientInvoice created (status = DRAFT)
        │
        ├── clientProfileId = IPC.contractId → Contract.clientProfileId
        ├── sourceCertificateId = IPC.id
        ├── subtotal = IPC.certifiedNetAmount
        ├── vatAmount = IPC.certifiedNetAmount × VAT rate (from active TaxCode)
        ├── totalAmount = subtotal + vatAmount
        ├── currencyCode = Contract.currencyCode
        ├── exchangeRateSnapshot = current rate at generation time
        └── invoiceDate = today; dueDate = today + Contract.paymentTermsDays
```

**Invariants:**
- One effective IPC generates at most one `ClientInvoice`. `UNIQUE (organizationId, sourceCertificateId)` enforced.
- Generation is not automatic posting — Finance still reviews and explicitly posts the invoice.
- If the IPC is subsequently superseded or reversed, the draft `ClientInvoice` is cancelled (if not yet approved or posted). If already posted, correction follows the reversal + replacement flow.
- The `sourceCertificateId` link is permanent and immutable once set.

---

## 12. Security, Permissions, Audit, and Immutability

### 12.1 Role Segregation

| Role | Capabilities |
|---|---|
| Accountant Officer | Create DRAFT journals; prepare ClientInvoice/SupplierBill; submit for approval |
| Chief Finance Officer | Approve journals; approve invoices and bills; approve period close; approve reversals; approve period reopen |
| System (PostingEngine) | Create system-generated journals via PostingPort; no approval step required |
| Senior Accountant | Configurable intermediate approval level (if org enables it) |
| Auditor | Read-only access to all posted entries, reports, and audit history |

**Four-eyes principle:** The user who creates a journal entry cannot be the user who approves it (`ACC-017`).

### 12.2 Audit Trail Requirements

Every accounting action must record:

| Field | Populated by |
|---|---|
| `createdBy` / `createdAt` | Any document creation |
| `approvedBy` / `approvedAt` | Approval commands |
| `postedBy` / `postedAt` | POST command |
| `reversedBy` / `reversedAt` | Reversal commands |
| `reopenedBy` / `reopenedAt` | Period reopen commands |
| `postingRuleVersionId` | System-generated postings |
| `resolvedAccountId` / `accountCodeSnapshot` / `accountNameSnapshot` | Every JournalLine |
| `resolutionSource` | Account determination |

The existing audit log infrastructure (Sprint 1) captures all entity changes. Accounting-specific audit fields are stored on the entities themselves for fast access.

### 12.3 Immutability Guarantees

- POSTED `JournalEntry` and `JournalLine` records are immutable at both application layer and database layer (triggers).
- Posted document numbers are immutable and non-reusable.
- `PeriodAccountBalance` snapshots are never overwritten — rebuilds create new versions.
- `PostingRuleVersion` records are immutable once used. Changes create new versions.
- `AccountingMigrationBatch` records are immutable after completion.

### 12.4 Cross-Tenant Isolation

All accounting entities carry `organizationId`. Every query must filter by `organizationId`. No accounting aggregate is accessible across organization boundaries. This is enforced at the application layer consistent with existing platform security rules.

---

## 13. Deferred Scope

The following capabilities are explicitly deferred and must not be built in Sprint 4:

| Capability | Reason / Target |
|---|---|
| Bank statement import and automated matching | Requires file parsing, matching engine, reconciliation sessions — Cash & Banking phase |
| Realized FX gain/loss at settlement | ACCO currently USD-only; deferred to Cash & Banking phase |
| Period-end unrealized FX revaluation | Same as above |
| Full VAT return filing workflow | Depends on tax authority integration and period accumulation |
| Payroll journal automation | Sprint 8 |
| Fixed assets and depreciation engine | Sprint 8 |
| Consolidation across legal entities | Sprint 9 |
| Credit notes (AR) | Sprint 7 — AR maturity phase |
| Supplier credit notes (AP) | Sprint 7 |
| Three-way PO matching | Sprint 5 — Procurement |
| Inventory GL integration | Sprint 6 |
| Statutory financial statement templates | Sprint 9 |
| Workflow builder UI for posting rules | Settings UI — post-Sprint 4 frontend |
| Budget Authorization for INTERNAL_CAPITAL projects | Previously deferred; remains deferred |
| Subcontracts and subcontract certificates | Previously deferred; remains deferred |

The account subtype taxonomy reserves: `REALIZED_FX_GAIN`, `REALIZED_FX_LOSS`, `UNREALIZED_FX_GAIN`, `UNREALIZED_FX_LOSS` for future use. No journal lines using these subtypes are generated in Sprint 4.

---

## 14. Business Configuration Resolutions

All three business configuration questions are resolved (2026-08-05).

### ACC-TAX-001 — Input VAT Treatment ✓ RESOLVED

**Decision:** Input VAT is **NON_RECOVERABLE** and is absorbed into the inventory or expense cost.

**ACCO posting for a 1,000 net + 50 VAT supplier bill:**
```
Dr Inventory / Expense   1,050   (gross amount including VAT)
Cr Accounts Payable      1,050
```

`TaxCode.recoveryMethod = NON_RECOVERABLE` for `VAT_5_INPUT`. `inputTaxAccountId = null`. No separate recoverable VAT account is used. `SupplierBillLine.vatAmount` is stored for audit and VAT-return reporting but does not generate a GL posting.

### ACC-PER-001 — Adjustment Period / Period 13 ✓ RESOLVED

**Decision:** ACCO uses **12 OPERATING periods, 0 ADJUSTMENT periods.** Year-end adjustments and closing entries are posted into December (period 12 of the fiscal year). The platform still supports optional ADJUSTMENT periods for future organizations; ACCO does not configure them.

### ACC-DIM-001 — CostCenter → Department Relationship ✓ RESOLVED

**Decision:** Each CostCenter belongs to **exactly one Department.** `CostCenter.departmentId` is mandatory for ACCO. Posting validation enforces consistency: if a `JournalLine` carries both `costCenterId` and `departmentId`, the cost center's `departmentId` must match the line's `departmentId`. Mismatch raises `COST_CENTER_DEPARTMENT_MISMATCH` and the posting is rejected.

---

## 15. Implementation Consequences

1. **Strict Clean Architecture layering for all accounting commands.** Accounting and posting logic must never live inside aggregates directly. The mandated pattern:

```
HTTP Request
      │
      ▼
Use Case (Application Layer)
      │   owns the Prisma transaction, orchestrates all steps
      │
      ├── Aggregate (Domain Layer)
      │     validates business rules, applies domain events
      │     does NOT know about the database or posting engine
      │
      └── AccountingPostingPort (Infrastructure boundary)
            performs all accounting work within the caller's transaction
            does NOT know about the aggregate or business workflow

Example:
  PostClientInvoiceUseCase
    → loads ClientInvoice aggregate from repository
    → calls invoice.markAsPosting() → validates: APPROVED, NOT_POSTED, correct revision
    → calls accountingPostingPort.post({ tx, ...command })
    → calls invoice.markAsPosted(result.journalEntryId, result.documentNumber)
    → persists the aggregate
    → all within a single prisma.$transaction(tx => ...)
```

This separation means:
- Aggregate rules (correct state transition, currency consistency) are testable without a database.
- The posting port is testable without business aggregates.
- Use cases are integration tests that wire both together.
- A new subledger module in Sprint 5 follows the identical pattern with no change to the posting engine.

2. **Prisma schema changes are additive** for most Sprint 4 entities. The Sprint 3 `Client` migration is the only table that changes existing structure.

2. **`AccountingPostingPort` must be defined as a NestJS interface** and declared in `AccountingCoreModule`. All subledger modules inject it. The implementation class is registered in `AccountingCoreModule`.

3. **Every existing Sprint 3 POST or PATCH command that affects financial state** (e.g., IPC approval) must be reviewed to determine if it now triggers a `ClientInvoice` draft generation.

4. **The eight-step posting sequence is a single Prisma transaction.** Timeouts must be set appropriately (recommend 10–15 seconds). Deadlock detection must handle the case where two concurrent POST commands target the same source document.

5. **`PeriodAccountBalance` generation** must be a blocking step of the period-close command — not a background job. If snapshot generation fails, the period does not close.

6. **Document number sequences use `FOR UPDATE` row locks.** Under high concurrency, this is a serialization point. It is acceptable because number allocation is fast (single row increment). Number is allocated only at POST time, not at DRAFT creation.

7. **The `PostingAttempt` write after rollback** requires a new, independent connection or a deferred task running outside the failed transaction. This is distinct from the transactional outbox, which uses the committed transaction.

8. **All new financial reports** (trial balance, P&L, balance sheet) are served by `GeneralLedgerModule` and `PeriodBalanceQueryService`. They must never import from subledger module repositories directly.

9. **Realistic implementation timeline — single backend engineer: 8–11 weeks.** The four-phase structure maps roughly as follows with one engineer: Phase 1 (schema + COA import + module skeleton): ~2 weeks. Phase 2 (posting engine + AR subledger + IPC integration): ~3 weeks. Phase 3 (AP subledger + GL reports): ~2–3 weeks. Phase 4 (period management + year-end foundation + migration + opening balances): ~2–3 weeks. With two engineers working Phase 2 and Phase 3 in parallel, the total compresses to 6–8 weeks. A four-week estimate requires at least three engineers working in parallel and is not realistic for a single-engineer path. The timeline does not include frontend delivery, which is a separate workstream.

---

## 16. Definition of Done

Sprint 4 is complete when all of the following are satisfied:

### Architecture
- [ ] `AccountingCoreModule`, `AccountsReceivableModule`, `AccountsPayableModule`, `GeneralLedgerModule` created with correct NestJS module boundaries
- [ ] `AccountingPostingPort` interface defined and implemented
- [ ] No subledger module imports `JournalEntry` or `JournalLine` repositories directly
- [ ] All posting commands follow the Use Case → Aggregate → AccountingPostingPort layering pattern
- [ ] `AccountingConfiguration` seeded for ACCO; all modules read policy through `AccountingConfigurationService`

### Domain Models (Prisma schema)
- [ ] All Sprint 4 entities from Section 3 exist in the Prisma schema, including `PostingProfile`, `AccountingConfiguration`, and `PaymentReceiptMigrationException`
- [ ] `Account`, `Department`, `CostCenter` carry `effectiveFrom` / `effectiveTo` versioning envelope
- [ ] `PostingRuleLineTemplate.postingProfileId` references `PostingProfile` (no bare string keys)
- [ ] All unique constraints from Section 7.1 are in place
- [ ] All check constraints and triggers from Sections 7.2 and 7.3 are deployed
- [ ] Sprint 3 `Client` → `Party + ClientProfile` migration complete

### Accounting Engine
- [ ] Eight-step posting sequence implemented and tested for `ClientInvoice`, `SupplierBill`, `PaymentReceipt`, `SupplierPayment`
- [ ] Posting is idempotent (duplicate POST returns the existing journal, no duplicate created)
- [ ] `PostingAttempt` records are written on failure
- [ ] Same-currency constraint enforced with `CROSS_CURRENCY_SETTLEMENT_NOT_SUPPORTED` error

### Chart of Accounts and Configuration
- [ ] ACCO's chart of accounts imported from QuickBooks
- [ ] Control accounts configured with `SYSTEM_ONLY` restriction
- [ ] **All** active ACCO bank accounts configured with 1:1 GL account mapping (Finance sign-off required)
- [ ] `DocumentNumberSequence` records initialized (with legacy starting offsets)
- [ ] `VAT_5_OUTPUT` TaxCode active with output account set
- [ ] `VAT_5_INPUT` TaxCode active with `recoveryMethod = NON_RECOVERABLE`, `inputTaxAccountId = null`

### Subledger and GL
- [ ] `ClientInvoice` lifecycle: DRAFT → APPROVED → POSTED
- [ ] `SupplierBill` lifecycle: DRAFT → APPROVED → POSTED
- [ ] `PaymentReceipt` extended with `bankAccountId`; posts to correct bank GL account
- [ ] `SupplierPayment` with M:M allocation; posts per-bill AP debit
- [ ] GL balance (by account, by period) computable from posted `JournalLine` records

### Reporting
- [ ] Trial Balance report (by period, using snapshots for closed periods)
- [ ] Account Ledger (T-account view with running balance)
- [ ] Profit & Loss report (INCOME and EXPENSE accounts; by period, by project, by department)
- [ ] Balance Sheet report (ASSET, LIABILITY, EQUITY accounts; requires retained-earnings posting model)
- [ ] Cash Flow Statement explicitly marked as **deferred** — not included in Sprint 4
- [ ] `PeriodAccountBalance` snapshot generated on period close
- [ ] Snapshot invalidation on period reopen; rebuild on re-close

### Period Management
- [ ] Period state machine (`OPEN → LOCKED → CLOSED → REOPENED → LOCKED → CLOSED`) enforced
- [ ] Period close hard blocks: approved-unposted source documents in target period, source documents with postingStatus=FAILED (NOT historical PostingAttempt records — see §17.4), approved-unposted journals, unresolved control-account variances
- [ ] Period close policy gates: draft journals (configurable per org; ACCO default = blocking), bank review (ACCO default = not required)
- [ ] `SubledlerControlAccountReconciliation` computed per control account per period
- [ ] `FiscalYear` state machine and year-end close command (CFO only) implemented
- [ ] Year-end P&L zeroing entry posts into December; retained earnings credited/debited

### Migration
- [ ] `AccountingMigrationBatch` entity exists
- [ ] `ReceiptAllocation` cut-over migration script written and tested against staging data
- [ ] `PaymentReceiptMigrationException` entity exists; bank-resolution exceptions captured
- [ ] Finance provides bank-account mapping CSV; legacy receipts assigned or queued
- [ ] Migration reconciliation report: AR balance = open invoice total; AP balance = open bill total; Bank balances = QuickBooks register balances; all variances $0.00
- [ ] CFO signs off on reconciliation report before production cut-over
- [ ] Opening balance import utility generates one balanced OPENING JournalEntry
- [ ] IPC → ClientInvoice Draft generation wired (approved IPC automatically produces DRAFT ClientInvoice)
- [ ] `UNIQUE (organizationId, sourceCertificateId)` enforced on ClientInvoice

### Security and Audit
- [ ] Four-eyes: journal creator ≠ approver enforced
- [ ] All posted entries carry full audit metadata
- [ ] Posted entries cannot be modified or deleted (application + DB trigger)
- [ ] `organizationId` filter on every accounting query

### Business Confirmations
- [x] ACC-TAX-001 — input VAT `NON_RECOVERABLE`; gross amount (net + VAT) posted to expense/inventory; `VAT_5_INPUT.inputTaxAccountId = null`
- [x] ACC-PER-001 — 12 OPERATING periods, 0 ADJUSTMENT periods; year-end entries post into December
- [x] ACC-DIM-001 — `CostCenter.departmentId` mandatory; `COST_CENTER_DEPARTMENT_MISMATCH` validation enforced on JournalLine

---

**Companion documents:**
- `docs/02-architecture/accounting-event-catalog.md` — the authoritative catalog of all accounting events, posting rules, journal structures, and error codes. Every event type referenced in `PostingRuleVersion.eventType` must have an entry there.

*ADR-006 — Accepted 2026-08-05. Corrections applied 2026-08-05: R-06 bank-resolution migration, period-close gate refinement, year-end close as dedicated capability, P&L/Balance Sheet in Sprint 4 reporting, Cash Flow deferred, IPC→ClientInvoice Draft integration, opening-balance reconciliation identities, 8–11 week single-engineer timeline, all active bank accounts in Phase 1, VAT line detail preservation. Architecture improvements 2026-08-05: Clean Architecture layering, PostingProfile entity, Account/Dimension versioning, AccountingConfiguration module. Integrity addendum 2026-08-06: opening-balance subledger loading, allocation event protocol, P&L/Trial Balance filter rules, period-close gate unresolved-failures-only, snapshot rebuild sequence, allocation invariants, attachment immutability.*
*Next review: Sprint 5 kickoff, or immediately upon any change to the accounting engine scope.*

---

## 17. Accounting Integrity Addendum (2026-08-06)

These decisions were finalized after the initial schema review and before implementation began. They are binding and must be implemented exactly as specified.

---

### 17.1 Opening Balance — Subledger Loading Protocol

**Problem:** The migration plan previously stated "import open AR/AP documents as POSTED, with individual opening balance journals." This produces double-posting: the opening trial balance journal already contains the AR/AP control account total; posting individual document journals would credit AR/debit AP a second time.

**Decision:** Open subledger documents (ClientInvoice, SupplierBill) loaded during migration are given `postingStatus = OPENING_BALANCE`. They receive no individual `JournalEntry`. Their aggregate balance is represented by one line in the opening balance journal (`EVT-OPB-001`).

**Rules:**
1. The opening balance journal is the sole GL entry for historical balances. Individual document journals are prohibited during migration for any document with `postingStatus = OPENING_BALANCE`.
2. The opening balance journal AR line = `∑ open ClientInvoice.outstandingAmount` (reconciliation identity, must be $0.00 variance before CFO approves migration).
3. The opening balance journal AP line = `∑ open SupplierBill.outstandingAmount` (same identity requirement).
4. When a client pays an opening-balance invoice after go-live, `PaymentReceipt.POSTED` posts normally (Dr Bank / Cr AR). The invoice's `outstandingAmount` decreases as usual. The control account reconciliation holds because the payment journal credits AR by exactly the settled amount.
5. `OPENING_BALANCE` documents appear in the AR/AP subledger for drill-down but are excluded from the "unposted approved documents" period-close gate check.

---

### 17.2 Allocation Accounting — Post-Payment GL Events

**Problem:** After a payment is posted with an unallocated remainder, updating `ClientReceiptAllocation` or `SupplierPaymentAllocation` without a corresponding GL entry produces a subledger that diverges from the GL. The Unapplied/Advance account balance would be wrong.

**Decision:** Post-payment allocation changes are accounting events that always produce a GL journal. The subledger and GL are updated atomically in the same transaction.

**Two allocation event types:**

| Event | ID | Direction |
|---|---|---|
| Apply unallocated receipt to an invoice | `EVT-AR-005` | Dr Unapplied → Cr AR |
| Reverse that application | `EVT-AR-006` | Dr AR → Cr Unapplied |
| Apply supplier advance to a bill | `EVT-AP-005` | Dr AP → Cr Supplier Advance |
| Reverse that application | `EVT-AP-006` | Dr Supplier Advance → Cr AP |

**Allocation lifecycle on `ClientReceiptAllocation.postingStatus`:**
- `POSTED` — created at payment post time (covers part of `EVT-AR-003` journal)
- `NOT_POSTED → POSTED` — created post-payment; GL journal `EVT-AR-005` atomically sets `POSTED`
- `REVERSED` — `EVT-AR-006` journal atomically sets `REVERSED`; restores subledger amounts

**Initial vs subsequent allocations:**  
An initial allocation's `journalEntryId = paymentReceipt.postedJournalEntryId`. A subsequent allocation's `journalEntryId` points to the `EVT-AR-005` journal. Initial allocations cannot be individually reversed — reverse the payment itself (`EVT-AR-004`).

**Prohibition:** Finance must not modify allocation amounts directly in the database. Every allocation change requires the appropriate event posted through the use-case layer.

---

### 17.3 Financial Statement Filters — P&L vs Post-Close Trial Balance

The year-end closing entry (`entryPurpose = CLOSING`, `journalCategory = YEAR_END_CLOSE`) zeroes out all P&L accounts into Retained Earnings. Including it in the P&L would show zero revenue and zero expense — which is wrong.

**Mandatory report filters:**

| Report | JournalLine filter | Account class filter |
|---|---|---|
| **Profit & Loss** | `entry.entryPurpose != CLOSING` | INCOME, COST_OF_SALES, EXPENSE |
| **Pre-close P&L (December)** | `entry.entryPurpose != CLOSING` | INCOME, COST_OF_SALES, EXPENSE |
| **Trial Balance (post-close)** | No filter on entryPurpose | All classes |
| **Balance Sheet** | No filter on entryPurpose | ASSET, LIABILITY, EQUITY |
| **Account Ledger** | No filter | Single account (all purposes visible with linkage) |

**Key distinction:** December closing adjustments (`journalCategory = CLOSING_ADJUSTMENT`, `entryPurpose = NORMAL`) ARE included in P&L — they are real period expenses (depreciation, accruals, reclassifications). Only `entryPurpose = CLOSING` (the P&L zeroing entry) is excluded.

**Implementation note:** The P&L query must always include `AND (entry.entryPurpose != 'CLOSING' OR entry.entryPurpose IS NULL)`. This must be enforced in the `GeneralLedgerModule` query layer, not in individual controllers.

---

### 17.4 Period-Close Gate — Unresolved Failures Only

**Problem:** Gate check #2 previously said "block if any `PostingAttempt.outcome = FAILURE_*` exists in the period." This is wrong — a successful retry creates a `SUCCESS` record after the failure. The failure record remains, but the document is now posted. Blocking on any historical failure prevents periods from ever closing after a retry occurs.

**Corrected gate check #2:**
```
Block if: any document in the period has postingStatus = FAILED
```

Because `postingStatus` is updated to `POSTED` on successful retry, a retried-and-succeeded document has `postingStatus = POSTED` and will not block the gate. No `PostingAttempt` query is needed for the close check.

**Documents in scope for this check (by `accountingDate` within the period):**
- `ClientInvoice` where `documentStatus = APPROVED` and `postingStatus = FAILED`
- `SupplierBill` where `documentStatus = APPROVED` and `postingStatus = FAILED`
- `SupplierPayment` where `documentStatus = APPROVED` and `postingStatus = FAILED`
- `PaymentReceipt` where `documentStatus = APPROVED` and `postingStatus = FAILED`

`OPENING_BALANCE` status documents are excluded from this check.

---

### 17.5 Snapshot Rebuild Sequence After Period Reopen

Reopening a period invalidates that period's snapshot and the closing-balance basis of every subsequent period. The rebuild must be sequential; skipping a predecessor leaves downstream snapshots with incorrect opening balances.

**On REOPEN transition:**
```
1. PeriodAccountBalance.status = INVALID for the reopened period AND all later periods
2. All JournalEntry.status = POSTED for the reopened period remain visible; only snapshot is invalidated
```

**On RE-CLOSE transition:**
```
1. Run all 7 period-close gate checks (§7 period-close gate) against the reopened period
2. Generate PeriodAccountBalance snapshot for the now-closing period
3. Set PeriodAccountBalance.status = VALID
4. Repeat for each subsequent period in ascending order before the next period can close
```

**Enforcement:** A period may not transition to CLOSED if any earlier period's `PeriodAccountBalance.status != VALID`. This is enforced in the `PeriodCloseUseCase` before executing the gate checks.

---

### 17.6 Allocation Invariants

These invariants must be enforced by the application use case before committing any allocation change. They are not expressible as SQL constraints because they involve derived sums.

**PaymentReceipt invariants:**
```
at all times:
  receipt.totalAmount = receipt.allocatedAmount + receipt.unallocatedAmount

after any allocation change:
  ∑ ClientReceiptAllocation.allocatedAmount
    WHERE paymentReceiptId = receipt.id
    AND postingStatus IN ('POSTED')
  = receipt.allocatedAmount
```

**SupplierPayment invariants:**
```
at all times:
  payment.totalAmount = payment.allocatedAmount + payment.unallocatedAmount

after any allocation change:
  ∑ SupplierPaymentAllocation.allocatedAmount
    WHERE supplierPaymentId = payment.id
    AND postingStatus IN ('POSTED')
  = payment.allocatedAmount
```

**Violation response:** Reject the allocation command with `ALLOCATION_INVARIANT_VIOLATION`. The use case must re-read the aggregate with a row lock (`SELECT FOR UPDATE` on the payment header) before computing and checking these invariants to prevent race conditions from concurrent allocations.

---

### 17.7 Posted-Journal Attachment Immutability

**Rules:**
1. Attachments on DRAFT/SUBMITTED/APPROVED journals may be added or deleted freely.
2. Once a journal is POSTED, its attachments may not be deleted. Application layer enforces this check before any attachment delete.
3. New attachments may be added to POSTED journals with `isPostSubmission = true` (supplementary audit evidence). This action requires the `journal:attach-post-submission` permission (Finance role or CFO).
4. A raw SQL trigger enforces delete-prohibition as defense-in-depth:

```sql
CREATE OR REPLACE FUNCTION trg_journal_attachment_immutable()
RETURNS trigger AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = OLD.journal_entry_id;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'ATTACHMENT_IMMUTABLE: cannot delete attachment from a POSTED journal';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_attachments_immutable
  BEFORE DELETE ON journal_entry_attachments FOR EACH ROW
  EXECUTE FUNCTION trg_journal_attachment_immutable();
```

---

## 18. Migration Rules — Go-Live Data Loading Protocol

### 18.1 Scope

This section governs how data is migrated from QuickBooks Desktop 2024 into Rukna at go-live.
It does NOT cover day-2 operations or ongoing data changes after go-live.

### 18.2 Migration Phases

```
Phase 1 — Chart of Accounts import
Phase 2 — Master data (Clients, Suppliers, Bank Accounts, Tax Codes, Departments, Cost Centers)
Phase 3 — Opening Trial Balance journal (EVT-OPB-001)
Phase 4 — Open document subledger loading (Invoices, Bills)
Phase 5 — Reconciliation gate verification (CFO approval required)
Phase 6 — Historical transactions (optional — if QuickBooks data is extractable)
```

Go-live is NOT permitted to proceed past Phase 5 without all reconciliation identities
showing zero variance.

### 18.3 Open Document Loading — OPENING_BALANCE Protocol

**Applies to:** All ClientInvoices and SupplierBills with outstanding balances at the
cut-over date.

**Rule:** Open documents are loaded as subledger records ONLY. No individual JournalEntry
is created for any document. Their aggregate effect on AR and AP control accounts is
represented exclusively by the single opening balance journal (EVT-OPB-001).

**Prohibited:** Posting individual GL journals for migrated open documents. This would
double-count AR and AP balances (once in the opening balance journal, once per document).

**PostingStatus assignment:**

| Document Type | PostingStatus | JournalEntryId |
|---|---|---|
| Open ClientInvoice (outstanding > 0) | `OPENING_BALANCE` | `null` |
| Fully paid ClientInvoice (migrated for history) | `POSTED` | migration-journal-id |
| Open SupplierBill (outstanding > 0) | `OPENING_BALANCE` | `null` |
| Fully paid SupplierBill (migrated for history) | `POSTED` | migration-journal-id |

**Behavior after go-live:**
- Normal payment posting (EVT-AR-003, EVT-AP-003) works against `OPENING_BALANCE` documents
  without modification — the use case checks `postingStatus IN ('POSTED', 'OPENING_BALANCE')`
  when validating that a bill exists and has outstanding balance.
- An `OPENING_BALANCE` document is settled when `outstandingAmount` reaches zero through
  normal payment postings after go-live.

### 18.4 Opening Balance Journal — Reconciliation Requirements

Before CFO signs off on Phase 5:

```
Identity 1 (AR):
  GL Account balance (code = AR control) = ∑ ClientInvoice.outstandingAmount
  WHERE postingStatus = 'OPENING_BALANCE'
  → variance must be $0.00

Identity 2 (AP):
  GL Account balance (code = AP control) = ∑ SupplierBill.outstandingAmount
  WHERE postingStatus = 'OPENING_BALANCE'
  → variance must be $0.00

Identity 3 (Bank — per account):
  For each BankAccount:
    GL Account balance = Finance-supplied bank register balance at cut-over date
    → variance must be $0.00

Identity 4 (Trial Balance):
  ∑ Debit balances = ∑ Credit balances across all accounts in opening journal
  → always true by double-entry; verified by `prisma validate` equivalent on journal lines
```

### 18.5 Period-Close Gate Behavior for OPENING_BALANCE Documents

`OPENING_BALANCE` documents are excluded from the period-close blocking gate.

The close gate queries:
```sql
SELECT COUNT(*) FROM client_invoices
WHERE organization_id = :orgId
  AND accounting_date BETWEEN :periodStart AND :periodEnd
  AND posting_status = 'FAILED';
-- Same for supplier_bills, payment_receipts, supplier_payments
```

`OPENING_BALANCE` is not `FAILED`. The gate never blocks on migrated open documents.

### 18.6 Historical Transaction Migration (Optional)

If historical transactions are extractable from QuickBooks:

1. Each historical journal is imported with `postingOrigin = SYSTEM_OPENING`.
2. Historical documents (paid invoices, paid bills) receive `postingStatus = POSTED`
   and `postedJournalEntryId` referencing the historical journal.
3. Historical periods are created as `CLOSED` immediately after import.
4. Historical periods are NOT eligible for reopening without CFO sign-off and a
   separate exception ADR.
5. Opening balance journal covers only the balances as of cut-over date; historical
   journals cover all prior period activity.

### 18.7 Migration Tooling Requirements

The migration utility must:

1. Run as a standalone NestJS CLI command, not as a live API call.
2. Execute all document loads in a single database transaction per entity type
   (one tx for all invoices, one tx for all bills).
3. Produce a reconciliation report (CSV + PDF) before CFO approval gate.
4. Be idempotent — safe to re-run if a phase fails midway.
5. Log every row created with `migrationBatchId` for auditability.
6. Refuse to proceed if `AccountingMigrationBatch.status != APPROVED` at Phase 3 entry.

---

## 19. Test Matrix — Sprint 4 Accounting Integrity

This matrix covers accounting-specific test cases that must pass before Sprint 4 is
considered complete. Integration tests hit a real PostgreSQL database — no mocking of
the accounting layer. Unit tests may mock at the port boundary.

Each row: Scenario → Expected outcome → Event / invariant tested.

### 19.1 Opening Balance Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| OB-01 | Post opening balance journal with 10 accounts, ∑Dr = ∑Cr | Journal POSTED, all balances recorded | EVT-OPB-001 |
| OB-02 | Post opening balance journal with ∑Dr ≠ ∑Cr | Rejected: IMBALANCED_JOURNAL | ACC-003 |
| OB-03 | ClientInvoice loaded with postingStatus=OPENING_BALANCE | No JournalEntry created; outstandingAmount matches import value | §18.3 |
| OB-04 | Period-close gate with an OPENING_BALANCE invoice in period | Gate returns zero FAILED documents; period closes | §18.5 |
| OB-05 | Pay an OPENING_BALANCE invoice post-go-live | EVT-AR-003 posts normally; invoice outstandingAmount → 0 | §18.3 |
| OB-06 | AR reconciliation identity: GL AR = ∑ OPENING_BALANCE invoice outstanding | Variance = $0.00 | §18.4 Identity 1 |
| OB-07 | AP reconciliation identity: GL AP = ∑ OPENING_BALANCE bill outstanding | Variance = $0.00 | §18.4 Identity 2 |
| OB-08 | Attempt to post individual GL journal for an OPENING_BALANCE document | Rejected: OPENING_BALANCE_DOCUMENT_NOT_POSTABLE | §17.1 |

### 19.2 Allocation GL Integrity Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| AL-01 | Post receipt fully allocated to one invoice | EVT-AR-003 Branch A: Dr Bank / Cr AR; allocation postingStatus=POSTED | EVT-AR-003 |
| AL-02 | Post receipt with 3,000 unallocated | EVT-AR-003 Branch B: Dr Bank / Cr AR (partial) / Cr Unapplied | EVT-AR-003 |
| AL-03 | Apply 3,000 unallocated receipt to a second invoice | EVT-AR-005: Dr Unapplied / Cr AR; allocation postingStatus=POSTED | EVT-AR-005 |
| AL-04 | Reverse subsequent allocation | EVT-AR-006: Dr AR / Cr Unapplied; allocation postingStatus=REVERSED | EVT-AR-006 |
| AL-05 | Post supplier payment with 500 unallocated advance | EVT-AP-003 Branch B: Dr AP / Dr Advance / Cr Bank | EVT-AP-003 |
| AL-06 | Apply 500 advance to a bill | EVT-AP-005: Dr AP / Cr Advance; allocation postingStatus=POSTED | EVT-AP-005 |
| AL-07 | Reverse subsequent advance allocation | EVT-AP-006: Dr Advance / Cr AP; allocation postingStatus=REVERSED | EVT-AP-006 |
| AL-08 | Attempt to individually reverse an initial allocation (from payment journal) | Rejected: INITIAL_ALLOCATION_NOT_INDIVIDUALLY_REVERSIBLE | §17.2 |
| AL-09 | allocatedAmount + unallocatedAmount > totalAmount at post time | Rejected: ALLOCATION_INVARIANT_VIOLATION | §17.6 |
| AL-10 | ∑ POSTED allocation amounts > receipt.allocatedAmount after concurrent allocation | Rejected via SELECT FOR UPDATE; invariant enforced | §17.6 |
| AL-11 | Unapplied Client Receipts balance = ∑ unallocatedAmount across all POSTED receipts | Control balance matches subledger computation | §17.2 |

### 19.3 Financial Statement Filter Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| FS-01 | Year-end close journal posted (entryPurpose=CLOSING) | P&L query excludes this journal; P&L total unchanged | §17.3 |
| FS-02 | P&L query over December including CLOSING_ADJUSTMENT journals | CLOSING_ADJUSTMENT included (entryPurpose=NORMAL); revenue/expense lines show | §17.3 |
| FS-03 | Post-close Trial Balance includes CLOSING entry | Income accounts show $0; Retained Earnings shows correct balance | §17.3 |
| FS-04 | Pre-close P&L (entryPurpose != CLOSING filter) shows correct net income | Matches expected: Revenue − Expense = Net Income | §17.3 |
| FS-05 | AR control account balance equals ∑ outstanding ClientInvoices | variance = $0.00 (reconciliation check) | §10 |
| FS-06 | AP control account balance equals ∑ outstanding SupplierBills | variance = $0.00 (reconciliation check) | §10 |

### 19.4 Period-Close Gate Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| PC-01 | Period with a FAILED invoice: close attempted | Rejected: UNRESOLVED_POSTING_FAILURES (lists document IDs) | §17.4 |
| PC-02 | Same invoice retried and posting succeeds (postingStatus → POSTED) | Gate query returns 0 FAILED documents; period closes | §17.4 |
| PC-03 | Period with historical PostingAttempt FAILED records but no current FAILED document | Gate passes (PostingAttempt history not queried) | §17.4 |
| PC-04 | Period with OPENING_BALANCE invoice: close attempted | Gate passes (OPENING_BALANCE is not FAILED) | §18.5 |
| PC-05 | Period 12 locked; CLOSING_ADJUSTMENT journal posted | Accepted; period remains LOCKED | §17.5, EVT-JNL-001 |
| PC-06 | Period 12 locked; GENERAL journal attempted | Rejected: PERIOD_LOCKED_REQUIRES_CLOSING_ADJUSTMENT | EVT-JNL-001 |
| PC-07 | Period 12 locked; GENERAL journal attempted | Rejected: PERIOD_LOCKED_REQUIRES_CLOSING_ADJUSTMENT | EVT-JNL-001 |
| PC-08 | Period closed; any posting attempted | Rejected: PERIOD_CLOSED | §8 |

### 19.5 Snapshot Rebuild Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| SN-01 | Close Period 3; snapshot generated with status=VALID | PeriodAccountBalance records created for all active accounts | §17.5 |
| SN-02 | Reopen Period 3; Period 3 and Periods 4–12 snapshots invalidated | All downstream PeriodAccountBalance.status = INVALID | §17.5 |
| SN-03 | Attempt to close Period 4 while Period 3 snapshot is INVALID | Rejected: PREDECESSOR_SNAPSHOT_INVALID | §17.5 |
| SN-04 | Re-close Period 3 → snapshot → re-close Period 4 | Both periods close sequentially; snapshots become VALID | §17.5 |
| SN-05 | Control-account reconciliation uses closing balances, not period movements | Closing balance = opening balance + ∑ period debits − ∑ period credits | §10 |

### 19.6 Allocation Invariant Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| INV-01 | Set receipt.unallocatedAmount such that total ≠ allocated + unallocated | Domain invariant rejects before any DB write | §17.6 |
| INV-02 | Two concurrent allocation requests on same receipt: first wins, second rejected | SELECT FOR UPDATE prevents race; invariant holds | §17.6 |
| INV-03 | Reverse allocation: unallocated restored, invariant holds | receipt.allocated + unallocated = total after reversal | §17.6 |

### 19.7 Attachment Immutability Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| ATT-01 | Delete attachment from DRAFT journal | Succeeds | §17.7 |
| ATT-02 | Delete attachment from POSTED journal | Rejected by application layer: ATTACHMENT_IMMUTABLE | §17.7 |
| ATT-03 | Direct SQL DELETE on journal_entry_attachments for POSTED journal | Rejected by database trigger: ATTACHMENT_IMMUTABLE | §17.7 |
| ATT-04 | Add post-submission attachment to POSTED journal | Succeeds with `journal:attach-post-submission` permission; isPostSubmission=true | §17.7 |
| ATT-05 | Add post-submission attachment without required permission | Rejected: FORBIDDEN | §12 |

### 19.8 Double-Entry Integrity Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| DE-01 | Post any event: ∑ JournalLine.debitAmount = ∑ JournalLine.creditAmount | Always true; posting rejected otherwise | ACC-003 |
| DE-02 | Control account targeted by a MANUAL postingOrigin | Rejected by trigger: CONTROL_ACCOUNT_DIRECT_POSTING_PROHIBITED | ACC-011 |
| DE-03 | Four-eyes rule: journal approved by same user who created it | Rejected: SELF_APPROVAL_PROHIBITED | ACC-017 |
| DE-04 | JournalLine.accountVersionId references version not active on accountingDate | Rejected: ACCOUNT_VERSION_NOT_EFFECTIVE_ON_DATE | §17 |
| DE-05 | PostingProfileVersion not active on accountingDate | Rejected: POSTING_PROFILE_VERSION_NOT_FOUND | §3 |

### 19.9 Manual Journal Workflow Tests

| # | Scenario | Expected Outcome | Reference |
|---|---|---|---|
| MJ-01 | Accountant creates journal, submits for CFO approval | Journal status = SUBMITTED; workflow event fired | §17, EVT-JNL-001 |
| MJ-02 | CFO approves, accountant posts | Journal status = POSTED; JournalLines created; period balance updated | EVT-JNL-001 |
| MJ-03 | CFO creates reversal, accountant posts | Original journal status = REVERSED; reversal journal POSTED | EVT-JNL-002 |
| MJ-04 | Replacement journal correctly links to original | replacedByJournalEntryId set; GL shows all three entries | EVT-JNL-003 |
