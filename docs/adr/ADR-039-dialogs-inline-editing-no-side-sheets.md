---
Status: Accepted
Date: 2026-09-29
Owner approval: owner decision, 2026-09-29 (Abdulsalam)
Builds on: ADR-034, ADR-037
Supersedes: the side-sheet guidance in ADR-037 §Decision ("Use a side sheet for quick edits of a related record and for previews") and in docs/design/claude-design-system-brief.md §6.2 "Decision rule for containers"
---

# Dialogs, inline editing, and no side sheets

## Context

Editing surfaces in the app open in too many different containers. For the same kind of task a
user can get:

- a centred `Dialog` (often named a "drawer" or a "panel" in the code),
- a side `Sheet` docked to the edge of the screen,
- a hand-built panel with its own header, scroll and footer rules.

ADR-037 accepted this split. It said to use a side sheet "for quick edits of a related record and
for previews". In practice the split costs more than it gives:

- **Sheets cover the data they are about.** `boq-item-drawer.tsx` was already moved off a 420px side
  panel and back onto a centred dialog, because the panel covered the rate column the user needed
  to compare against.
- **Each container has its own anatomy.** Sheets had a pinned header and footer. Dialogs scrolled
  as a whole, so on a long form the Save button scrolled away. The hand-built panels did something
  different again.
- **Phones get three different behaviours:** a bottom sheet, a full-height side panel, and whatever
  the panel author chose.
- **Dismissal rules drifted.** Only some surfaces guard against closing mid-save, and almost none
  ask before discarding unsaved edits.

## Decision

Three containers, chosen by the task.

### 1. Dialog — the default

Use a **dialog** to create or edit one record, and for confirmations, previews and history.

Record forms, previews and history use `FormDialog` from `@erp/ui`. It has a pinned header (title,
optional subtitle, close), a body that scrolls on its own, and a pinned footer (actions end-aligned,
primary last). It is as tall as its content, up to about 90dvh.

| Size | Width | Use for |
|---|---|---|
| `md` | 560px | 1–6 fields |
| `lg` | 720px | a record form |
| `xl` | 960px | a record with a short list |
| `2xl` | 1200px | comparisons |

Each width is capped at `100vw - 2rem`. Rules that go with it:

- **Dismissal is guarded in one place** (`useDialogDismissGuard`):
  - `busy` blocks every way out while a save is in flight.
  - `dirty` asks "Discard unsaved changes?" before Escape, the overlay, the close button or a
    Cancel throws edits away.
- **Initial focus goes to the first field,** never to a footer button.
- **Long forms group their fields** with `FormDialogSection`.
- **A choice that changes which fields follow** uses `ChoiceCards`. Example: "Unit rate: Quantity ×
  rate" / "Lump sum: One fixed amount".
- **History inside a dialog or a rail** uses `ActivityTimeline`.

Short confirmations keep `ConfirmDialog` and the small `DialogContent` tiers.

### 2. Inline editing — values in a table

When the user is changing values that already sit in a table, edit them in the table. Examples:

- BOQ grid quantity, rate, description and unit
- work-package weights
- budget lines

Do not open a container to change one number the user is already looking at.

### 3. Full page — long line-item documents

Journals, invoices, purchase orders and similar documents stay on full pages (ADR-035, ADR-037). A
document with an open-ended list of lines does not fit in a dialog.

### Side sheets are retired

No screen uses `Sheet`. The existing sheets migrated to one of the three containers above (see
the inventory below), and PR 5 removed `Sheet` from `@erp/ui` (`packages/ui/src/components/sheet.tsx`
and its exports are gone). No legitimate non-form use remained — the app's mobile navigation does
not use it — so there is no exception to keep.

### Mobile

Below `sm`, a `FormDialog` fills the screen (100dvw × 100dvh). The header and footer stay pinned,
so the title and the primary action are always visible. No bottom sheets for forms and no side
panels.

## Migration inventory

This is the owner-approved plan of 2026-09-29. PR 1 (this change) is the foundation.

| PR | Scope |
|---|---|
| **1** | Foundation: `FormDialog` (+ Body, Footer, Section, Close), `ChoiceCards`, standalone `ActivityTimeline`, `useDialogDismissGuard` promoted to `@erp/ui`, `GET /units-of-measure` + `useUnitsOfMeasure()`, standard units seeded, this ADR. |
| **2–6** | The screens below, grouped by area. |

**Side sheets and drawers to replace:**

| Area | Surface | Becomes |
|---|---|---|
| BOQ | `boq-item-drawer` | `FormDialog` (unit picker from `useUnitsOfMeasure`) |
| BOQ | `boq-timeline-drawer` | `FormDialog` + `ActivityTimeline` |
| Progress | `dpr-entry-sheet` | `FormDialog size="xl"` — done in PR 3 as `dpr-entry-dialog` |
| Finance | `budget-editor-dialog` (a `Sheet`) | inline editing in the budget table — done in PR 5 as `budget-lines-editor` (Edit budget → table of inputs, fixed Cancel / Save budget bar; still one whole-version POST/PATCH) |
| Accounting | `bank-accounts` signatories sheet | `FormDialog size="md"` — done in PR 5 |
| Accounting | `invoice-document-preview` (mobile sheet) | `FormDialog size="2xl"` preview — done in PR 5 |
| Admin | `policy-version-comparison-sheet` | `FormDialog size="2xl"` — done in PR 5 as `policy-version-comparison-dialog` |
| Admin | `form-sheet-shell` | `FormDialog` — done in PR 5 as `form-dialog-shell` (`user-form-dialogs`, `role-form-dialogs`) |
| Project | `project-activity-sheet` | `FormDialog` + `ActivityTimeline` — done in PR 5 as `project-activity-dialog` |

**Ad-hoc dialogs to normalise onto `FormDialog`:**

- `record-payment-drawer`, `variation-detail-sheet`, `add-extra-work-drawer`
- `boq-classifier-drawer`, `boq-compare-signed-panel`
- `po-amend-sheet`
- `contract-changes-panel`, `payment-schedule-panel`
- `lifecycle-command-drawer`, `role-governance-sheet` (done in PR 5 as `role-governance-dialog`)
- `receipt-allocations-panel`, `ipa-items-panel`, `ipa-deductions-panel`

PR 5 also normalised the remaining form and preview dialogs in Finance, Accounting, Admin and
Workflows: the three posting previews (client invoice, supplier bill, supplier payment) now share
one `PostingPreviewDialog`; the chart-of-accounts create/edit/import, open-fiscal-year and
configure-bank-account forms each own a `FormDialog`; and the workflow policy draft, clone,
lifecycle-transition and edit-rule dialogs moved onto `FormDialog`.

The design-system gallery's `Sheet` specimen (`patterns-section.tsx`) was removed with `Sheet`.

**Sheets retired.** Nothing in `apps/web` or `packages/ui` imports `Sheet` any more.

## Consequences

- One editing container with one anatomy. A user learns it once: the title stays at the top, Save
  stays at the bottom, Escape asks before throwing edits away.
- Phones get one behaviour, full screen, instead of three.
- Tables become the place where values are edited. Some screens (the budget editor) need an
  inline-editing treatment rather than a container swap, which is more work than a reskin.
- `Sheet` stayed in the library, marked retired, until PR 5 removed it. A side panel is not
  reintroduced without a new ADR.
- Wide comparisons that used an `xl` side sheet move to a `2xl` dialog. Anything wider than 1200px
  belongs on a full page.

## Not changed

- `ConfirmDialog` and `DialogContent` stay for confirmations and short actions.
- The full-page rules for documents and master-data creation (ADR-035, ADR-037).
- Tokens, radii and motion (ADR-034).
