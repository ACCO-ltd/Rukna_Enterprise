# ADR-047 — Rukna design system, tenant-neutral platform, and the 2026-10-27 grill decisions

**Status:** Accepted. Abdulsalam (product owner and sole engineer) and Eng Ahmed answered the grill
questions on 2026-10-27. §1–§3 are built (2026-10-28), §3b rolled out (2026-10-29); §4 records decisions for later steps.

## Context

The UI redesign review (2026-10-27) produced an approved design system: tables, colours, forms,
dialogs and foundations, with mockups reviewed screen by screen. Two rules came with it: follow the
system end to end, and remember that Rukna is multi-tenant, so no company name may be built into the
code. This ADR records the system and both rules, plus the answers to the grill questions that
shape the next build steps.

## 1. Tenant-neutral platform (built: Step 1a, 73d367b)

- No tenant's name, address or branding appears in the code, message catalogues, placeholders, DTO
  examples or Swagger tags. The login page reads the tenant's name from `GET /auth/branding`
  (public; resolved from the subdomain).
- Seeds and defaults have generic names (`seedDefaultWorkflows`, `DEFAULT_ROLES`,
  `STANDARD_BUILDING`, `STANDARD_PAYMENT_PLAN`, …).
- Values already stored in tenant databases (`policyKey 'ACCO_GOVERNANCE'`,
  `PENDING_ACCO_CONFIRMATION`) stay as they are. They are data, not code, and renaming them would
  need a data migration for no user benefit.
- Printed documents take the company's details from organisation settings (Administration →
  Branding), never from code.

## 2. Company templates (built: Step 1b)

Rukna ships a **platform default** for each template, and each company may keep an **editable copy**
of it.

- Stored on `organizations.payment_plan_template` / `schedule_template` (JSONB). NULL means the
  Rukna default is in force; "Reset to Rukna default" writes NULL back.
- Owned by `business/construction/company-templates`. The defaults live in
  `domain/default-templates.ts` and the save rules in `domain/template-rules.ts`: stages total
  exactly 100%, at most one advance, 1–20 stages; 1–30 phases with unique names, each 1–365 days.
- A save returns every broken rule at once (`TEMPLATE_INVALID`, `details.problems`) and is audited.
- The contract payment-plan builders and the schedule wizard (`STANDARD_BUILDING`) read the copy in
  force. Administration → Templates edits both.

## 3. Design system (built: Step 1c)

Option A, "Rukna Blue", was chosen over Pillar Teal and Site Indigo + Amber. Component code is
unchanged: only token values moved.

| Token | Before | Now |
|---|---|---|
| `--brand-primary` (hover / active) | `#255edb` | `#2453e0` (`#1c42b8` / `#1a3891`) |
| `--brand-panel` (sidebar, navy headers) | `#172033` | `#111d42` |
| `--background` / `--foreground` | `#f4f6f8` / `#172033` | `#f6f7f9` / `#0f1729` |
| `--border` / `--muted-foreground` | `#dce1e8` / `#667085` | `#e4e7ec` / `#5b6475` |
| `--surface-selected` / `--brand-accent` | `#eaf0ff` / `#edf2ff` | `#eef3ff` |
| `--success` / subtle | `#087f5b` | `#0b7a43` / `#e8f6ee` |
| `--warning` / subtle | `#9a5b13` | `#94570a` / `#fdf4e3` |
| `--danger` / subtle | `#b4232f` | `#c8291e` / `#fdecea` |
| `--historical` (retention, superseded) | `#6941c6` | `#6a45e8` / `#f1edff` |

- **Type scale:** 30 / 22 / 16 / 14 / 14 / 13 / 12 / 11 px (display, h1, h2, h3, body, body-sm,
  caption, micro). h3 shares the body size; its 600 weight sets it apart.
- **Spacing:** a 4 px grid.
- **Controls:** 28 / 36 / 38 / 44 px. The default control is 38, `sm` is 36 and `lg` is 44 (the
  touch target). 28 is reserved for in-row icon actions. Compact density stays at 34.
- **Radius:** 6 (control) / 8 (panel) / 12 (container) / 16 (overlay: dialog, sheet, drawer).
- **Icons:** Lucide only, 16 px in controls and 20 px in navigation. Every icon-only button has an
  accessible name.
- **Accessibility:** text contrast at least 4.5:1, visible focus ring (`--shadow-focus`), 44 px touch
  targets on phone flows, colour never the only signal (status badges keep their dot and label),
  and every form error listed by field.
- **Categorical chart series:** the existing CVD-validated `--series-1…5` are kept. The mockup's
  six-hue palette was illustrative and is not adopted until it is validated the same way.
- **Living reference:** `/design` (the gallery) shows every token at its current value. Update it
  in the same change as any token.

### 3a. Shell and list layout (built 2026-10-28, from the approved mockups)

These replace earlier rules, so they are listed explicitly:

- **Primary button = Rukna Blue** (`--brand-primary`). This replaces ADR-034's navy-ink primary.
  Each screen still has only one primary action. Links stay underlined, so blue on its own never
  marks a link.
- **Sidebar = navy panel** (`--brand-panel` #111d42) with its own `--nav-*` ink tokens. The active
  item is a lighter fill with a `--nav-accent` icon.
- **Table header = light row** (`bg-surface-subtle`, muted labels; the sorted column is darker).
  This replaces ADR-035's navy header band.
- **One list card:** the views tabs, toolbar, filter chips, bulk bar, rows, pager and shortcut
  hints sit on one surface. Summary tiles sit above it. Filter chips are blue-tinted (`brand-accent`).
- **List page title block** (`ListPageHeader`): an eyebrow naming the section, the list name at
  display size, one summary line (count and amount), and the page actions (the primary carries
  its `N` shortcut).
- **One state per list row:** a list shows a single derived state pill: what the reader acts on
  next (for invoices: Draft, To post, Overdue, Part paid, Not due, Paid, …), computed from the
  stored axes and the balance (`invoice-list-state.ts`). Nothing new is stored. The detail page
  keeps both status axes.
- **Entity avatars:** a client's or supplier's initials on a stable tinted square
  (`entityTintClass`), with dark ink on a tint and never a status colour's solid fill.
- **Side sheet, for quick-create only** (`SideSheet`, from the approved mockups): adding a missing
  related record without leaving a form, such as "+ Create client" on a sale invoice. This amends
  ADR-039 for that one case. Editing a record, previews and confirmations stay in `FormDialog`.
- **Forms use the ADR-037 kit:** `FormActionBar` (back, one Save, Discard with an unsaved-changes
  confirm, save-state dot, lifecycle stepper), `FormErrorSummary` (counted, each field a link
  that focuses it, and the same message under the field), `FormGroup`, `LineItemsEditor` and
  `MoneyInput` / `QuantityInput`. Enter inside a line never submits; on the last line it adds the
  next one. The hand-typed sale invoice moved onto the kit on 2026-10-28.
- **Loading, empty and failed states:** loading shows the matching skeleton (`SkeletonTable`,
  `SkeletonForm`, `SkeletonRecord`), never a blank area. Empty uses `EmptyState` (what will appear
  here, plus the action that adds it). A failed load uses `LoadError` (`components/load-error.tsx`):
  what failed, plus "Try again" whenever the screen can refetch. A list never shows a failed load
  as "no records". `PlatformDataGrid` does all three for lists. Step 2 (2026-10-28) moved 27
  screens that showed a bare error with no retry onto `LoadError`.
- **Undo by delay** (`useUndoableAction`, Step 2g): a reversible list command (cancel a draft)
  removes the row at once and shows a toast with Undo (or Z) for 8 seconds. The command is sent
  only when the window closes, so Undo never needs a server rollback. Leaving the page sends what
  is pending. Never used for posting, payments, or anything another person waits on; those keep
  a confirm dialog.

### 3b. Rollout to Projects, Procurement and Administration (built: Step 8, 2026-10-29)

- **Lists:** material requests, purchase orders, goods receipts, suppliers, buyer advances, projects,
  users and roles use the §3a list page: title block with a summary line, built-in and saved views
  with live counts, the shared Filter panel, groups, totals and export. Clients and suppliers carry
  their tinted avatar; people carry a plain initials avatar.
- **Server search stays where it matches more than the columns show** (the procurement lists search
  line descriptions): `useListViewState(…, { searchOnServer: true })` sends the search to the API
  and the grid's `searchedUpstream` does not search the returned rows again, while filters, views,
  sort, groups, paging and export still run on them. A view's count is shown only while its
  search (and any API-side filter) is the one the rows were fetched with.
- **One state per row** extends to buyer advances (with buyer, settled, to post, …).
- **Totals never show $0 for "nothing to add up"** — a column with no figure on any row totals "—".
- **Audit logs** are a server-mode list (`GET /audit-logs` pages, searches, filters and names the
  person) with an export that reads the whole filtered trail, not the page on screen.
- **Failed loads and loading:** every failed load in these modules offers Try again on the query
  that failed; whole-page placeholders are the matching skeleton.
- **Message keys:** `src/i18n/used-keys.test.ts` fails CI when the code asks for a key the English
  catalogue lacks (Step 8 found five that rendered as dotted paths in production).
- **Setup screens** (units, materials, categories) keep no title block — the module header names
  them (ADR-035) — but gain export.

## 4. Grill decisions for later steps (not yet built)

| Topic | Decision |
|---|---|
| Phone flows | An installable web app (PWA), not a native app. **Built 2026-10-28 (Step 7):** manifest + service worker, `/site` Home (sent back first, then four big buttons), reusing the ADR-044/045 photo queue. Unsent photos wait on the phone (IndexedDB) and go when signal returns (owner decision 2026-10-28). Whole forms too (Step 7d): a material request or delivery note sent with no signal is queued on the phone and sent later; the create endpoints take a `clientRef` so a resend never makes a second record. |
| Reading photos (receipts, delivery notes) | Built now, alongside the phone flows, using free or open models behind a pluggable reader with a configurable provider (OpenRouter free vision models or self-hosted). A person always confirms the reading before anything is saved. **Decided 2026-10-28 (owner):** OpenRouter free models; allowed, but off per company until an administrator turns it on, with the provider named; every reading logged. Money is read only on finance's screens (the collector never enters money, ADR-044/045). **Built (Step 7):** `platform/document-reader`. |
| Saved table views | Personal views, plus views an admin publishes to everyone. |
| Approvals | One Approvals tab with a count, not an inbox per module. **Built 2026-10-28 (ADR-049).** |
| Finance Home | A dashboard, with the setup checklist shown until setup is complete. **Built 2026-10-28 (Step 4):** `GET /finance/home` and the Finance module's landing `/finance`. |
| Attachments | Every finance document takes supporting files; they freeze when it posts. **Built 2026-10-28 (Step 4):** one table per owner, one permission-gated service (`finance-attachments`), one shared panel. |
| Setup checklist and import | "Get {company} ready": eight steps with a progress bar, then an import wizard (Upload → Match columns → Check → Import) that shows problems first and spells out the result before saving. **Built 2026-10-28 (Step 5):** `GuideStep.optional`; `finance/import/:kind` (check, import); balances become `OPENING_BALANCE` open items, closed once the opening journal posts; "download problems" is a CSV (no spreadsheet-writing dependency added). |
| Ledger dimensions | Every posting line names its party and project. **Decided 2026-10-28 (owner): fix forward only** — posted history is never edited (the 2026-09-28 rule), and no correcting entries are posted for tags, which would clutter bank reconciliation. History by client or supplier is read from the source documents. **Built 2026-10-28 (Step 6):** invoice and credit-note lines (AR, revenue, VAT, and their reversals) carry client, project, contract, and on VAT the tax code; receipt bank lines carry the client; supplier-payment bank lines the supplier. |
| Bank reconciliation | **Built 2026-10-28 (Step 6):** statements imported from the bank's own export and matched one-to-one to ledger lines on the bank's GL account; charges and interest posted from their line; reconciled only at zero difference, then frozen. Matching never edits a posted journal. Reconciliation of an account starts with its first statement: earlier ledger lines are brought forward in its opening balance. |
| Close checklist | **Built 2026-10-28 (Step 6):** one live checklist per month mirroring the close gate (so the list and the Close button never disagree); bank reconciliation blocks closing only when the organisation's banking policy says so. |
| Finance reports | **Built 2026-10-28 (Step 6):** receivables and payables aging (`/finance/aging/:side`) and the VAT report (`/finance/vat-report`), read from the ledger so it ties to the VAT account. |
| Navigation | An icon-only sidebar that can be collapsed; the Payables count and the period label stay. |

## Consequences

- A new tenant gets a working platform with neutral defaults and adapts it from Administration,
  with no code change.
- Token changes reach every screen at once. Screens that hard-coded a size or colour (an arbitrary
  `text-[Npx]` or a hex value) do not follow the tokens and must be fixed when they are touched.
- Future screens are reviewed against §3. A deviation needs an amendment to this ADR.
