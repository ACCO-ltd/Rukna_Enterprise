# ADR-043 — Two workspaces, one ledger: Finance and Construction

**Status:** Accepted (owner: Abdulsalam, decisions by ACCO's owner, 2026-10-03). Phase 0 (this
document + `docs/design/finance-projects-contract.md`) and Phase 1 (portfolio read model, Finance
navigation, Finance → Projects) ship together. Phase 2 ("why blocked", Payables / Payments tabs,
project filters, Procurement Manager payment status) shipped 2026-10-03. Phase 3 (finance commands
leave the construction workspace; money-free stage status) shipped 2026-10-03. Phase 4 (cash-flow
forecast, portfolio and cash-flow exports) shipped 2026-10-03. Phase 5 (tidy-up) follows.

## Context

Rukna is used by two teams with different jobs over the same records:

- **Construction** (Construction Director, Project Managers, Site Engineers, Procurement Manager)
  runs projects: scope, BOQ, programme, progress, verification, purchasing.
- **Finance** (Finance Officer, CFO, CEO) bills, collects, pays and keeps the books.

Today finance work for a project lives inside the project workspace (Commercial tab, Finance tab),
while the company-wide finance work lives in the Accounting module. A finance officer starting the
day has no single place that says which projects need billing, which clients are late and which
supplier bills are due — they open projects one by one. The construction team, meanwhile, sees
finance commands in their workspace that are not theirs to run.

The risk in fixing this is building a second accounting system: a "finance view" of a project with
its own figures, its own billing logic or its own controls would drift from the project's own
screens as soon as one of them changed.

## Decision

Rukna has **two workspaces over one set of records**:

1. **Projects** — the construction team's workspace (unchanged in Phase 1).
2. **Finance** — the finance team's workspace: the existing Accounting module, renamed and
   regrouped, plus **Finance → Projects**, a portfolio of every project with the money questions
   answered.

Rules:

- **A project inside Finance is a filtered view, not a second accounting system.** Every figure on
  it is the figure the project's own screens show, computed by the same code. No new formulas: the
  portfolio read model reuses the repository queries and pure functions behind the Commercial
  Overview (`computeReceivablePosition`, `findPostedReceivablesByProject`), the Finance Overview
  (`buildPosition`, `buildAccountingPosition`), the payment schedule (`isLiveStageInvoice`,
  `scheduleBaseValue`) and the bills list (`supplierBillProjectWhere`). A DB test asserts a
  portfolio row equals the per-project read models for the same project.
- **Every action has one home and calls the same command.** Finance → Projects → Billing renders
  the same billing components and hooks as the project's Commercial tab; there is no duplicated
  billing or payment logic.
- **Controls are unchanged.** Milestones must be verified and marked ready to bill; supplier bills
  pass 3-way match; payments need two signatures; closed periods refuse postings. ACCO bills by
  milestone — no IPC certification, no retention (never shown).

### The owner's five decisions (2026-10-03)

1. **The finance team issues invoices.** Construction verifies milestones and marks them ready to
   bill; Finance prepares and issues the invoice. *Implemented 2026-10-03* (see "Construction marks
   ready" below): the Construction Director marks a stage ready from the project's Commercial
   schedule with the narrow `mark-ready:billing` permission.
2. **The Construction Director is unchanged:** sees cost, not margin, and keeps the read-only money
   summary on the project Overview. (The Finance workspace is gated on `view:financial-position`,
   which the Construction Director deliberately does not hold.)
3. **Receipts can be recorded from either place** — the project workspace or Finance →
   Receivables. Both call the same command.
4. **The Procurement Manager may see the payment status of supplier bills, including amounts** —
   as a record only. Implemented in Phase 2 on the purchase order (`GET
   /procurement/purchase-orders/:id/bill-payments`), gated `view:procurement` +
   `view:commitment-ledger` — permissions the Procurement Manager already holds, so no role-grant
   change. Project Manager and Site Engineer hold no `view:commitment-ledger` and stay blind.
5. **Morning queues:** *To bill* (stages ready to bill whose invoice is not yet issued), *Overdue* (invoices past
   due with a balance), *To pay* (posted supplier bills with a balance).

### Permission

`GET /finance/projects`, the Finance → Projects nav item and its pages require
**`view:financial-position`** — the permission that already opens a project's Finance Overview
(revenue, cost, margin). Finance Officer, CFO, CEO and ADMIN hold it; Construction Director,
Project Manager, Site Engineer and Procurement Manager do not. `view:accounting` alone was rejected:
it would reveal project revenue and margin to anyone who can read the chart of accounts. Margin is
additionally subject to the existing margin rule (`resolveBoqVisibility(...).canViewMargin`), and
the existing project-access rule applies per row.

### Construction marks ready (decision 1, implemented 2026-10-03)

- **Permission `mark-ready:billing`** (domain Commercial, risk MEDIUM). It authorizes exactly two
  routes — `POST` / `DELETE /projects/:projectId/commercial/installments/:installmentId/ready-to-bill`
  — and nothing else; the commands create no invoice and return no amount. The routes require
  `view:contract` AND (`manage:receivable` OR `mark-ready:billing`), so Finance keeps the command.
- **Who holds it:** the Construction Director (role seed) and ADMIN (re-linked to every catalogue
  permission on each deploy). Not the Project Manager or Site Engineer (money-blind, no
  `view:contract`). Not CEO: CEO is a governed approval/oversight role that never held the finance
  set either; granting it is an owner decision.
- **Preconditions — unchanged, and now the prepare command's own rule (`stagePrepareBlock`):** the
  contract is ACTIVE; a work-completion stage is linked to a programme milestone VERIFIED on site
  (CONST-COM-011), an advance needs the contract executed; the stage has no live invoice (a
  cancelled one does not count). The schedule enables the button from the row's
  `billingEligibility.canPrepare` — the same guard — and shows the blocking reason in words.
- **Undo ready** is allowed until Finance prepares the stage (a DRAFT invoice blocks it; a
  cancelled invoice does not). Both acts write their audit event (`MILESTONE_READY_TO_BILL`,
  `MILESTONE_READINESS_REVOKED`); the mark's idempotency key now carries its timestamp, so mark →
  undo → mark again no longer collides on the audit outbox's unique key.
- **Concurrency:** mark ready, undo ready and Finance's prepare each take the stage's row lock
  (`SELECT … FOR UPDATE` on the installment) inside their transaction and re-check there. Mark is a
  conditional update (`readyToBillAt IS NULL`; a lost race is a no-op with no audit event); undo
  re-checks for a live invoice under the lock and answers 409 if Finance prepared meanwhile.
  Prepare always runs the conditional mark under its lock (never trusting its pre-lock read), so
  an undo that committed just before it cannot leave a draft unmarked — out of *To bill*.
- Cash-flow forecast (Phase 4) is unaffected: it forecasts every un-issued stage by its expected
  date (or the day it was marked, if earlier), whether VERIFIED or READY_TO_BILL.
- Marking ready puts the stage in Finance's *To bill* queue (`readyToBillAt`); preparing an invoice
  still records readiness itself when Construction has not (D2).
- **Status follows the mark.** `collectionStatus` gains **`VERIFIED`** ("Verified — awaiting ready
  to bill"): nothing blocks raising the stage (milestone verified / advance due / date reached) but
  Construction has not marked it. **`READY_TO_BILL`** now means marked (`readyToBillAt`) or a draft
  Finance is preparing — the same set Finance's *To bill* queue counts. One rule
  (`stageCollectionStatus`) for the Commercial schedule and Progress → milestones. **No behaviour
  change for Finance:** Finance can still prepare an unmarked (VERIFIED) stage; preparing marks it.
- **Production:** the live tenant gets the grant from a targeted, additive script
  (`prisma/seeds/grant-construction-mark-ready.seed.ts`) — one permission, one role — not by
  re-running the team-role seed, which would re-add grants removed in Admin → Roles.

## Consequences

- One portfolio request answers "what needs finance today" without per-project round trips; the
  read model is batched (a fixed number of queries for the whole portfolio).
- The Accounting sidebar domain is now **Finance**: Get started, Projects, Receivables, Payables,
  Banking, Ledger, Reports, Setup & close. Every existing URL still works; only labels and grouping
  moved.
- Shared billing components take a link builder (`invoiceHref`, ledger `links`) instead of
  hard-coding project routes, so Finance renders them with links into Finance.
- Until Phase 3 the project's own Finance tab and Commercial billing screens stayed in place, so
  the same work was reachable from two places. Phase 3 removed them: each piece of finance work is
  now reachable from Finance only (see Phases below).
- Portfolio totals are given per currency; money is never added across currencies.
- **"Why blocked" has one source of truth (Phase 2).** The guards of the supplier-bill post, the
  supplier-payment create / release / post, the milestone-stage prepare and the ledger's period
  gate are pure policy functions (`billPostingBlock`, `billSettlementBlock`, `paymentPostingBlock`,
  `isReleaseComplete`, `stagePrepareBlock`, `periodPostingBlock`); the commands call them and map a
  result to the exception they always threw, and the eligibility read models are built from the
  same functions. A screen can therefore never say "ready" over a refusal. One deliberate
  tightening: posting a REVERSED bill is now refused (409) — it used to re-flip the bill to POSTED
  against the old journal.
- A receipt, a supplier payment and a manual journal have no project of their own; their project
  membership is derived (receipt → allocations to the project's invoices; payment → allocations to
  the project's bills, header or line; journal → a line coded to the project). An unallocated
  receipt or advance belongs to no project.
- A ready-to-bill stage leaves *To bill* only when its invoice is POSTED (issued); a prepared draft
  shows as "draft prepared" (decision 1: Finance issues invoices).
- **Phase 3:** the Construction Director no longer has the project's read-only Billing view
  (invoice and receipt lists) or the project invoice documents — they showed the CD no money anyway
  (the margin tier gates it). Owner decision 2: the CD keeps the read-only money summary on the
  project Overview and sees each stage's money-free status on the Commercial schedule.

## Phases

1. **Phase 1 (this change):** ADR + contract; `GET /finance/projects` (read-only, no migration);
   Finance navigation; Finance → Projects (portfolio with queues) and the Finance project workspace
   (Overview, Billing, Cost & commitments, P&L) built from existing components.
2. **Phase 2 (shipped 2026-10-03):** "why blocked" eligibility for supplier bills (`GET
   /bills/:id/eligibility`) and payment-schedule stages (`billingEligibility` on every schedule row
   and `GET …/installments/:id/billing-eligibility`); Finance project workspace tabs **Payables**
   (the project's bills + "Why can't I pay this?") and **Payments** (receipts, supplier payments,
   journals filtered to the project); `projectId` filters on receipts, supplier payments and
   journals; Procurement Manager read-only payment status of supplier bills (decision 4). Still
   open: morning queues on the Finance Overview landing and the dashboard.
3. **Phase 3 (shipped 2026-10-03):** remove finance commands from the construction workspace.
   - The project **Finance tab is gone**. `/projects/:id/finance` (→ `/finance/projects/:id`),
     `…/finance/cost-control` (→ `/cost`), `…/finance/profit-loss` and `/projects/:id/pl` (→ `/pl`),
     `…/finance/ledger` (→ `/pl#ledger`), `…/finance/ledger/bills/:billId` (→
     `/finance/accounting/bills/:billId`) are server redirects; a reader without
     `view:financial-position` lands on Finance's no-access state. `/projects/:id/ipc` →
     `/projects/:id/commercial` (ACCO bills by milestone, not IPC); `/projects/:id/contracts` →
     `…/commercial/contract`. One table: `apps/web/src/features/finance-projects/redirects.ts`.
   - The project **Commercial tab** keeps the contract (record / view / reopen), the payment schedule
     (milestone links, re-profile; verification stays in Progress → Review) and variations. Its
     **Billing view is removed** — prepare / issue invoice, send (WhatsApp), record payment, reminder
     now live only in Finance → Projects → Billing; `/commercial/billing(-collection)` redirect
     there. A finance reader sees **Open in Finance** on the schedule.
   - The **project invoice page** (issue, send, record payment, credit note, collection notes, edit /
     delete draft) moves to `/finance/projects/:id/billing/invoices/:invoiceId`, and Finance's
     Billing tab opens invoices there (it carries commands the accounting invoice page does not).
     The old `/projects/:id/commercial/invoices/:id` sends a finance reader there and anyone else to
     the Commercial schedule (client-side: the session lives in the browser). Chosen over a
     read-only project invoice view because a Construction Director already sees no invoice money
     (`financialsVisible` is the margin tier), so the schedule's status says all they could see.
   - **Money-free status.** Every schedule row and every Progress milestone release line carries
     `collectionStatus` — `NOT_READY` · `READY_TO_BILL` · `BILLED` · `PART_PAID` · `PAID` ·
     `OVERDUE` — from one pure rule, `stageCollectionStatus` (`deriveInvoiceState`, the schedule's
     paid rule on the posted invoice's `outstandingAmount`, the one overdue rule `overdueDays`, and
     the raise blocker `installmentBillingBlocker`; a draft Finance is preparing reads Ready to
     bill). A status is not money: it is returned whatever the caller's money visibility, while
     `amount` / `amountPaid` / `percentage` stay redacted. Project Managers and Site Engineers see
     it on Progress → milestones (they hold no `view:contract`); the Construction Director sees it
     on the Commercial schedule. No server permission was changed.
   - The project **Overview is unchanged** — the Construction Director keeps the read-only money
     summary (decision 2).
   - ~~Not done: no screen calls the mark-ready-to-bill command.~~ Done 2026-10-03 — see
     "Construction marks ready (decision 1)": the Commercial schedule offers **Mark ready to bill**
     / **Undo ready** to `mark-ready:billing` (Construction Director) and to the finance set.
   - Billing links outside Finance (Progress performance, variation detail, the BOQ "Review in
     billing" toast, project activity) go to Finance for a finance reader and to the Commercial
     schedule otherwise (`useProjectBillingHref`) — never to Finance's no-access page. Redirects keep
     the old URL's query string.
4. **Phase 4 (shipped 2026-10-03):** cash-flow forecast and exports. Read-only, no migration.
   - `GET /finance/cashflow?projectId&from&to&bucket=WEEK|MONTH` — per currency, per bucket:
     inflows (posted invoices' outstanding by due date; payment-schedule stages not yet invoiced),
     outflows (posted supplier bills' outstanding by due date; open purchase-order commitments),
     net and cumulative net, plus a plain-words `basis` per line and the `exclusions`. Same gate
     (`view:financial-position`), organisation scoping and project-access rule as the portfolio.
   - **No second formula.** Invoice inflows are `findPostedReceivablesByProject` (= the portfolio's
     `outstanding`); bill outflows are `findBillsToPay`, now the one query behind the portfolio's
     `billsToPay` too; stage amounts are `scheduleBaseValue` × percentage, a stage is unbilled by
     `deriveInvoiceState`; open commitments are the commitment ledger folded by `addStage`
     (committed + accrued = committed-to-date − actual). A DB test asserts the totals reconcile.
   - **Opening balances** (OPENING_BALANCE client invoices and supplier bills imported at go-live,
     e.g. from QuickBooks) are their own lines, *Opening balances — receivable / payable*, by due
     date (overdue → *Overdue / now*), same outstanding definition. Company-wide: all of them the
     caller may see (a caller limited to their projects sees only those coded to them); one
     project: only those coded to it. The portfolio and its POSTED-only helpers are unchanged, so
     forecast invoices + opening receivables = portfolio outstanding + opening-balance outstanding
     (bills likewise) — asserted by the DB test.
   - A range with `to` before `from`, or longer than 104 periods (weeks or months), is a 400 —
     never silently changed.
   - **Dates are never guessed.** Stage bill date = the schedule's `deriveExpectedDate` (milestone
     forecast → baseline; a dated stage's date), or `readyToBillAt` if earlier, moved up to today
     (an invoice is dated the day it is issued); expected receipt = bill date + the contract's
     payment terms through `resolveInvoiceDates` (the prepare/issue default; no number → due on
     receipt). `Client.paymentTermsDays` is not used: the issue path does not use it either. An
     open order pays at its current revision's expected delivery date + `Supplier.paymentTermsDays`
     (the supplier bill's due-date default); either missing → *Undated*. Past-due items sit in the
     first *Overdue / now* bucket; items after the range in *Later*.
   - Web: **Finance → Reports → Cash flow** (`/finance/cashflow`, portfolio) and a **Cash flow** tab
     in the Finance project workspace — chart (hand-rolled SVG, as the cost charts; no chart
     library), table, weekly/monthly switch, currency switch, assumptions. Under Reports, not
     Projects: it is a forward-looking statement across receivables and payables, read beside P&L;
     Projects is the per-project worklist.
   - **Exports** (client-side, from the rows on screen, as the accounting reports): the
     `/finance/projects` list (current queue, screen columns, one totals line per currency) and the
     cash-flow table, each as CSV (`exportCsv`) and Excel (`downloadXlsx`, a dependency-free XLSX
     writer in `apps/web/src/lib/xlsx-export.ts`; one sheet per currency for cash flow). The shared
     CSV writer now neutralises formula injection (a text cell starting `=`, `+`, `-`, `@`, tab or
     CR gets a leading quote; numbers and plain decimal strings are untouched) — every accounting
     report export benefits. XLSX text is written as inline strings, never formulas, so it needs
     no prefix.
5. **Phase 5:** tidy-up — retire the redirect routes once bookmarks have aged out, role-seed
   review, and a rename-proof permission check for the role names project access still matches on.

## Amendment — 2026-10-10: the Finance project workspace is a dashboard with three tabs

**Status:** Accepted (owner: Abdulsalam, 2026-10-10). Phase 5 tidy-up, after a Finance → Projects
audit found the project workspace hard to read: seven overlapping tabs (Overview, Billing, Cost &
commitments, P&L, Payables, Payments, Cash flow), an Overview that repeated two tabs and left out
billed / collected / owed, and no way to change project without going back to the list.

**Decision.**

- **Three tabs: Overview · Billing · Transactions.**
  - **Overview** is a dashboard (`FinanceProjectDashboard`): a "Figures reconciled" badge over the
    five controls, five key figures, one **Needs action** list (the Billing tab's own To do —
    `BillingTodoCard`, the same rows and commands — plus bills to pay and controls that ask for
    work), billing progress per payment stage, cash flow, cost against budget, recent activity.
  - **Billing** is unchanged (the only home of the invoice commands, Phase 3).
  - **Transactions** is one page with a view switcher in the URL (`?view=`): Supplier bills ·
    Supplier payments · Client receipts · Journals · Ledger · P&L. Each list keeps its own API gate
    (`manage:payable`, `manage:receivable`, `manage:journal`); Ledger and P&L ride on the
    workspace's `view:financial-position`. The default is the first view the reader may open.
- **Cost detail** (`/cost`) and the **cash-flow forecast** (`/cashflow`) are **drill-ins** from the
  Overview's cards, not tabs: they lead back to Overview, and Overview stays the current tab.
- **The header is a project picker** (`FinanceProjectPicker`): switching project keeps the view; the
  portfolio is read only when the picker opens.
- **Billed is shown before tax** everywhere in Finance (`billedExclTax`: invoice subtotals − credit
  note net amounts — each document's own tax, never an assumed rate); Outstanding stays
  tax-inclusive (what the client owes).

**Unchanged.** No permission, endpoint or formula changed: every figure is an existing read, every
command keeps its one home. Retired URLs redirect — `/finance/projects/:id/payables` →
`transactions?view=bills`, `/payments` → `?view=receipts`, `/pl` → `?view=pl`; the older
`/projects/:id/finance/profit-loss`, `/projects/:id/pl` → `?view=pl` and `…/finance/ledger` →
`?view=ledger` (`redirects.ts` is still the one table).
