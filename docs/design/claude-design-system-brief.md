# Brief for Claude Design — Rukna Core Component Design System

> Paste everything below the line into Claude Design. Attach the six reference screenshots
> (accounting list with dark table header, AR invoice list, customer invoice editor, vendor
> bill editor, project create form, project overview dashboard) alongside it.

---

## 0. Who you are designing for

You are designing the **core component design system** for **Rukna**, a multi-tenant enterprise
ERP. The first client is **ACCO Ltd**, a construction and contracting company in Mogadishu.

The people who use it:
- **Finance staff** who post invoices, bills, receipts and journals all day on desktop.
- **Commercial and quantity surveyors** who manage contracts, BOQs and milestone billing.
- **Procurement officers** who raise material requests, purchase orders and goods receipts.
- **Project and site engineers** who log progress on tablets and phones at 375px on site.
- **Leadership** who scan dashboards and approve things.

The product works, but it looks like five apps stitched together. Every module grew its own
tables, headers, badges and forms. I want it to feel like one calm, professional, minimal
system, **the way the reference platform in the screenshots does**. That platform uses the same
table, the same filter bar, the same document editor and the same empty state on every screen.

**Your job is to design a small, closed set of components and page templates that every
repetitive screen in Rukna is assembled from.** Consistency matters more than novelty. If two
screens do the same job, they must look identical.

---

## 1. What the reference platform does well (copy the intent, not the pixels)

1. **One module, one horizontal tab bar.** Each module (e.g. Accounting) has a fixed
   horizontal tab bar under its title. Tabs with more than one page underneath are **dropdown
   triggers**. Large dropdowns group items under bold, non-clickable section labels. The
   breadcrumb next to the module title shows `Module / Tab / Page`.
2. **One generic list screen.** The toolbar is always search on the left, then List/Card toggle,
   Filter (which opens a panel), and one dark primary `+ Create X` on the right. The create
   button appears only on lists that support direct creation. The table has a navy header with
   white sentence-case labels, sort chevrons only on dates and amounts, a trailing column-config
   icon, and status as a pill. The empty state always has three parts: icon tile, "No X found",
   then a one-line hint.
3. **One document editor.** It is a full page, never a modal, for anything with line items.
   - The action bar has Save and Cancel on the left and lifecycle state on the right.
   - A small eyebrow names the document type ("Customer Invoice"), and the status word is
     oversized beneath it ("Draft").
   - Header fields sit in a two-column label/value grid with underline-style inputs.
   - The body tabs are Lines, Journal Items and Other Info.
   - Lines is an editable grid with a quiet "+ Add a line".
   - Totals are right-aligned in a fixed order: Untaxed, Discount, Tax, **Total**, **Amount Due**.
   - Terms and conditions sit to the left of the totals.
4. **One record-create pattern for master data.** An icon or avatar tile sits beside a huge
   inline-editable name ("Project Name *"), with a two-column underline form beneath.
5. **One dashboard language.** The filter bar has date range, Apply and Reset. KPI tiles have a
   label, a big value, a tinted icon tile and a qualifier line. Every chart card has a title, an
   optional segmented filter and a period select, and its empty state says what *will* appear.

**Things the reference got wrong, which you must fix, not copy:**
- **Lifecycle control differs by page.** The invoice uses a Draft/Posted toggle and the bill
  uses a static badge. Pick one pattern for every document type (see §6.3).
- **"Other Info" means different things.** On one document it holds editable fields; on another
  it is a computed summary. Define it once.
- **The Journal Items tab exists on some documents and not others.** Every postable document
  gets it.
- **Tables scroll horizontally on the project page.** Design a tab overflow behaviour instead.

---

## 2. Hard constraints (non-negotiable)

These come from our architecture docs. A design that breaks them cannot ship.

**Tech target.** Next.js with React, Tailwind CSS v4 on CSS-variable tokens, Radix primitives,
`cva` variants, a shadcn-style source-owned kit in `packages/ui` (`@erp/ui`), and the Inter
typeface. Design things that are buildable from Radix plus Tailwind. No bespoke canvas widgets.

**Closed token scales.** No raw hex, no ad-hoc font sizes, no ad-hoc radii. You may propose
refined values, but every value must be a named token. Current tokens (light / dark):

| Token | Light | Dark | Use |
|---|---|---|---|
| background | #f4f6f8 | #17191d | page canvas |
| surface / surface-subtle / surface-hover / surface-selected | #fff / #f8f9fb / #f0f3f7 / #eaf0ff | #202226 / #1c1e22 / #2c2f35 / #25304a | panels, rows |
| foreground / muted-foreground | #172033 / #667085 | #f4f6fa / #a8b0bf | text |
| border / border-strong / border-interactive | #dce1e8 / #c7cfda / #98a2b3 | #383c43 / #4a4f58 / #667085 | hairlines, inputs |
| brand-ink / brand-panel | #172033 | #e4e9f2 / #151d2c | navy: table headers, primary dark button, hero panels |
| brand-primary (+hover/active) | #255edb | #6d96ff | **interactive only**: links, focus, selected tab underline |
| success / warning / danger / historical (+ `-subtle`) | #087f5b / #9a5b13 / #b4232f / #6941c6 | #43c6a1 / #f4bd62 / #ff7b86 / #b7a0ff | status only |
| chart-1..5 (sequential) and series-1..5 (categorical) | see note | | never swapped |

- **Radius:** control 6px, panel 8px, container 14px, full.
- **Type:** display 30/36, h1 24/32, h2 18/26, h3 15/22, body 14/22, body-sm 13/20,
  caption 12/16, micro 11/14 (uppercase, tracked).
- **Shadows:** e1 (control), e2 (panel), e3 (overlay), ring (focus).
- **Motion:** 120ms exit, 180ms enter, 240ms layout, one ease curve. Reduced motion is respected.
- **Density:** comfortable rows are 40px and compact rows are 34px, toggled per user.

**Design doctrine we already follow (keep it):**
- **Status** is shown as word + colour + icon/dot, never colour alone.
  `brand-primary` never means status.
- **One primary action per screen.**
- **Money is typeset neutrally.** Use tabular figures, right-aligned. Don't colour a number just
  because it's money; colour only signals a real variance or problem.
- **No gradients, no cards around everything, no rainbow charts, no pills for plain text.**
  Don't turn tables into cards on desktop. Don't show disabled controls for unbuilt features.
- **Hairline section headers** (title plus 1px rule) are preferred over boxing every region.
- **Table headers are sentence case.** Micro-labels are uppercase only where they label a metric.

**Product facts that change the design:**
- **English only, LTR.** Arabic was removed. Don't design RTL variants.
- **USD only.** No currency selector, no exchange rate field. Show `$` or `USD` once, consistently.
- **ACCO does not use retention or guarantees.** Never show a retention or guarantee field,
  account, column or KPI anywhere. The reference shows "Retention Account"; drop it.
- **Some users are money-blind.** Project managers and site engineers may not see money. The
  server simply omits the field. Every component that shows money needs a designed **"hidden by
  permission"** state that is not an error, not "$0", and not a blank cell (e.g. a muted `—`
  with a lock tooltip, and KPI tiles that collapse gracefully).
- **Documents have up to three independent status axes,** and designs must show them without
  clutter:
  - `documentStatus`, e.g. Draft / Submitted / Approved / Rejected / Cancelled
  - `postingStatus`: Not posted / Pending / Posted / Failed / Reversed / Opening balance
  - for supplier bills, `matchStatus`: Not run / Matched / Matched with tolerance / Exception /
    Approved exception / Disputed
- **Approvals are real.** Most documents go through an amount-banded approval chain (DOA) with
  approve, return and reject, plus comments and a timeline. This must fit into the document page.
- **Touch:** it must be usable at **375px width**, and minimum touch targets are **44×44** on
  touch devices. Controls are currently 40px, which conflicts with this. Propose how to resolve
  it, for example 44px targets on coarse pointers only.
- **Light and dark themes** are both first-class. Every specimen needs both.

---

## 3. What exists today (audit summary)

Design **for** this reality. Don't redesign domain flows.

**Navigation today.** A 542-line vertical sidebar with 4 domains and 34 child items:
- **Projects:** Clients, Projects
- **Accounting (14):** Client invoices, Receipts, Supplier bills, Supplier payments, Journals,
  Chart of accounts, Account ledger, Trial balance, Balance sheet, Profit & loss, Monthly
  comparison, Bank accounts, Opening balance, Fiscal periods
- **Procurement (11):** Purchase orders, Material requests, Goods receipts, Buyer advances,
  Supplier bills (duplicated), Commitments, Suppliers, Materials, Material categories, Units,
  Spend categories
- **Administration (7, already tabs):** Users, Roles, Districts, Project subtypes, Branding,
  Workflows, Audit logs

Inside a project there is an 8-tab workspace: Overview, BOQ, Progress, Commercial, Procurement,
Finance, Documents, Team. Some of those tabs have their own sub-tabs, and **six different
tab-bar implementations** exist.

**Inconsistencies you are fixing:**
1. There are six tab-nav implementations. Some scroll horizontally, and one isn't URL-addressable.
2. About 30 separate status-colour maps contradict each other. `APPROVED` is blue in one place,
   purple in another and green in a third. `CANCELLED` is red, grey or purple depending on the page.
3. `<h1>` comes in 12 styles, and most detail pages hand-roll their own header, back link and
   action row.
4. Only 13 list screens use the shared data grid. About 15 others use bare tables with no
   search, pagination or empty state.
5. Line-item editors come in four shapes: cards (PO, material request, GRN), an editable table
   (journal, IPA), a bulleted list (supplier payment allocations) and a raw grid (BOQ).
6. Create/edit forms are sometimes a full page, sometimes a centred modal named "drawer", and
   sometimes a side sheet, with no rule for which to use.
7. KPIs have **six** implementations and tab bars have **six**. Steppers have three, confirm
   dialogs two, and two parallel mini-kits have their own palettes.
8. There are four empty-state patterns (including a bare `<p>`) and two loading patterns.
9. Two icon libraries are mixed (Lucide and Phosphor) with inline SVGs. **Standardise on Lucide.**
10. There is no chart library. Hand-rolled SVG charts each have their own axis formatting.

**What already exists in `@erp/ui` and should be refined, not replaced:**
Button, Badge, StatusBadge, Alert, Avatar, Card, StatTile, Progress, Meter, EmptyState,
Skeleton family, Dialog, Sheet, ConfirmDialog, Popover, Tooltip, DropdownMenu, Input, Textarea,
MoneyInput, Select, Combobox (async), Checkbox, RadioGroup, DatePicker, DateRangePicker,
FormField, FormSection, Wizard, Table primitives, Pagination, FilterBar, SavedViews,
ViewSwitcher, Tabs, RowActions, SectionHeader, RecordLayout, RecordHeader, RecordPanel,
DefinitionList, ApprovalChain, ApprovalTimeline, DecisionPanel, Toast.

These live in the app and should be promoted into the system: PlatformDataGrid, WorkspaceTabs,
PageHeader, Breadcrumbs.

**What is missing:**
- Module tab bar with dropdowns
- Document editor shell
- Line-item grid
- Totals block
- Generic audit timeline
- Filter panel
- Status registry
- Money display
- Quantity input
- Switch
- Attachment list and uploader
- Chart primitives
- Command palette (⌘K)
- Breadcrumb

---

## 4. Deliverable 1 — Foundations page

1. **Token sheet (light and dark):** colour roles, type scale with real ERP sample text,
   spacing, radii, elevation, motion and density. Keep our brand navy `#172033` and blue
   `#255edb`. You may *propose* adjustments, but mark each one as a proposed change with its
   reason.
2. **Status registry.** This is one canonical table and the most important foundation. Map every
   status to exactly one of six semantic tones:
   - **Neutral:** draft or not started
   - **In progress:** submitted, pending, open, partially done
   - **Attention:** needs action, exception, expiring, returned
   - **Success:** approved, posted, active, matched, verified
   - **Danger:** rejected, failed, overdue, disputed, called
   - **Historical/muted:** closed, cancelled, superseded, reversed, withdrawn, archived

   Each tone needs a pill style, a dot, an icon and a dark-mode value. Then show the full
   mapping for these vocabularies, using these exact values:
   - Project: DRAFT (shown as "Preparation"), ACTIVE, PRACTICAL_COMPLETION, CLOSEOUT, CLOSED,
     CANCELLED. Suspended is an overlay flag, not a status.
   - Contract: DRAFT, UNDER_REVIEW, PENDING_SIGNATURE, ACTIVE, FINAL_ACCOUNT_PENDING, CLOSED,
     CANCELLED, TERMINATED
   - BOQ version: DRAFT, BASELINED, COMMITTED, SNAPSHOT, SUPERSEDED, CANCELLED
   - Variation: DRAFT, PENDING_INTERNAL, INTERNAL_APPROVED, CLIENT_APPROVED, REJECTED, WITHDRAWN
   - IPA: DRAFT, PENDING_INTERNAL_APPROVAL, RETURNED_FOR_REVISION, APPROVED_FOR_SUBMISSION,
     SUBMITTED, CANCELLED
   - IPC: CERTIFIED, PARTIALLY_CERTIFIED, REJECTED
   - Client invoice document status: DRAFT, APPROVED, CANCELLED
   - Posting status (all financial documents): NOT_POSTED, PENDING, POSTED, FAILED, REVERSED,
     OPENING_BALANCE
   - Receipt and supplier payment: DRAFT, APPROVED, RELEASED, REJECTED, CANCELLED
   - Supplier bill: DRAFT, SUBMITTED, APPROVED, REJECTED, CANCELLED
   - Bill match status: NOT_RUN, MATCHED, MATCHED_WITH_TOLERANCE, EXCEPTION, APPROVED_EXCEPTION,
     DISPUTED
   - Journal: DRAFT, SUBMITTED, APPROVED, REJECTED, POSTED, REVERSED
   - Material request: DRAFT, SUBMITTED, APPROVED, PARTIALLY_ORDERED, FULLY_ORDERED, CANCELLED,
     CLOSED. Its priority (LOW, NORMAL, HIGH, URGENT) is **not** a status: design a separate,
     quieter priority marker.
   - Purchase order: DRAFT, OPEN, CLOSED, CANCELLED. PO revision: DRAFT, SUBMITTED, APPROVED,
     ACTIVE, SUPERSEDED, CANCELLED
   - GRN: DRAFT, SUBMITTED, POSTED, EXCEPTION_PENDING, CANCELLED. Line quality:
     PENDING_INSPECTION, ACCEPTED, PARTIALLY_ACCEPTED, REJECTED
   - Daily progress report: DRAFT, SUBMITTED, APPROVED, RETURNED, REOPENED
   - Project document: DRAFT, ISSUED, SUPERSEDED, WITHDRAWN, ARCHIVED. Its computed validity
     (NO_EXPIRY, NOT_YET_VALID, VALID, EXPIRING_SOON, EXPIRED) is a separate chip.
   - Approval: PENDING, APPROVED, REJECTED, CANCELLED
   - Fiscal period: OPEN, LOCKED, CLOSED, REOPENED
   - Master data: ACTIVE, INACTIVE (and SUSPENDED for users)

   Also show **how two or three axes render together** on one row and on one document header.
   For example: primary pill = document status, secondary quiet text or dot = posting status,
   and a match chip only when the match has run.
3. **Money and number rules:**
   - Tabular numerals, right alignment and thousands separators.
   - Negatives in parentheses or with a minus sign; choose one.
   - Zero shown as `—` or `$0.00`; choose per context.
   - Compact notation for KPI tiles (`$1.2M`) and full precision in tables.
   - The money-blind "hidden" treatment.
4. **Iconography:** Lucide only, with stroke width and size scale (16/20/24). Include an icon
   list for our modules and document types.

---

## 5. Deliverable 2 — Navigation shell (the most important structural change)

The vertical sidebar has become a long list. **Adopt the reference model:**

- **Slim sidebar = modules only.** It has about 6 items: Dashboard, Projects, Accounting,
  Procurement, Administration, and later Inventory, Payroll and Assets. It collapses to an icon
  rail and becomes a drawer on mobile. The top bar holds the company switcher/logo, global
  search (⌘K), the notifications bell with count, the theme toggle and the user menu.
- **Module page = module header + horizontal tab bar.**
  - The header shows the module title with the breadcrumb `Module / Tab / Page` beside it and a
    one-line description.
  - The tab bar sits below it. A tab is a direct link when it has one page and a dropdown when
    it has several. Dropdowns group items under bold section labels.
  - The active tab has an underline in brand-primary. The active dropdown item is highlighted.
- **Proposed tab maps.** Refine these, but use only pages that really exist.
  - **Accounting:** Dashboard · Receivables ▾ (Client invoices, Receipts) · Payables ▾
    (Supplier bills, Supplier payments) · Ledger ▾ (Journals, Account ledger) · Reports ▾
    (Financial statements: Trial balance, Balance sheet, Profit & loss, Monthly comparison) ·
    Setup ▾ (Chart of accounts, Bank accounts, Fiscal periods, Opening balance)
  - **Procurement:** Overview · Requests ▾ (Material requests) · Purchasing ▾ (Purchase orders,
    Goods receipts, Buyer advances) · Suppliers · Commitments · Setup ▾ (Materials, Material
    categories, Units, Spend categories)
  - **Projects:** Projects · Clients
  - **Administration:** Users · Roles · Workflows · Audit logs · Setup ▾ (Districts, Project
    subtypes, Branding)
  - **Project workspace:** the entity header (project name, status, location, client, kebab
    menu), then tabs: Overview · BOQ · Progress ▾ · Commercial ▾ · Procurement ▾ · Finance ▾ ·
    Documents · Team. Second-level views live in the dropdowns, **not** in a second tab row.
- **Overflow:** when tabs don't fit, the trailing tabs collapse into a "More ▾" menu. There is
  **no horizontal scrollbar** (the reference screenshot shows the ugly scrollbar we want to
  avoid). On phones, show the tab bar as a single "Section: Receivables › Client invoices"
  select or sheet.
- **Specify:** keyboard behaviour (arrow keys, Esc), hover vs click to open (click, like the
  reference), the focus ring, and how permission-gated items disappear. **Items the user cannot
  access are hidden, not disabled.**

Show this shell at 1440px, 1024px, 768px and 375px, in light and dark.

---

## 6. Deliverable 3 — Components

For **every** component provide: anatomy, variants, sizes (comfortable/compact), all states
(default, hover, focus-visible, active, disabled, loading, error, empty, read-only,
money-hidden where relevant), light and dark, a 375px behaviour, a do/don't pair, and a
suggested React prop API using our naming.

### 6.1 Data display
- **DataTable / PlatformDataGrid.** This is the flagship.
  - Header: navy with white sentence-case labels, sort on chosen columns, sticky header, a
    trailing column-config (show/hide) menu, and a select-all checkbox.
  - Rows: 40/34px, hover, selected, clickable (whole-row navigation), and row actions revealed
    on hover plus a kebab.
  - Cells: numeric right-aligned, primary column (code + name, two lines), status pill cell,
    party cell (avatar + name), date cell, money cell with hidden state.
  - Footer: totals row, bulk-action bar that appears on selection, pagination.
  - States: loading skeleton rows, empty (no data yet vs no results for filters are two
    different messages), error with retry.
  - Below `md`: a stacked **row card** layout (mobile only; desktop always stays a table).
- **List toolbar:** scoped search, saved views (All / Needs action / Mine with counts), the
  List/Card toggle only where cards add value, Filter, and the primary `+ Create`.
- **Filter panel:** opens under the Filter button as a 2-column field grid with Clear and Apply.
  Active filters show as removable chips under the toolbar.
- **StatusPill, PostingIndicator, MatchChip, PriorityMarker, ValidityChip.** These come from
  the status registry.
- **Money, Quantity, Percent and Date display** atoms.
- **DefinitionList:** label/value pairs in one or two columns for read-only fields.
- **Totals block:** Subtotal, Discount, Tax, a rule, **Total**, then **Amount due** (largest).
  Include a variant for journals: Total debit, Total credit and an Out-of-balance warning.
- **KPI tile:** label, value, qualifier with dot, optional icon tile, optional delta and
  sparkline, link, and the hidden/unavailable state. Also a **metric strip** variant (4–6 inline
  metrics separated by hairlines), which we prefer inside workspaces.
- **Chart card:** title, subtitle, a segmented filter (e.g. All / MR / LCR / Subcontract), a
  period select and a legend. Specify line/area, bar, stacked bar, aging buckets (Current, 1–30,
  31–60, 61–90, 90+) and ring/share. Use at most five series. The informative empty state says
  what will appear. Charted values must also be available as text.
- **Audit / activity timeline:** timestamp, actor avatar, action badge, bold event title, a link
  to the record, a machine event code (e.g. `invoice.post`) and an expandable field-level diff
  (before → after).
- **Approval chain + decision panel:** steps with state, approver, time and comment. Current
  step highlighted. Approve / Return / Reject with a required comment on Return and Reject.
- **Empty state (one component, three sizes):** page, panel and table-row. Includes an icon
  tile, a title and a hint, with an optional action.
- **Skeletons** for table, form, record and dashboard.

### 6.2 Inputs and forms
- **Underline field style** (as in the reference editors) vs **boxed field style** (as in
  filters and dialogs). Decide which applies where and define both.
- Text, Textarea, **MoneyInput** (prefix, thousands, 2dp), **QuantityInput** (with unit
  suffix), Percent input, Select, **Async Combobox** (loading, avatar or code per option, "Create
  new…" footer, empty result), DatePicker, DateRange, Checkbox, Radio cards, **Switch**,
  **File upload + attachment list** (drag-drop, progress, uploaded, frozen/locked after submit).
- **FormField:** label (left-aligned in a 2-column grid on desktop, stacked on mobile), required
  asterisk, hint, inline error, success/checking.
- **Form layout:** two-column label/value grid, form sections with hairline headers, and an
  error summary at the top on submit.
- **Page-level form for master data:** the "inline big-name" pattern from the reference project
  form, with an icon/avatar tile and a huge editable name. Use it for Project, Client, Supplier,
  Material, User and Role.
- **Decision rule for containers.** Specify when to use:
  - a **full page:** anything with line items or more than 8 fields, plus master-data creation
  - a **side sheet:** quick edit of a related record, previews, filters on mobile
  - a **centred dialog:** confirmations and 1–4 field actions (e.g. record payment date, reason
    for cancel)

### 6.3 The Document editor shell (second most important deliverable)

One shell for **every** transactional document: Client invoice, Supplier bill, Receipt,
Supplier payment, Journal, Purchase order, Material request, GRN, IPA, Variation, Buyer
advance, Daily progress report.

- **Sticky action bar.** On the left: Save and Discard (edit mode), or **lifecycle command
  buttons** (view mode). There is one primary button, e.g. "Submit for approval" → "Approve" →
  "Post", and secondary commands like Cancel or Reverse go in a kebab. On the right: a
  **read-only lifecycle stepper** (Draft → Submitted → Approved → Posted) with the current step
  emphasised.
  - **Do not use a clickable Draft/Posted toggle.** Posting and approving are governed, audited
    commands that can require approvals and a reason, so they must be explicit buttons. This
    resolves the reference's inconsistency.
- **Identity block:** an eyebrow with the document type ("Supplier Bill"), the document number
  or oversized status word ("Draft" before numbering, "BILL-2026-0042" after), then status pill
  + posting indicator + match chip on one line.
- **Header grid:** two columns of label/value underline fields. Party (async combobox with
  avatar), Project, Contract/PO link on the left. Dates and references on the right.
- **Body tabs,** fixed order and meaning on every document:
  1. **Lines:** the line-item grid (below).
  2. **Journal items:** always present on postable documents. Before posting, it shows a guard
     sentence: "Journal items are created when this bill is posted." After posting, it shows a
     read-only Dr/Cr table with a link to the journal.
  3. **Approvals:** the approval chain, decision panel and history.
  4. **Attachments:** list and upload, locked after submit.
  5. **Other info:** **editable secondary fields only** (notes, terms, internal reference).
     Computed financial summaries never go here; they go in a **summary rail** on the right on
     desktop and below the totals on mobile, showing amount paid, balance due, payments count
     and posted at.
  6. **Activity:** the audit timeline.
- **Line-item grid (one component):**
  - On desktop, an editable table row per line: description/product (combobox), account,
    qty + unit, price, disc %, tax, and a computed amount.
  - Row states: new, dirty, invalid (inline cell error), and read-only once posted.
  - Keyboard: Tab across cells, Enter adds a row, and deleting a row is undoable.
  - "+ Add a line" is a quiet text button under the last row. Optional "Add section/note" rows.
  - **Below `md`,** each line becomes a stacked card ("Line 1 — Cement 42.5N", with a trash
    icon), with the same fields.
  - Variants must be driven by column config, not separate components: invoice (revenue
    account), bill (expense account + PO line match), journal (account / debit / credit /
    memo), PO/MR (material + qty + unit + required date), GRN (ordered / received / accepted /
    quality status), IPA/IPC (BOQ item, previous, this period, cumulative), and payment and
    receipt **allocations** (open document, due, allocate now, remaining, plus an
    "Unapplied / on account" remainder line).
- **Footer:** terms/notes on the left and the totals block on the right.
- **States to show:** new unsaved draft; saved draft; submitted and awaiting approval (read-only
  plus the decision panel for the approver); approved, not posted; posted (read-only, journal
  tab filled); posting failed (danger alert with retry); cancelled/reversed (historical banner);
  and money-hidden viewer.

### 6.4 Record detail (master data and projects)
- **Record header:** back link and breadcrumb; icon/avatar tile; large name; status pill;
  meta line (code · location · client, with icons); metric chips (e.g. Contracts 3 · Invoiced
  $1.2M · Due $340k); one primary action; and a kebab for Edit, Deactivate and Delete (danger,
  last).
- **Record tabs:** Overview (definition list) / related lists / Documents / Activity.
- **Statement view** (party ledger): year picker, filter, export, running-balance table and
  totals row.

### 6.5 Feedback and overlays
Alert (info, success, warning, danger), toast, confirm dialog (with an optional "reason"
field), side sheet, dialog sizes, tooltip, popover, dropdown menu (with section labels and a
danger item), a **banner** for record-level states (Suspended, Posted & locked, Reversed), and
the command palette.

### 6.6 Page templates
Assemble the components into these templates, each shown with realistic ACCO data at desktop
and 375px, in light and dark:
1. **List page** (e.g. Supplier bills), including empty, filtered-empty and loading states.
2. **Document editor**, in the states listed above (e.g. Supplier bill with PO match).
3. **Record detail** (e.g. Project or Client).
4. **Master-data create form** (e.g. New project, with the inline big-name pattern).
5. **Module dashboard** (e.g. Accounting). Filter bar; a dark "control centre" hero with 3 health
   tiles (Open period, Trial balance matched, Exceptions); a KPI grid; revenue vs expense and
   aging charts; top overdue lists; recent journal activity.
6. **Report page** (e.g. Trial balance or Aged receivables). Standard control bar: As-of date,
   Based-on toggle, Filter, Export (no currency selector). A grouped table with subtotal rows and
   a bold totals row.
7. **Settings / setup list** (e.g. Units of measure). A table with an inline or dialog create
   (define which).
8. **Wizard** (e.g. Opening balance, IPC). A step rail, a step panel, a summary and a success
   screen.
9. **Project workspace overview.** A replacement for the last screenshot, using the new shell:
   a metric strip instead of six boxed tiles, and chart cards.

---

## 7. Realistic content to use (never lorem ipsum)

- **Company:** ACCO Ltd (Asas Construction Company), Mogadishu. **Currency:** USD.
- **Projects:** "Hodan Mixed-Use Tower" (code `ACC-HDN-26-001`), "Afgooye Road Rehabilitation
  Lot 2", "Waberi Primary School Extension". **Districts:** Hodan, Waberi, Wadajir, Kaaraan.
- **Clients:** Ministry of Public Works, Benadir Regional Administration, Dahabshiil Properties.
- **Suppliers:** Berbera Cement Co., Mogadishu Steel Traders, Hormuud Logistics.
- **Materials:** Cement 42.5N (bag), Rebar Y12 (ton), Aggregate 20mm (m³), Blocks 6" (pc).
- **Billing:** ACCO bills by **milestone** (e.g. 40/30/20/10), not by monthly valuation.
- **Document numbers:** `INV-2026-0118`, `BILL-2026-0042`, `PO-2026-0311`, `MR-2026-0207`,
  `GRN-2026-0154`, `JE-2026-0890`, `RCPT-2026-0077`.
- **Roles:** Commercial Director, Finance Manager, Accountant, Procurement Officer, Project
  Manager (money-blind), Site Engineer (money-blind).

---

## 8. Output format I need back

1. **Foundations page:** tokens, status registry, money rules and icons.
2. **Component library page(s),** one artboard per component with all states, light and dark.
3. **Navigation shell,** at four breakpoints.
4. **The nine page templates** in §6.6.
5. **A handoff spec (markdown)** listing, for each component:
   - its name, matching our `@erp/ui` naming where one exists (flag renames explicitly)
   - its props and variants in `cva` terms
   - the tokens it uses
   - accessibility notes: roles, keyboard, focus and aria
   - which existing implementations it replaces
   - whether it is **Refine existing**, **Promote from app** or **New**
6. **A decision log** listing every place you departed from our current tokens or doctrine, and
   every open question you couldn't resolve. Minimum open questions to address:
   - 40px vs 44px targets
   - underline vs boxed inputs
   - negative-number format
   - whether Card view is worth keeping on lists

**Quality bar:** calm, dense-but-breathable, enterprise. Think Linear or Stripe Dashboard
restraint combined with the reference ERP's regularity. Every screen of the same type is
pixel-identical in structure. Clarity beats decoration, and a finance user should be able to
process 50 bills an hour without hunting for anything.
