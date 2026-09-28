---
Status: proposed
Date: 2026-09-27
Owner approval: the four decisions in the flow plan were approved on 2026-09-27 (Abdulsalam). This ADR records the anatomy that implements them and needs his sign-off.
Builds on: ADR-028 (NAV-001…006), ADR-034, ADR-035
Plan: docs/design/project-workspace-flow-plan.md
---

# Project workspace anatomy

## Context

ADR-035 moved every module onto a shared shell, but it exempted the project workspace. Its
migration was left as "its own decision". A review of production screenshots of a live project,
`ACCO-HDN-26-0005`, then showed each project tab built from different parts:

- **Header actions:** the header's right side had real actions on Overview but a ghost text link on the other seven tabs.
- **Sub-navigation:** five implementations. Some showed an icon on every view, some only on the active view, and some had none. Two of them showed stray scroll arrows.
- **Screen headings:** written by hand in each tab. Two tabs used an `h1` inside a workspace that already owns the page's `h1`.
- **Summary strips:** three separate implementations, with three label styles. Commercial showed "$0.00" where Finance showed "0.00" for the same project.
- **Terminology:** "VAT" and "Sales tax" were used for the same tax. "Net billed", "Billed" and "Invoiced" were used for the same figure. There were four spellings for an invoice that has no number yet.

## Decision

A project tab is built from these parts. Nothing else is used for these jobs.

| Part | Component | Rule |
|---|---|---|
| Workspace header | `ProjectWorkspaceShell` | `h1` project name, one status pill and the meta line. The right side is `ProjectActionsPanel` on **every** tab: one primary action for the lifecycle state, then a kebab. |
| Tab bar | `WorkspaceTabs` | Unchanged (NAV-003). |
| Screen heading | `WorkspaceSectionHeader` | An `h2`, a one-line description, and optionally the screen's own primary action (NAV-002). |
| Views inside a tab | `WorkspaceSubNav` | Underline style, **text only** (icons belong to the tab bar), and links, so every view has its own URL. Progress is the one exception until PR 5: it keeps state-driven `ViewSwitcher` buttons in the same style. |
| Summary figures | `MetricStrip` (`apps/web/src/components/widget`) | Hairlines, not boxes. Micro uppercase label, `text-h2` semibold value. A figure is coloured (`tone`) only for a real variance, such as overdue above zero. Finance's `MetricBand` keeps its per-figure basis line and uses the same label and value type. |
| Money with no currency | Server | The server falls back to the project's own currency, so a zero reads "$0.00". |

**Wording** (English catalogue):
- **Sales tax**, never "VAT". API fields (`vatAmount`) and account codes (`VAT_OUTPUT_PAYABLE`) keep their names.
- **Invoiced** is the gross of posted invoices, as shown on Billing & collection. **Net invoiced** is that figure less posted credit notes, as shown on the Overview. The two figures differ, so they must never share a label. The Overview note also counts the invoices not yet posted.
- **Not yet numbered** for a draft invoice.
- Titles and labels in sentence case.

The underline track of `ViewSwitcher` and `Tabs` draws its rule as an inset shadow, not a border. Items no longer need `-mb-px`, so nothing overflows the track.

## Consequences

- The header no longer changes shape as the reader moves between tabs. "Start project", or "Continue setup" while mandatory preparation is open, is reachable from every tab.
- A new tab must use these parts. A hand-rolled heading, sub-nav or strip is a review finding.
- The dashboard's `MetricStrip` values move from `text-h1` bold to `text-h2` semibold, one scale everywhere.
- Still open:
  - Moving Progress's views to routes (flow plan PR 5).
  - Project-scoped document routes (PR 4).
  - The brief's dropdown tab bar (decision 4: later).

## Amendment — 2026-09-28: sub-navigation pills; Progress views are routes

Owner-approved as part of the Progress redesign (flow plan PR 5).

- **`WorkspaceSubNav` is a row of quiet pills, on every tab** (Progress, Commercial, Finance,
  Procurement, Documents). An inactive view is plain muted text; the active view is a filled,
  primary-tinted pill (`bg-brand-accent`) with strong `brand-ink` text. Items stay text only and
  stay links, with `aria-current="page"` on the active one. An item may carry a count (a small
  round pill after the label, e.g. reports awaiting review); a zero count is omitted, never shown
  as "0". The underline treatment is no longer used for this row: the project tab bar above is
  the only underlined row, so the two levels never read as the same control. The row still scrolls
  inside itself at 375px.
- **Progress's views are routes**, not component state:
  `/projects/{id}/progress/{today|review|performance|setup}`. A view the reader cannot use is
  removed from the row, never disabled. The `ViewSwitcher` exception in the table above is retired.
- **Setup gaps come in two strengths.** A *hard* gap (no baselined BOQ, or no measurable work
  package — none at all, or only schedule-only phases) means nothing can be recorded, so Today,
  Review and Performance show one empty state naming the gap. A *soft* gap (a package with no BOQ
  items, or the server's `weightsComplete` false) never blocks field work: Today and Review render
  as normal, and Performance shows one notice that its figures are provisional. Plan & setup keeps
  the step current either way.
- **Landing.** `/progress` redirects to Plan & setup for a setup manager when there is a hard gap,
  or when setup is incomplete and they do not hold `record:progress`; otherwise Today for
  recorders, Review for reviewers, else Performance.
- **On Progress the tab heading carries no primary action**; each view owns its one primary.

This supersedes the "Views inside a tab" row's "Underline style" wording and closes the open item
"Moving Progress's views to routes".
