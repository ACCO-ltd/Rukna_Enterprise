# ADR-043 — Two workspaces, one ledger: Finance and Construction

**Status:** Accepted (owner: Abdulsalam, decisions by ACCO's owner, 2026-10-03). Phase 0 (this
document + `docs/design/finance-projects-contract.md`) and Phase 1 (portfolio read model, Finance
navigation, Finance → Projects) ship together. Phase 2 ("why blocked", Payables / Payments tabs,
project filters, Procurement Manager payment status) shipped 2026-10-03. Phases 3–4 follow.

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
   bill; Finance prepares and issues the invoice.
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

## Consequences

- One portfolio request answers "what needs finance today" without per-project round trips; the
  read model is batched (a fixed number of queries for the whole portfolio).
- The Accounting sidebar domain is now **Finance**: Get started, Projects, Receivables, Payables,
  Banking, Ledger, Reports, Setup & close. Every existing URL still works; only labels and grouping
  moved.
- Shared billing components take a link builder (`invoiceHref`, ledger `links`) instead of
  hard-coding project routes, so Finance renders them with links into Finance.
- The project's own Finance tab and Commercial screens stay in place until Phase 3; for a while
  the same work is reachable from two places, both calling the same commands.
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
3. **Phase 3:** remove finance commands from the construction workspace — the project Finance tab
   and the Commercial billing screens move to Finance; the project Overview keeps the read-only
   money summary (decision 2).
4. **Phase 4:** tidy-up — redirects from retired project routes, role-seed review, and a
   rename-proof permission check for the role names project access still matches on.
