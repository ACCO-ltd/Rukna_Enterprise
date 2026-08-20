# Domain — Finance & Accounting (Flow C)

The statutory financial source of truth: every financial event becomes a double-entry journal
in the General Ledger. Separate from the Commitment Ledger (see `docs/02-domain-boundaries.md`).

```
Business event → Posting rule → Journal Entry → Journal Lines → GL → TB → P&L / Balance Sheet
```

| Capability | Code | Endpoints | Frontend | Status |
|---|---|---|---|---|
| Chart of Accounts + fiscal calendar | `accounting/accounting-core` | `accounts`, `fiscal-years`, `periods` | `/finance/accounting/chart-of-accounts`, `.../periods` | INTEGRATED |
| Posting engine (∑Dr=∑Cr) | `accounting/accounting-core` | (internal) | — | BACKEND |
| Manual Journals | `accounting/manual-journals` | `journals` | `/finance/accounting/journals` | INTEGRATED |
| Accounts Receivable | `accounting/accounts-receivable` | `invoices`, `customer-receipts` | `/finance/accounting/invoices` | INTEGRATED |
| Accounts Payable | `accounting/accounts-payable` | `bills`, `payments`, `suppliers` | `/finance/accounting/bills`, `.../payments` | INTEGRATED |
| General Ledger (TB, P&L, BS, period mgmt) | `accounting/general-ledger` | `reports`, `periods` | `/finance/accounting/{ledger,trial-balance,profit-loss,balance-sheet}` | INTEGRATED |
| Payment receipts (construction billing) | `finance` | `receipts` | `/receipts` | INTEGRATED |
| Opening balances / migration | `accounting/...` | `accounting/opening-balance` | `/finance/accounting/opening-balance` | INTEGRATED |
| Bank accounts / reconciliation | `finance`, `accounting/...` | `bank-accounts`, `accounting/reconcile` | `/finance/accounting/bank-accounts` | PARTIAL |
| Posting profiles | `accounting/...` | `posting-profiles` | — | BACKEND |
| Project Actual P&L | `accounting/financial-position` | `projects/:id/pl` | `/projects/[id]/pl` | INTEGRATED |
| Project Financial Position | `accounting/financial-position` | `projects/:id/financial-position` | — | BACKEND |

**ADRs:** ADR-006 (native accounting foundation — 22 locked decisions), ADR-008 (governance +
transactional audit outbox), ADR-013 (Project Actual P&L vs Financial Position). Companion:
`docs/reference/accounting-event-catalog.md`.

**Two project financial views (ADR-013):**
- **Actual P&L** (`/projects/:id/pl`) — posted GL only; *excludes* commitments.
- **Financial Position** (`/projects/:id/financial-position`) — actual cost + remaining
  committed cost (COMMITTED + ACCRUED) + forecast cost + forecast margin. Commitments are never
  GL expenses. **Backend built; no UI yet.**

**Accounting date rule:** allocation/reversal postings use the source document's
`accountingDate`, never `new Date()`.

**Partial:** full bank reconciliation and broader tax handling are incomplete.
