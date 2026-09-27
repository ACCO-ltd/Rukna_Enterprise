---
Status: accepted
Date: 2026-09-27
Owner approval: Abdulsalam, 2026-09-27. Condition: browser QA against the live API before deploy
Amends: ADR-028 (domain workspaces and navigation depth)
---

# Module shell, list page and document page

## Context

The 2026-09-27 audit (`docs/design/claude-design-system-brief.md`) found three problems:

- **The sidebar had grown to 34 child items under 4 domains.** Supplier bills was listed
  twice.
- **There were six separate tab-bar implementations.**
- **Every list and detail page hand-rolled its own header.** `<h1>` came in 12 styles.

Claude Design delivered batch 2 of the design system, covering three page patterns: the
navigation shell, the list page and the document detail page. ADR-034 (the foundations:
status registry, primary button, `MoneyDisplay`) is a prerequisite.

## Decision

### 1. Navigation shell

**Sidebar = modules only.** The sidebar lists Dashboard, Projects, Accounting, Procurement and
Administration. It no longer shows second-level rows, expanding sections or flyouts. It
changes form with the screen width:

- below `md`: a drawer
- `md` to `lg`: an icon rail with tooltips
- from `lg`: a labelled column, which the user can collapse to the rail

**Module header and module tabs.** Every route owned by a module renders a `ModuleHeader`
and a `ModuleTabs` bar above the page. `ModuleChrome` resolves the module from the URL and
is mounted once in `AppShell`.

- **Header content:** the module name, which is the page's only `h1`. Beside it sits a
  `Module / Tab / Page` breadcrumb, then a one-line description below.
- **Record names in the breadcrumb:** detail pages add the record number as the last crumb
  through `useModuleTrail(label)`. Server-rendered pages use `<ModuleTrail label />`.

**Tabs come from `NAV_DOMAINS`.** There is still one declaration of every route, label and
permission gate (`module-nav.ts`).

- An ungrouped item is a direct tab.
- Items that share a `groupKey` become one click-to-open dropdown tab.
- Items the user cannot access are removed, not disabled.
- Trailing tabs that don't fit collapse into **More**. There is no sideways scrolling.
- Below 560px the bar becomes one "Section: Tab › Page" picker.

**Pages that keep their own chrome.** Two places don't get the module header:

- The **project workspace** (`/projects/[id]/**`) keeps its tabs until its migration is
  validated separately.
- **Administration** keeps its existing workspace shell.

Every other module page drops its own `h1` and subtitle.

### 2. List page

`PlatformDataGrid` becomes the list page. The order down the page is: toolbar, then applied
filter chips, then the grid.

**Toolbar:**
- It is a single surface holding a scoped search, the **Filter** button and one primary
  create action.
- Create appears only where direct creation is valid for the role.

**Filter panel:**
- New `filters`, `filterValues` and `onFilterValuesChange` props.
- The panel (`FilterPanel` in `@erp/ui`) edits a draft. Only Apply or Clear commits.
- Applied filters render as removable `FilterChips`.
- Lists still using `toolbarFilters` keep working and migrate one at a time.

**Grid:**
- The header is navy (`brand-panel`, with the new `brand-on-panel` token for its text).
- The document number is the row's one link.
- Row actions go in an always-visible kebab. The actions header is screen-reader only.

**Phone layout.** Below 640px the grid renders one card per row. The card is built from each
column's `card` role: title, subtitle, meta, amount or status.

**Money-blind columns.** A column marked `redacted` renders `MoneyDisplay hidden` in every
cell, and search and sort both skip it. Sorting by a figure the viewer can't see would reveal
the figure's order.

**States.** The grid has five designed states: loading (a table skeleton), first-use empty,
filtered-empty (with one Clear), error with retry, and populated. The visible count bar is
gone, but the count is still announced through a screen-reader-only live region.

### 3. Document page

These components are new in `@erp/ui`:

- **`DocumentActionBar`** is sticky under the top bar. It carries:
  - a back link
  - the **one** primary command valid for the current state
  - secondary commands in a kebab, with destructive commands last and styled as danger
  - a read-only `LifecycleStepper`
- **Commands come from backend state and permissions.** An unavailable command is not
  rendered at all; this replaces the old disabled-with-tooltip buttons.
- **`LifecycleStepper`** draws each document type's real state machine. Terminal states
  (Reversed, Rejected, Cancelled) are drawn after the main line. It is never clickable,
  because moving a document on is a governed command, not a toggle. Below `sm` it reads as
  one line: "Approved · step 3 of 4".
- **`DocumentIdentity`** shows a type eyebrow, the document number and the status axes,
  each labelled: Document, Posting, Match.
- **`Notice`** shows at most one message per document when a state needs explaining: why
  posting is blocked, that posting failed (with a retry), or that the document was reversed.
  - Danger notices are announced assertively; everything else politely.
  - `Alert` is now a thin wrapper over `Notice`, so every existing alert gets the same look.

**Pilot: the supplier bill.** Its header is `BillDocumentHeader`, driven by three pure,
tested rules in `bill-actions.ts`:

- `billLifecycle`: posting status outranks document status.
- `primaryBillAction`: the next step on the main line. Reverse is never the primary command.
- `billNotice`: which single notice, if any, the page shows.

When a purchase-order match blocks posting, there is no primary button; the Notice explains
the block instead.

**Not in this ADR.** These components are specified by the design but not built yet:

- `DocumentTabs` (Lines, Journal items, Approvals, Activity)
- `SummaryRail`
- `TotalsBlock`
- the line-item grid

They belong to the document-editor batch.

### 4. Other changes

- **Dependency:** `lucide-react` is added to `@erp/ui`. The app already depends on it, and
  ADR-034 made it the only icon set.
- **`RecordHeader`** gains `headingLevel` (default `h1`). Inside a module it is `h2`.
- **Nav labels** move to sentence case ("Client invoices", "Setup & close") because they
  are now tabs and breadcrumbs.
- **Sidebar widths** are 15rem expanded and 4rem as a rail.

## Consequences

- **One navigation system per page.** The sidebar no longer repeats the pages a tab bar
  lists.
- **About 35 page components changed** in the Accounting, Procurement and Projects list-level
  sweep:
  - titles removed
  - create actions moved into the grid toolbar
  - records named in the breadcrumb
- **Supplier bills is the only list on the Filter panel so far.** The other 12
  `PlatformDataGrid` lists get the new header and toolbar surface automatically, but their
  inline filters move to the panel one by one.
- **About 15 bare-table lists** (users, roles, GRN, payments, UoM and others) still need
  moving onto the grid.

## Resolved on acceptance

- **`/accounting/reports`** was an orphan hub whose four reports all sit in the **Reports**
  tab. It is now a redirect to Trial balance.
- **Client create and edit** now follow the server's gates. "New client" (in the list, the
  empty state and the new-project form) needs `create:client`. The row menu's "Edit" needs
  `manage:client`. The new-project shortcut had been checking `manage:client`, which did not
  match `POST /clients`.

## Open items

- **The project workspace** still has five of the six tab implementations. Migrating it is
  its own decision.
