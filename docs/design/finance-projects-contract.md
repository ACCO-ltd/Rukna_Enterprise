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
    readyToBill: { count: number; draftCount: number; amount: string | null },
    overdueInvoices: { count: number; oldestDaysPastDue: number | null },
    billsToPay: { count: number; amount: string | null },
  }>,
  totals: Array<{ currency, projectCount, contractValue, billed, collected, outstanding, overdue,
            costToDate, committedCost, readyToBill, overdueInvoices: { count }, billsToPay }>,
                                                 // one entry per currency — never summed across currencies
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
| `readyToBill` | payment-schedule stages with `readyToBillAt` set whose invoice the schedule does not read as ISSUED (`deriveInvoiceState`: POSTED / REVERSED / OPENING_BALANCE = billed). `draftCount` = stages whose invoice is DRAFT (not yet posted: NOT_POSTED / PENDING / FAILED) = "draft prepared"; no invoice or a cancelled one = "not prepared" (Finance issues invoices, decision 1); amount = base contract value × stage % | `deriveInvoiceState`, `scheduleBaseValue` |
| `billsToPay` | POSTED supplier bills with `outstandingAmount > 0` belonging to the project (header or any line, as the bills list) | `supplierBillProjectWhere` |

**Note (bills to pay, multi-project bills):** a bill coded to several projects per line counts on
each of those rows with its **whole** outstanding balance — the same header-or-line rule the bills
list uses (`GET /bills?projectId`), deliberately kept so the row matches what the bills list shows.
The outstanding is not split per line. Totals count such a bill once.

**Queues:** `TO_BILL` ⇔ `readyToBill.count > 0`; `OVERDUE` ⇔ `overdueInvoices.count > 0`;
`TO_PAY` ⇔ `billsToPay.count > 0`.

**Totals** sum the returned rows **per currency** (one entry per currency, ordered by code, no
currency last); money is never added across currencies. A supplier bill coded to two projects is
counted once.

### `GET /api/v1/finance/projects/:projectId`

Same gate and scoping; one project's row: `{ item, moneyVisible, marginVisible, asOf }`
(`FinancePortfolioProjectResponse`). 404 outside the organisation, 403 for a non-member. Used by
the Finance workspace header, so it never loads the whole portfolio.

**Redaction:** receivable money follows the Commercial Overview's gate (`canViewMargin`), cost
follows the Finance Overview's (`view:financial-position`); `moneyVisible` is both. `margin` needs
the margin rule (`resolveBoqVisibility(...).canViewMargin`) and `view:financial-position`.

**Performance:** a fixed number of queries for the whole portfolio — projects, contracts, posted
invoices (+ credit-note and allocation group-bys), commitment-ledger group-by, revenue and cost
group-bys, readiness, supplier bills, ready installments. No per-project loop.

## Screens

### Sidebar — Finance (was Accounting)

Same routes, new labels and grouping: **Get started** (`/finance/accounting/guide`; a company-wide
Finance overview does not exist yet) · **Projects**
(`/finance/projects`, gated `view:financial-position`) · **Receivables** (Client invoices,
Receipts) · **Payables** (Supplier bills, Supplier payments) · **Banking** (Bank accounts,
Reconciliation) · **Ledger** (Journals, Chart of accounts, Account ledger) · **Reports** (Trial
balance, Balance sheet, Profit & Loss, Monthly comparison) · **Setup & close** (Posting profiles,
Tax, Opening balance, Fiscal periods).

### `/finance/projects` — portfolio

- Totals: one line per currency — project count, contract value, billed, collected, outstanding,
  overdue, bills to pay.
- Queue switch: All · To bill · Overdue · To pay, each with its count; the choice is in the URL
  (`?queue=`).
- Table (`PlatformDataGrid`, search, sort, pagination): Project (name, code, status) · Client ·
  Contract · Billed · Collected · Outstanding · Overdue · Cost · Margin · Needs action (state pills:
  "N overdue · Xd", "N stages not prepared", "N drafts prepared", "N bills to pay").
- Row → `/finance/projects/:id`.
- No access → a lock empty state; the API is not called.

### `/finance/projects/:id` — project inside Finance

Header (from `GET /finance/projects/:id`): project name · code, status, client, contract value,
currency, **Open project** (→ `/projects/:id`). Tabs:

| Tab | Route | Renders (existing component) |
| --- | --- | --- |
| Overview | `/finance/projects/:id` | `FinanceOverviewView` (cost-control link → the Finance Cost tab) |
| Billing | `/billing` | `PaymentSchedulePanel mode="finance"` + `CommercialBillingView` — milestones with verified / ready-to-bill state, To do, prepare/issue invoice, send on WhatsApp, record payment, reminder, invoices, payments; invoice links → `/finance/projects/:id/billing/invoices/:invoiceId` (Phase 3; was the accounting invoice page) |
| Invoice | `/billing/invoices/:invoiceId` | `ProjectInvoicePage` (Phase 3) — issue, send, record payment, credit note, collection notes, edit / delete draft; back → Billing |
| Cost & commitments | `/cost` | `CostControlView` |
| P&L | `/pl` | `ProfitLossView` + `LedgerView` (sources → accounting bill / invoice pages) |

A project outside the caller's portfolio reads as "Project not found".

## Phase 2 — eligibility, project filters, procurement payment status

Types: `packages/types/src/finance-eligibility.ts`. No migration.

### Eligibility ("why blocked") — semantics

Every step is a rule a command enforces; nothing is a new control. A step is `DONE`, `PENDING`
(waiting on its owner), `BLOCKED` (refused until something changes) or `NOT_APPLICABLE`. Each step
names an `owner` (`FINANCE`, `APPROVER`, `PROCUREMENT`, `SIGNATORIES`, `CONSTRUCTION`), a machine
`code` while not done, and an optional server `detail` (period name, "1 of 2 signatures", posting
error). The web words codes; it never re-derives a status.

#### `GET /api/v1/bills/:id/eligibility` → `SupplierBillEligibility`

Gate `manage:payable` (the bill's own gate); org-scoped (404 outside the organisation).

| Step | Owner | Rule (code) | Enforced by |
| --- | --- | --- | --- |
| `SUBMITTED` | Finance | DRAFT → PENDING `BILL_NOT_SUBMITTED` (detail: return reason); REJECTED / CANCELLED → BLOCKED | submit / post |
| `MATCHED` | Procurement | PO-backed bills only (else N/A): NOT_RUN → PENDING `MATCH_NOT_RUN`; EXCEPTION → BLOCKED `MATCH_EXCEPTION`; DISPUTED → BLOCKED `MATCH_DISPUTED`; MATCHED / MATCHED_WITH_TOLERANCE / APPROVED_EXCEPTION → DONE | `billPostingBlock` (post) |
| `APPROVED` | Approver | not APPROVED → PENDING `BILL_AWAITING_APPROVAL` / `BILL_NOT_SUBMITTED` | `billPostingBlock` |
| `PERIOD_OPEN` | Finance | period covering the bill date, AP category: `NO_PERIOD` / `PERIOD_CLOSED` / `PERIOD_LOCKED` → BLOCKED | `periodPostingBlock` (ledger `PeriodValidator`) |
| `POSTED` | Finance | FAILED → PENDING `POSTING_FAILED` (retryable); REVERSED → BLOCKED `BILL_REVERSED`; OPENING_BALANCE → DONE (already in the ledger via the opening-balance journal; the post command refuses it with 409 `OPENING_BALANCE_BILL`) | `billPostingBlock` |
| `PAYMENT_APPROVED` | Approver | a draft payment holds part of the balance → PENDING `PAYMENT_AWAITING_APPROVAL`; nothing recorded → PENDING `NO_PAYMENT_RECORDED` (owner Finance); part paid with nothing in flight → PENDING `PARTLY_PAID` | payment approve |
| `PAYMENT_RELEASED` | Signatories | under bank-signatory dual control only (else N/A): PENDING `PAYMENT_AWAITING_RELEASE`, detail "n of 2 signatures" | `paymentPostingBlock`, `isReleaseComplete` |
| `PAID` | Finance | payments in flight → PENDING `PAYMENT_NOT_POSTED`; no balance and nothing in flight → DONE | payment post |

`canPost` ⇔ `billPostingBlock` and `periodPostingBlock` are both null. `canPay` ⇔
`billSettlementBlock` is null (POSTED, uncovered balance > 0 — the payment-create rule).
`blockedReason` is the reason the bill's next action is refused: while unposted, the post block
(or the period block); once posted and not payable, the first pending payment step's code, or
`FULLY_PAID`. An **opening-balance bill** (imported, `postingStatus OPENING_BALANCE`) reads
`OPENING_BALANCE_NOT_PAYABLE` on the three payment steps and as `blockedReason`: the payment
command accepts only POSTED bills, so it cannot be paid in Rukna yet — a follow-up for the
owner, not changed here. "In flight" = an allocation not yet posted whose payment is neither
rejected/cancelled nor posted/reversed. Note `outstandingAmount` already excludes draft payments
(it is decremented when a payment is created).

#### Milestone stage — `billingEligibility` on every payment-schedule row, and `GET /api/v1/projects/:projectId/commercial/installments/:installmentId/billing-eligibility` → `StageBillingEligibility`

Gate `view:contract` + project membership (as the commercial workspace read).

| Step | Owner | Rule (code) |
| --- | --- | --- |
| `CONTRACT_ACTIVE` | Construction | contract not ACTIVE → BLOCKED `CONTRACT_NOT_ACTIVE` |
| `MILESTONE_LINKED` / `MILESTONE_VERIFIED` | Construction | MILESTONE stages only (else N/A): `MILESTONE_NOT_LINKED` / `MILESTONE_NOT_VERIFIED` (CONST-COM-011) |
| `READY_TO_BILL` | Construction | not marked → PENDING `NOT_READY` — informative, **not** a gate: preparing records it (D2) |
| `INVOICE_PREPARED` | Finance | no live invoice → PENDING `NOT_PREPARED` |
| `PERIOD_OPEN` | Finance | period covering the date an issue would post at (the draft's date moved up to today; today when not prepared), AR category |
| `INVOICE_ISSUED` | Finance | `deriveInvoiceState` ≠ ISSUED → PENDING `NOT_ISSUED` |

`canPrepare` ⇔ `stagePrepareBlock` is null (the prepare command's own guard: contract ACTIVE →
`installmentBillingBlocker(at:'raise')` → no live invoice). `canIssue` ⇔ a DRAFT invoice,
`installmentBillingBlocker(at:'post')` null and the period open — the rules the issue path posts
under (`ClientInvoiceService.post`, `PeriodValidator`). `blockedReason`: `STAGE_ISSUED` once billed;
the issue block for a draft; the prepare block otherwise (or the period block when nothing else
stops preparing).

### Project filters (`projectId`, optional)

Each filter checks project access first (`ProjectAccessService.assertMember`: 404 outside the
organisation, 403 for a non-member without a bypass role); the list's own permission is unchanged.

| Endpoint | Gate | Membership rule |
| --- | --- | --- |
| `GET /api/v1/customer-receipts?projectId` | `manage:receivable` | any allocation (any posting state) to a client invoice of the project (`paymentReceiptProjectWhere`). Unallocated receipts belong to no project; a split receipt appears under each project. |
| `GET /api/v1/payments?projectId` | `manage:payable` | any allocation to a supplier bill of the project by the bills list's header-or-line rule (`supplierPaymentProjectWhere` → `supplierBillProjectWhere`). Unallocated advances and pre-bill PO funding belong to none. |
| `GET /api/v1/journals?projectId` | `manage:journal` | any journal line coded to the project. |
| `GET /api/v1/bills?projectId` | `manage:payable` | unchanged (header or any line). |

### `GET /api/v1/procurement/purchase-orders/:id/bill-payments` → `PurchaseOrderBillPaymentsResponse`

Gate `view:procurement` **and** `view:commitment-ledger` (decision 4), plus project access to every
project the PO's lines are coded to. Holders: Procurement Manager,
Construction Director, Finance Officer, CFO/CEO/ADMIN — all org-wide roles. Project Manager and
Site Engineer lack `view:commitment-ledger` and get 403. Per bill of the PO: total, paid (Σ POSTED
allocations), pending (Σ not-yet-posted allocations), outstanding (the bill's stored balance),
last payment date, status (`NOT_POSTED`, `UNPAID`, `PAYMENT_IN_PROGRESS`, `PARTIALLY_PAID`, `PAID`,
`REVERSED`) — `summarizeBillPayments` / `billPaymentState`, the same rule as the bill page's
payments panel. Read-only; no payment command is reachable from procurement.

### PO settlement (money) and receiving (no money) — review M2

`GET /api/v1/procurement/purchase-orders/:id/settlement` (funding, bill totals / settled /
outstanding, advances, evidence) carried money behind `view:procurement` alone, which Project
Managers hold. It now needs `view:procurement` + `view:commitment-ledger` and project access to
every project the PO is coded to (`SettlementQueryService.assertCanRead`; the internal auto-close
path is unchanged). The money-free receiving position moved to
`GET /api/v1/procurement/purchase-orders/:id/receiving` (`view:procurement`; access to ANY project on
the PO, so a site team on one project of a multi-project PO keeps receiving; an org-level PO with
no project lines needs no membership),
which the PO Receiving tab reads; the Funding and Settlement tabs are not offered without both
permissions.

### Follow-ups (not in this change)

- **Indexes (L1):** the project filters join through `client_receipt_allocations → client_invoices.project_id`,
  `supplier_payment_allocations → supplier_bills.project_id / supplier_bill_lines.project_id` and
  `journal_lines.project_id`. No migration now; add `project_id` indexes on those tables if the
  filtered lists slow down.
- **Paying opening-balance supplier bills** in Rukna (today only POSTED bills are payable).

### Screens (Phase 2)

| Where | What |
| --- | --- |
| `/finance/projects/:id/payables` (needs `manage:payable`) | the bills list filtered to the project (match, approval, posted, outstanding); rows open the accounting bill page, where the existing actions live |
| bill detail | "Why can't I pay this?" — the eligibility steps with owners |
| `/finance/projects/:id/payments` | receipts, supplier payments and journals of the project, each behind its list's permission |
| Billing tab / Commercial payment schedule | a blocked stage shows its reason and owner, with the steps folded |
| receipts / supplier payments / journals lists | a project filter (`?projectId=`) |
| purchase order detail | "Supplier bills & payments" (needs both gates above) |

## Not in Phase 1

Browser QA; Finance Overview queues on the landing page (Phase 2); Procurement Manager payment
status (Phase 2); removing finance commands from the construction workspace (Phase 3).

## Phase 3 — the construction workspace without finance commands

No migration; no permission changed.

### Money-free stage status — `collectionStatus: StageCollectionStatus`

On every `CommercialPaymentScheduleInstallment` (`GET …/commercial/current-cycle`, gate
`view:contract`) and every `MilestoneReleaseLine` (`GET …/programme/milestones`, the Progress
gate). Present for every caller; the money fields beside it stay null for a caller who may not
see them.

| Value | Rule (`stageCollectionStatus`, `commercial/domain/stage-collection-status.policy.ts`) |
| --- | --- |
| `NOT_READY` | no live invoice and the raise blocker (`installmentBillingBlocker`) stands, or a date stage before its date (unless marked ready) |
| `READY_TO_BILL` | no live invoice and nothing blocks raising it; or marked ready; or a DRAFT invoice (`deriveInvoiceState`) Finance is preparing |
| `BILLED` | invoice ISSUED and nothing collected (or not POSTED: reversed / opening balance) |
| `PART_PAID` | POSTED, 0 < balance < total, not overdue |
| `PAID` | POSTED, balance ≤ 0 |
| `OVERDUE` | POSTED, balance > 0, `overdueDays(…, asOf) > 0` — the one overdue rule (D5); wins over part paid |

Balance is the invoice's stored `outstandingAmount` — the same fact the schedule's
`PAID / PARTIALLY_PAID` status reads.

### Redirects

| Old route | New route |
| --- | --- |
| `/projects/:id/finance` | `/finance/projects/:id` |
| `/projects/:id/finance/cost-control` | `/finance/projects/:id/cost` |
| `/projects/:id/finance/profit-loss`, `/projects/:id/pl` | `/finance/projects/:id/pl` |
| `/projects/:id/finance/ledger` | `/finance/projects/:id/pl#ledger` |
| `/projects/:id/finance/ledger/bills/:billId` | `/finance/accounting/bills/:billId` |
| `/projects/:id/commercial/billing`, `…/billing-collection` | `/finance/projects/:id/billing` |
| `/projects/:id/commercial/invoices/:invoiceId` | finance reader → `/finance/projects/:id/billing/invoices/:invoiceId`; others → `/projects/:id/commercial/contract` (client redirect) |
| `/projects/:id/ipc` | `/projects/:id/commercial` |
| `/projects/:id/contracts` | `/projects/:id/commercial/contract` |

Server redirects (`redirect()` in the page) except the invoice route, which needs the browser
session's permission. A reader without `view:financial-position` reaching a Finance URL sees
Finance's no-access state. The Finance overview's ledger / cost-control links and the overdue
invoice notification now link to Finance directly.

### Screens

| Where | Change |
| --- | --- |
| Project tabs | Finance tab removed (Overview · BOQ · Progress · Commercial · Procurement · Documents · Team) |
| Commercial | Billing view removed; lands on Contract; the view switch shows only for a measured (IPC) contract |
| Commercial → payment schedule | status column = money-free status; "Open in Finance" and invoice links only for `view:financial-position` |
| Progress → milestones | each release line shows the money-free status (was an "invoiced" tag) |
| Project Overview | unchanged (Construction Director's read-only money summary, decision 2) |

## Construction marks ready (ADR-043 decision 1, 2026-10-03)

No migration. New permission **`mark-ready:billing`** (Construction Director; ADMIN via the deploy
refresh). Production grant: `docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps
migrate pnpm exec tsx prisma/seeds/grant-construction-mark-ready.seed.ts` (targeted, idempotent,
touches only that permission on that role).

### `POST /api/v1/projects/:projectId/commercial/installments/:installmentId/ready-to-bill`

Body `{ note?: string }` → `InstallmentReadinessResult` `{ installmentId, readyToBill: true,
readyToBillAt }` (no money). Gate: `view:contract` AND (`manage:receivable` OR
`mark-ready:billing`), plus project access. 404 when the stage is not on `:projectId`. Refused
(400, coded `code` / `errorCode`) by `stagePrepareBlock`: `CONTRACT_NOT_ACTIVE`,
`MILESTONE_NOT_LINKED`, `MILESTONE_NOT_VERIFIED`, `STAGE_ALREADY_INVOICED` (a live — non-cancelled —
invoice). Already ready → 200, no-op, no second audit event.

### `DELETE …/installments/:installmentId/ready-to-bill`

Body `{ reason?: string }` → `{ installmentId, readyToBill: false, readyToBillAt: null }`. Same
gate. Refused: `NOT_READY` (not marked), `STAGE_ALREADY_INVOICED` (a DRAFT or issued invoice; a
cancelled one does not block).

### Screen

| Where | Change |
| --- | --- |
| Commercial → payment schedule (`mode="project"`) | per row, while the stage has no invoice: **Mark ready to bill** (enabled by `billingEligibility.canPrepare`; disabled with the blocking reason in words) or **Undo ready** once marked. Shown to `view:contract` + (`mark-ready:billing` or `manage:receivable`). Success toast; refreshes the project's commercial reads and the Finance portfolio (*To bill*). Not shown in Finance's own schedule, where preparing records readiness. |

Note: `collectionStatus` already reads *Ready to bill* for a verified stage that nobody has marked
(Phase 3 rule); Finance's *To bill* queue counts only marked (`readyToBillAt`) or prepared stages.
