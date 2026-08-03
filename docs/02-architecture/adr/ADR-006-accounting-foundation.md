# ADR-006: Sprint 4 — Native Financial Accounting Architecture

Status: DRAFT — pending review by Eng Ahmed Shirie and financial officer
Date: 2026-08-03
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd), Financial Officer

---

## Context

Sprints 1–3 delivered platform infrastructure, construction project management, and client
commercial billing (contracts, IPA, IPC, payment receipts). These cover operational tracking
of what is owed and what has been paid.

They do not constitute full accounting. The following are NOT yet built:

- General Ledger (double-entry posting)
- Chart of Accounts
- Accounts Payable subledger
- Accounts Receivable subledger
- Formal journal entries
- Trial balance
- Financial statements (P&L, Balance Sheet, Cash Flow)
- Period opening and closing
- Tax controls

The CEO requires native accounting built into the platform, not deferred to an external tool.
The financial officer is available to validate accounting requirements.

Sprint 4 must establish the accounting foundation before procurement (Sprint 5) is built,
because every procurement transaction must post correctly into the General Ledger. Building
procurement before the GL exists creates unrecoverable technical debt.

This ADR records the architectural decisions for Sprint 4.

---

## Decisions

### Decision 1 — Accounting Basis

**Rule ACC-001:** The platform uses **accrual accounting**.

Revenue is recognized when earned (IPC certified), not when cash is received.
Expenses are recognized when incurred (goods received, labour worked), not when paid.

Cash-basis reporting may be produced as a secondary view, but the posting engine operates
on accrual rules.

---

### Decision 2 — General Ledger as Financial Source of Truth

**Rule ACC-002:** The General Ledger is the single financial source of truth.

All financial reports (trial balance, P&L, balance sheet) are derived from posted GL entries.
Business modules (construction, procurement, payroll) are operational systems. They must emit
accounting events that post into the GL. They must never store financial totals that bypass
the GL.

---

### Decision 3 — Double-Entry Posting Engine

**Rule ACC-003:** Every posted `JournalEntry` must satisfy:

```
∑ JournalLine.debitAmount = ∑ JournalLine.creditAmount
```

The system must enforce this constraint at post time. A `JournalEntry` that does not balance
must be rejected with a clear error. It may never be posted in an unbalanced state.

---

### Decision 4 — Chart of Accounts Structure

**Rule ACC-004:** Account types follow standard financial accounting:

```
ASSET          — current assets, fixed assets, cash, receivables, inventory
LIABILITY      — current liabilities, payables, accrued liabilities
EQUITY         — share capital, retained earnings
INCOME         — revenue, other income
EXPENSE        — cost of sales, operating expenses
```

Each account has:
- `accountCode` (e.g., `1100`) — organization-defined, immutable after first posting
- `accountName` / `accountNameAr`
- `accountType` (enum above)
- `isControlAccount` — control accounts are posted to only through subledger integration
- `isActive` — inactive accounts cannot receive new postings
- `parentAccountId` — for hierarchical grouping (P&L and balance sheet roll-up)

The chart of accounts is configurable per organization. A default ACCO chart must be
designed with the financial officer before Sprint 4 begins.

---

### Decision 5 — Financial Dimensions

**Rule ACC-005:** Every `JournalLine` may carry financial dimension values for
cross-cutting analysis:

```
dimension_project_id      — links cost/revenue to a construction project
dimension_department_id   — organizational department
dimension_cost_centre_id  — cost centre
```

Dimensions are optional on a line but required when a posting rule mandates them.
Dimensions enable project P&L and department cost reports without separate ledgers.

---

### Decision 6 — Journal Lifecycle and Immutability

**Rule ACC-006:** Journal entry lifecycle:

```
DRAFT → APPROVED → POSTED → REVERSED (if needed)
```

- `POSTED` entries are **immutable**. No field on a posted entry or its lines may change.
- Corrections are made by creating a reversal entry (equal and opposite) followed by a
  corrected replacement entry.
- Soft-delete of posted entries is prohibited.
- Manual deletion of any entry is prohibited.

**Rule ACC-007:** Reversal creates a new `JournalEntry` with all amounts negated, linked
to the original via `reversedEntryId`. The original entry is flagged `isReversed = true`.

---

### Decision 7 — Fiscal Years and Accounting Periods

**Rule ACC-008:**

```
FiscalYear
└── AccountingPeriod (12 periods, one per calendar month by default)
    status: OPEN | LOCKED | CLOSED
```

- `OPEN`: postings allowed.
- `LOCKED`: no new postings; period under review. Can be re-opened by authorized user.
- `CLOSED`: permanently closed. No postings possible. Cannot be re-opened.

Posting to a `CLOSED` or non-existent period is rejected.

**Rule ACC-009:** Period dates must be non-overlapping and contiguous within a fiscal year.
Gap periods are not permitted.

---

### Decision 8 — Multi-Currency Posting

**Rule ACC-010:** Every `JournalLine` carries:

```
amount            Decimal(18,2)    — amount in the transaction currency
currency          VarChar(3)       — ISO 4217 transaction currency
exchangeRate      Decimal(18,6)    — rate to reporting currency at posting date
reportingAmount   Decimal(18,2)    — amount × exchangeRate (reporting currency)
```

The GL trial balance and financial statements use `reportingAmount`. The organization's
reporting currency is defined on the `Organization` record.

Foreign-exchange gains and losses from rate differences between booking and settlement dates
are posted to a designated FX gain/loss account through posting rules (Sprint 9).

---

### Decision 9 — Accounting Events and Posting Rules

**Rule ACC-011:** Business modules emit `AccountingEvent` records. They do not post directly
to the GL.

```
AccountingEvent
  eventType   string    — e.g. IPC_ISSUED, PAYMENT_RECEIVED, GOODS_RECEIVED, INVOICE_MATCHED
  sourceId    string    — ID of the source record (IPC, Receipt, GRN, etc.)
  sourceType  string    — source entity type
  amount      Decimal
  currency    string
  eventDate   Date
  dimensions  JSON      — project, department, cost centre
```

**Rule ACC-012:** A `PostingRule` maps an `eventType` → a set of account assignments:

```
PostingRule
  eventType         string
  debitAccountId    FK → Account
  creditAccountId   FK → Account
  dimensionPolicy   REQUIRED | OPTIONAL | NONE
```

The posting engine reads the rule, resolves accounts, and creates the `JournalEntry` +
`JournalLine` records automatically.

**Rule ACC-013:** An `AccountingEvent` with no matching `PostingRule` is held in a
`PostingException` queue for manual resolution. It must never be silently dropped.

---

### Decision 10 — Subledger Boundaries

**Rule ACC-014:** Accounts Payable (Sprint 5) and Accounts Receivable (Sprint 7) are
subledgers of the General Ledger.

- AP subledger: balances per supplier, reconciled to the AP control account in the GL.
- AR subledger: balances per client, reconciled to the AR control account in the GL.

Control accounts (`isControlAccount = true`) may not receive manual journal postings.
They are posted to exclusively through subledger events.

---

### Decision 11 — Project Subledger-to-GL Reconciliation

**Rule ACC-015:** The `ProjectCostLedger` (Sprint 6) is a subledger. Its total by project
must reconcile to the sum of GL entries carrying that project's financial dimension.

A reconciliation report must be producible at any time showing agreements and variances.

---

### Decision 12 — Opening Balances

**Rule ACC-016:** Before go-live, opening balances are imported as a single manually-approved
`JournalEntry` with one line per account, posted to an "Opening Balance" period.

The sum of opening balance lines must be zero (balanced across asset, liability, equity).
A migration utility will be built in Sprint 9 with validation rules enforced by the financial
officer before any production posting.

---

### Decision 13 — Role Segregation and Approval Controls

**Rule ACC-017:** The following roles govern financial posting. Exact permission names are
defined before Sprint 4 begins.

```
AccountsClerk      — create DRAFT entries
AccountsManager    — approve entries for posting
Controller         — lock/close periods
CFO/CEO            — reverse posted entries, reopen locked periods
Auditor            — read-only access to all posted entries and reports
```

A user may not both create and approve the same entry (four-eyes principle).
Automated posting through `PostingRule` is considered system-approved and does not
require a human approval step, unless a posting rule is flagged `requiresManualApproval = true`.

---

### Decision 14 — What Sprint 4 Does Not Include

The following are explicitly deferred:

- Full VAT / tax filing and returns
- Payroll journal automation
- Fixed assets and depreciation
- Consolidation across legal entities
- Advanced bank reconciliation with auto-matching
- Statutory financial statement templates (IFRS, local GAAP)
- Foreign-exchange revaluation automation

These are Sprint 7–9 items. Sprint 4 establishes the backbone that makes them possible.

---

## Pre-Sprint 4 Requirements from Financial Officer

The following inputs are required from the ACCO financial officer before Sprint 4 coding
begins. See `/docs/02-architecture/roadmap.md` for the full discovery checklist.

Minimum required:

1. Draft chart of accounts (account codes, names, types)
2. Fiscal year dates and period definitions
3. One complete walk-through of: client invoice → receipt → bank
4. One complete walk-through of: supplier invoice → payment
5. Approval limits for journal posting
6. Reporting currency (USD assumed — confirm)

---

## Status

This ADR is in **DRAFT** status. It cannot be marked ACCEPTED until:

- [ ] Reviewed by Eng Ahmed Shirie
- [ ] Reviewed by the Financial Officer
- [ ] Chart of accounts draft received
- [ ] Posting scenario walk-throughs completed

Implementation of Sprint 4 must not begin before this ADR is ACCEPTED.
