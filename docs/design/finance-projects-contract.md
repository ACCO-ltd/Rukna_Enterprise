# Finance → Projects — API contract and screen map (ADR-043)

Phase 1 of [ADR-043](../adr/ADR-043-finance-and-construction-workspaces.md). Read-only; no
migration.

## API

### `GET /api/v1/finance/projects`

**Gate:** `view:financial-position` (403 otherwise). Organisation-scoped through the tenant client
and `organizationId`; rows limited by the project-access rule (`ProjectAccessService.accessibleProjectIds`:
bypass roles see every project, others only projects they are a member of).

**Query** (all optional, validated):

| Param    | Values                                                                   |
| -------- | ------------------------------------------------------------------------ |
| `queue`  | `TO_BILL` · `OVERDUE` · `TO_PAY` (400 for anything else)                 |
| `search` | text, ≤100 chars — matches project code, name or client name (case-insensitive) |
| `status` | a `ProjectStatus` (`DRAFT`, `ACTIVE`, `PRACTICAL_COMPLETION`, `CLOSEOUT`, `CLOSED`, `CANCELLED`) |

**Response** — `FinancePortfolioResponse` (`packages/types/src/finance-portfolio.ts`):

```ts
{
  items: Array<{
    projectId, code, name, clientName: string | null, status, currency: string | null,
    contractValue, billed, collected, outstanding, overdue, costToDate, committedCost: string | null,
    margin: number | null,                       // percent, one decimal
    readyToBill: { count: number; amount: string | null },
    overdueInvoices: { count: number; oldestDaysPastDue: number | null },
    billsToPay: { count: number; amount: string | null },
  }>,
  totals: { currency, mixedCurrencies, contractValue, billed, collected, outstanding, overdue,
            costToDate, committedCost, readyToBill, overdueInvoices: { count }, billsToPay },
  queueCounts: { ALL, TO_BILL, OVERDUE, TO_PAY },  // over the search/status-filtered set
  moneyVisible: boolean,
  marginVisible: boolean,
  asOf: string,                                  // server clock used for "overdue"
}
```

Money is a decimal string, or `null` when hidden. Counts are always present.

### Field definitions — each is an existing definition, not a new one

| Field | Same as | Shared code |
| --- | --- | --- |
| `billed` | Commercial Overview `financialPosition.netBilled` (Σ POSTED invoice totals − Σ POSTED credit notes) | `findPostedReceivablesByProject` + `computeReceivablePosition` |
| `collected` | `financialPosition.collected` (Σ POSTED receipt allocations) | same |
| `outstanding` | `financialPosition.outstanding` (Σ invoice `outstandingAmount`) | same |
| `overdue` | `financialPosition.overdue` (outstanding of invoices whole UTC days past due > 0) | same (`daysPastDue`, D5) |
| `overdueInvoices` | count of those invoices; oldest days past due | `computeReceivablePosition` |
| `contractValue` | Commercial Overview `contract.currentContractValue` of the live client contract | `mainContractWhere` |
| `costToDate` | Finance Overview `costPosition.actual` (commitment-ledger ACTUAL) | `groupByProjectAndStage` + `addStage` + `buildPosition` |
| `committedCost` | Finance Overview `costPosition.committedToDate` (COMMITTED + ACCRUED + ACTUAL) | same |
| `margin` | Finance Overview `accountingPosition.marginPercent` ((GL revenue − GL project cost) / GL revenue; null while the ledger cannot post or with no revenue) | `sumPostedRevenueByProject`, `sumProjectCostByProject`, `buildAccountingPosition` |
| `readyToBill` | payment-schedule stages with `readyToBillAt` set and no live invoice; amount = base contract value × stage % | `isLiveStageInvoice`, `scheduleBaseValue` |
| `billsToPay` | POSTED supplier bills with `outstandingAmount > 0` belonging to the project (header or any line, as the bills list) | `supplierBillProjectWhere` |

**Queues:** `TO_BILL` ⇔ `readyToBill.count > 0`; `OVERDUE` ⇔ `overdueInvoices.count > 0`;
`TO_PAY` ⇔ `billsToPay.count > 0`.

**Totals** sum the returned rows; a supplier bill coded to two projects is counted once.

**Redaction:** receivable money follows the Commercial Overview's gate (`canViewMargin`), cost
follows the Finance Overview's (`view:financial-position`); `moneyVisible` is both. `margin` needs
the margin rule (`resolveBoqVisibility(...).canViewMargin`) and `view:financial-position`.

**Performance:** a fixed number of queries for the whole portfolio — projects, contracts, posted
invoices (+ credit-note and allocation group-bys), commitment-ledger group-by, revenue and cost
group-bys, readiness, supplier bills, ready installments. No per-project loop.

## Screens

### Sidebar — Finance (was Accounting)

Same routes, new labels and grouping: **Overview** (`/finance/accounting/guide`) · **Projects**
(`/finance/projects`, gated `view:financial-position`) · **Receivables** (Client invoices,
Receipts) · **Payables** (Supplier bills, Supplier payments) · **Banking** (Bank accounts,
Reconciliation) · **Ledger** (Journals, Chart of accounts, Account ledger) · **Reports** (Trial
balance, Balance sheet, Profit & Loss, Monthly comparison) · **Setup & close** (Posting profiles,
Tax, Opening balance, Fiscal periods).

### `/finance/projects` — portfolio

- Totals bar: project count, contract value, billed, collected, outstanding, overdue, bills to pay
  (mixed-currency note when relevant).
- Queue switch: All · To bill · Overdue · To pay, each with its count; the choice is in the URL
  (`?queue=`).
- Table (`PlatformDataGrid`, search, sort, pagination): Project (name, code, status) · Client ·
  Contract · Billed · Collected · Outstanding · Overdue · Cost · Margin · Needs action (state pills:
  "N overdue · Xd", "N stages to bill", "N bills to pay").
- Row → `/finance/projects/:id`.
- No access → a lock empty state; the API is not called.

### `/finance/projects/:id` — project inside Finance

Header: project name · code, status, client, contract value, currency, **Open project** (→
`/projects/:id`). Tabs:

| Tab | Route | Renders (existing component) |
| --- | --- | --- |
| Overview | `/finance/projects/:id` | `FinanceOverviewView` (cost-control link → the Finance Cost tab) |
| Billing | `/billing` | `PaymentSchedulePanel` + `CommercialBillingView` — milestones with verified / ready-to-bill state, To do, prepare/issue invoice, send on WhatsApp, record payment, reminder, invoices, payments; invoice links → `/finance/accounting/invoices/:id` |
| Cost & commitments | `/cost` | `CostControlView` |
| P&L | `/pl` | `ProfitLossView` + `LedgerView` (sources → accounting bill / invoice pages) |

A project outside the caller's portfolio reads as "Project not found".

## Not in Phase 1

Browser QA; Finance Overview queues on the landing page (Phase 2); Procurement Manager payment
status (Phase 2); removing finance commands from the construction workspace (Phase 3).
