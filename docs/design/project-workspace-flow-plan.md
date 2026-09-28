# Project workspace — flow and consistency plan

Status: **Approved** 2026-09-27 (all four recommendations accepted) · Author: Abdulsalam (with Claude)
Applies: ADR-034 (tokens/status/money), ADR-035 (navigation), ADR-036 (document pages),
ADR-037 (forms), ADR-028 NAV-001…006, ADR-030 (commercial).

## Goal

A user should walk **client → project → workspace → contract → billing → collection → accounts**
without the screens contradicting each other, without leaving the project to finish a job,
and with every tab built from the same parts. A finance officer should be able to do the same
money work from **inside a project** (scoped to it) or from **Accounting** (across all projects)
— same components, two entry points.

## What the review found

Reviewed from the 14 production screenshots (project `ACCO-HDN-26-0005`) and the code behind them.

### A. The screens tell the user wrong or conflicting facts (fix first)

| # | What the user sees | Cause |
|---|---|---|
| A1 | Overview says "Baseline the BOQ — Ready now"; BOQ tab says **Committed**; Commercial foundation says **Working** | Committing sets the BOQ version to `COMMITTED`; readiness and workspace summary only accept `BASELINED` (`project.service.ts:141,313`). The UI already labels baselined as "Committed". |
| A2 | "Create and execute the main contract" shows **Complete** *and* "Complete 'Baseline the BOQ' first" | Lock line checks the dependency but not whether the step is already satisfied (`project-readiness.tsx:120,158`). |
| A3 | Commercial banner says **Blocked: milestone must be verified**; card below offers **Review for billing** | `getOverview` builds its own next action and ignores `cycle.blockers` (`commercial.service.ts:1690-1709`); the label is hard-coded English from the server. |
| A4 | Payment schedule says **Invoice issued · Send to client**; Billing & Collection lists the same invoice as **Unnumbered draft** | Stage becomes BILLED when *any* invoice exists, regardless of posting (`commercial.service.ts:1154`); the web override to "invoice-issued" doesn't check `postingStatus` either (`contract-milestones-tab.tsx:545`). A reversed invoice would also still show "issued". |
| A5 | "Net billed $0.00" while two draft invoices exist | Correct by definition (drafts aren't billed) but nothing says "2 drafts awaiting review". |
| A6 | Finance shows **0.00**, Commercial shows **$0.00** | `formatMoney` prints no symbol when currency is null; Finance's currency comes from budget/entries, which are empty. |
| A7 | Accounting setup "Incomplete — 6 items / GL cannot accept postings" is only visible deep in Finance | Nothing checks readiness before **Prepare invoice** / **Approve** / **Post**; `issuePackage` fails and rolls back. The Finance "configure" link never renders (`href: null`, `project-finance-overview.service.ts:287`). |
| A8 | Submitted report shows "Return reason: labor missing" as if current | The old return reason is shown on any status. |
| A9 | Documents empty state mentions **guarantees** | ACCO does not use guarantees ([[project-acco-no-retention]]). |

### B. The same thing is built differently on each tab

| # | Inconsistency | Where |
|---|---|---|
| B1 | Header right slot: **Continue setup** button + kebab on Overview; ghost text "Preparation sequence" on every other tab | `project-workspace-shell.tsx:258` |
| B2 | Five sub-tab implementations: `ViewSwitcher` (Progress, Commercial), hand-rolled `<nav>` (Finance, Documents), hand-rolled no-overflow (Procurement). Icons on some, active-only on others | `progress-tab.tsx:46`, `commercial-nav.tsx:92`, `finance-shell.tsx:45`, `documents-shell.tsx:58`, `procurement-sub-shell.tsx:65` |
| B3 | Stray ▲▼ scroll arrows beside Progress and Commercial sub-tabs; horizontal scrollbar in the Reports list | `ViewSwitcher` underline: `-mb-px` items overflow an `overflow-x-auto` track by 1px → vertical scrollbar (`view-switcher.tsx:68-76`) |
| B4 | Three metric strips, three label styles (sentence case / `uppercase tracking-0.08em` / `uppercase tracking-0.06em`), `StatTile` in `@erp/ui` used by none | `overview-tab.tsx:166`, `billing-collection-tab.tsx:268`, `finance-primitives.tsx:62` |
| B5 | Terms: **VAT** (Accounting) vs **Sales tax** (Commercial, invoice PDF); **Net billed** vs **Billed** vs **Invoiced**; **Unnumbered** / **Not numbered** / **Not yet numbered** | `commercial.json`, `accounting.json`, `platform.json` |
| B6 | Title case "Recent Commercial Activity" among sentence case; Commercial activity list repeated on two sub-tabs | Commercial overview + contract tab |
| B7 | Client detail uses a raw `h2` and its own `TabButton` instead of `RecordHeader` / `WorkspaceTabs` | `client-detail.tsx:55,112` |
| B8 | Project-created success card is hand-rolled, not a toast | `project-detail.tsx:30,67` |

### C. The flow makes the user leave the project

| # | Where the user is thrown out | Today |
|---|---|---|
| C1 | "Review draft" / "Post invoice" in Billing & Collection | Opens `/finance/accounting/invoices/{id}` under the Accounting header, on a narrow page |
| C2 | Supplier bills from the Finance ledger | `/finance/accounting/bills/{id}`, back link hard-coded to the bills list |
| C3 | "Open Procurement", "Raise requirement", purchase detail links | Unscoped `/procurement/...` — the project filter is lost |
| C4 | Accounting lists cannot be narrowed to a project | `GET /invoices` only takes `clientId`; `GET /bills` only `supplierId`; P&L API takes `projectId` but no picker in the UI |

### D. Structure

- **D1** Programme is one very long page: performance (curve, needs attention, work-package progress, period comparison, verified) *and* setup (work packages, baseline, milestones, schedule, activities). Work packages appear twice.
- **D2** Commercial ships three tabs (Overview · Contract & milestones · Billing & collection); accepted ADR-030 says four (Contract · Payment schedule · Variations · Billing) with no Overview. Code and ADR have drifted.
- **D3** A project in **Preparation** already has an active contract, an issued stage and draft invoices. Nothing nudges "Start project" once the contract is active.

## The design we apply (one set of parts everywhere)

1. **Workspace shell** — `h1` project name + one status pill + meta line; right slot is the *same on every tab*: one primary action valid for the lifecycle state (Preparation → "Continue setup", Active → none or "Record progress") + kebab. Lifecycle rail stays on Overview only.
2. **Sub-navigation** — one component: `ViewSwitcher appearance="underline"`, overflow bug fixed, **no icons** on sub-tabs (icons belong to the top tab bar only). Collapses to a picker below `md` (NAV-003).
3. **Screen heading** — `h2` + one-line description + that screen's own primary action on the right (NAV-002). No repeated activity feeds.
4. **Metric strip** — one `MetricStrip` built on `StatTile`, `uppercase` micro label (brief: uppercase only to label a metric), `MoneyDisplay` value, optional sub-line ("2 drafts awaiting review"). Currency never null: fall back to the organization currency (USD).
5. **Status** — every pill from `status-registry.ts`; one invoice vocabulary used by Commercial and Accounting alike: **Draft → Approved → Posted (numbered) → Sent → Part paid → Paid**, plus Reversed / Credited. Stage states derive from it.
6. **Blocked actions** — never a contradicting button: hide the action and show the reason + fix link at the point of action (CONST-COM-025), using one `Notice` per screen.
7. **Documents opened from a project stay in the project** — same `InvoiceDetail` / bill document page, rendered bare under the tab (NAV-006) with a back link to where the user came from. Accounting keeps its own route to the same component.
8. **Containers** — ADR-037 rule: full page for line items and master data, side sheet for quick edits of a related record (add team member, edit project info), dialog for 1–4 field actions.

## Plan — five PRs, each shippable on its own

### PR 1 — Trust fixes (small, highest value)
- A1 readiness + workspace summary treat `COMMITTED` as baselined (server); Commercial foundation shows "Committed".
- A2 lock line only when the step is not satisfied.
- A3 `getOverview` takes `nextAction`/`blockers` from the cycle; server returns an action *kind*, web owns the label.
- A4 stage is "invoice issued" only when an invoice is **posted**; a draft stage shows "Draft invoice · Review draft"; reversed invoices release the stage.
- A5 metric sub-line "N drafts awaiting review".
- A6 null currency → organization currency.
- A8 return reason shown only while status is Returned (label "Returned: …"); history keeps it.
- A9 remove "guarantees" copy.
- B3 `ViewSwitcher` overflow fix + Reports list scrollbar.
- Tests for each; no migration.

**Delivered (branch `feat/workspace-trust-fixes`).** As planned, with these findings on the way:
- A1 also fixed Finance cost-by-area: `findBoqTree` read only `BASELINED`, so a committed BOQ
  rolled up no cost. Procurement inlines the status list (ARCH-BOUNDARY-001).
- A3 kept the cycle's rule that an *unlinked* milestone-triggered stage is blocked ("missing
  evidence is not verification", existing S-SH-3 test). Open question for Eng Ahmed: the
  mark-ready command only refuses a *linked* unverified milestone — the two should agree.
  The card also stops offering the action to viewers without `manage:receivable`.
- A4 added `postingStatus` to billing-package documents and a **Draft invoice** stage state
  ("Review draft" → the invoice). The duplicate "Invoice issued" pill in the row is gone.
  Still open: a *reversed* invoice keeps its stage BILLED on the server.
- A6 falls back to the project's currency (Finance / procurement position).
- The shared `Tabs` strip had the same 1px overflow as `ViewSwitcher`; both now draw the rule
  as an inset shadow.

### PR 2 — Workspace shell and shared parts
- B1 one header right slot on all tabs.
- B2 all sub-tabs → `ViewSwitcher` underline, no icons.
- B4 `MetricStrip` on Commercial overview, Billing & collection, Finance overview, Cost control.
- B5 terminology pass (see decisions below) across `commercial.json`, `accounting.json`, `platform.json`, `finance.json`.
- B6 sentence case; activity feed only on Commercial overview.
- New **ADR-038 Project workspace anatomy** recording shell, sub-nav, metric strip, screen heading rules (ADR-035 left this as "its own decision").

**Delivered (branch `feat/workspace-shell`).**
- New `WorkspaceSubNav` and `WorkspaceSectionHeader`. Commercial, Finance, Procurement and Documents use both. Progress uses the header, and its state-driven switcher loses its icons.
- `MetricStrip` now has `columns` and `tone`. It serves the Commercial overview and Billing & collection. Finance's `Metric` matches its type.
- Wording:
  - "Sales tax" replaces "VAT" in all labels.
  - "Invoiced" replaces "Net Billed" and "Billed".
  - "Not yet numbered" is used everywhere.
  - Commercial and Finance titles are sentence case.
- Finance and Documents headings moved from `h1` to `h2`.
- The ADR-030 amendment records the three shipped Commercial tabs (decision 1).

### PR 3 — Client → project → first day
- Client detail on `RecordHeader` + `WorkspaceTabs` (B7); primary action "New project".
- Project form back link says the client when opened from a client.
- Landing after create: toast (B8) and the checklist; each "Open task" deep-links to the exact place (BOQ commit, add-member side sheet, contract create page, dates side sheet).
- D3: when the contract is active and mandatory steps are done, the header primary becomes **Start project**; the Overview checklist shows the final step as the next action.
- Edit project information → side sheet (ADR-037).

**Delivered (branch `feat/client-project-flow`).**
- Client detail now uses `RecordHeader` (h2). "New project" is its one primary action; Edit and Deactivate sit in the kebab, with the status change last. The summary uses `MetricStrip` (new `columns={2}`) and the sections use the shared underline switcher.
- The project form's back link names the client when the form was opened from a client.
- "Project created" uses the app toast.
- Checklist links go straight to their pages:
  - The contract steps open Contract & milestones, with no redirect hop.
  - The delivery-team step opens Team with the add form already open (`?add=1`).
  - Team uses `WorkspaceSectionHeader`.
- D3 needed no change: once mandatory preparation is done, `ProjectActionsPanel` already offers **Start project**, and since PR 2 it does so on every tab.
- **Not done, deliberately:** a side sheet for editing project information. ADR-037's container rule puts master data on a full page, and `/projects/:id/edit` already is one.

### PR 4 — Money flow: Commercial ↔ Finance ↔ Accounting
- **API:** `GET /invoices?projectId=`, `GET /bills?projectId=` (org-scoped, permission-checked, tests); project column on both lists.
- **Project-scoped document routes:** `/projects/[id]/commercial/invoices/[invoiceId]` and `/projects/[id]/finance/bills/[billId]` render the existing document pages bare under the tab with a context back link (C1, C2). Accounting routes unchanged.
- **Accounting:** project filter chip on Receivables and Payables lists; project picker on P&L / ledger reports (C4).
- **Readiness surfaced (A7):** one `Notice` on Billing & collection, the invoice page and Finance overview when `GET /accounting/readiness` is incomplete — "Invoices can't be posted until accounting setup is finished · Open setup"; **Prepare invoice / Approve / Post** hidden with that reason instead of failing. Fix the null `href`.
- **Separate charges:** adding a separate charge from BOQ confirms "Draft invoice created · Review" and lists it in Billing & collection with its source.
- **Procurement tab (C3):** "Raise requirement" pre-fills the project; "Open Procurement" opens lists filtered to the project; purchase detail opens under the project tab.
- **Reconciliation line** on Finance overview: Commercial *invoiced* vs GL *project revenue* — same number or the difference explained.
- Amend ADR-030 (see decision 1) and `docs/reference/api-reference.md`.

**Delivered (branch `feat/money-flow`).**
- **API:** `GET /invoices?projectId=` and `GET /bills?projectId=`. A bill matches on its header or on any line.
- **Accounting:** the invoice and bill lists have a Project filter, pre-filled from `?projectId=`.
- **Documents open inside the project:**
  - Invoices open at `/projects/:id/commercial/invoices/:invoiceId`, reached from Billing & collection, the schedule's "Review draft" and the ledger. They use the same page Accounting uses.
  - Bills open at `/projects/:id/finance/ledger/bills/:billId`.
  - Back returns to the tab you came from and keeps its filter. A `from` that points outside the project is ignored.
- **Readiness (A7):**
  - `AccountingSetupNotice` appears on Billing & collection, Contract & milestones and unposted invoices.
  - **Post** and **Prepare invoice** are hidden while the ledger cannot post.
  - Finance's setup item now links to the page that fixes the first blocker.
- **Separate charge:** the toast says a draft invoice was created, with a "Review invoice" action.
- **Procurement:** "Raise requirement" pre-fills the project and returns to it after saving.
- **Reconciliation:** Finance overview has a **Billing and general ledger** control. It shows what was invoiced, net of sales tax and credit notes, against the revenue posted.
- **Not done:** the PO list has no project filter yet (API work needed). "Open Procurement" stays the deliberate exit to the cross-project buyer workspace.
- **Also:** the Commercial tab labels are now sentence case ("Contract & milestones", "Billing & collection").

### PR 5 — Progress and Programme
- Split **Programme** into **Performance** (curve, needs attention, work-package progress, period comparison) and **Plan & setup** (work packages, baseline, milestones, schedule, activities). One work-package list, not two (D1).
- Report review: measurement that exceeds BOQ scope warned at entry, not only at review.

Order: PR 1 → PR 2 → (PR 3 ‖ PR 4) → PR 5. Each PR: build + tests before commit, review, then merge on approval.

## Decisions (all accepted as recommended, 2026-09-27)

1. **Commercial tabs** — *Recommended:* amend ADR-030 to the three shipped tabs (Overview · Contract & milestones · Billing & collection); variations stay in the Contract changes panel. Alternative: rebuild to the ADR's four tabs.
2. **Tax label** — *Recommended:* "Sales tax" everywhere in the UI (it is what the client sees on the invoice PDF); API field `vatAmount` and the `VAT_OUTPUT_PAYABLE` account stay. Alternative: "VAT" everywhere.
3. **Billing before the project starts** (for Eng Ahmed) — *Recommended:* allow it (advance/mobilisation invoices happen before start) but make "Start project" the header action once the contract is active. Alternative: block invoicing until Active.
4. **Second-level navigation** — *Recommended now:* keep a second tab row, one component. The brief's dropdown tabs (Progress▾, Commercial▾…) can follow once every tab uses the same sub-views.

## Not in scope
Visual restyle of Progress beyond D1 (its own reskin, [[project-progress-tab-reskin]]); credit notes and itemised invoice lines (ADR-030 phases 2–3); command palette; charts palette.
