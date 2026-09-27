---
Status: proposed
Date: 2026-09-27
Owner approval: pending (Abdulsalam)
---

# Design-system foundations: status registry, primary button, money display, one icon set

## Context

A frontend audit on 2026-09-27 found the product reading as several apps stitched together.
The biggest source of that was status colour:

- About 30 separate status→tone maps disagreed with each other. `APPROVED` was blue on one
  screen, purple on another and green on a third. `CANCELLED` was red, grey or purple
  depending on the page.
- The central map (`formatStatus` in `lib/format.ts`) was used by 3 screens.
- The in-progress tone was brand blue, which contradicts `frontend-theme.md`'s rule that
  `brand-primary` is interactive-only.

Other problems the audit found:

- Two icon libraries were in use (Lucide and Phosphor).
- There was no shared way to render a money figure the viewer is not allowed to see
  (ADR-029's money-blind roles). Screens printed `$0.00` or left blanks.

A design system was commissioned from Claude Design against
`docs/design/claude-design-system-brief.md`. Batch 1 of that design (Foundations: tokens,
status registry, money rules, iconography, and Button / StatusPill / MoneyDisplay /
EmptyState) is what this ADR adopts. Later batches (navigation shell, list page, forms,
document editor) will each get their own ADR or amendment.

## Decision

### 1. Six canonical status tones, one registry

`Badge` gains six canonical tones:

| Tone | Meaning |
|---|---|
| `neutral` | Draft or not started |
| `progress` | Submitted, pending, open, partially done |
| `attention` | Needs action, exception, expiring, returned |
| `success` | Approved, posted, active, matched, verified |
| `danger` | Rejected, failed, overdue, disputed |
| `historical` | Closed, cancelled, superseded, reversed, withdrawn, archived |

Supporting changes:

- **New token pair** `--progress` / `--progress-subtle` for the in-progress tone:
  - light `#475467` / `#edeef0`
  - dark `#c3cad6` / `#373a3f`

  It is a slate, deliberately not brand blue.
- **Deprecated aliases.** The old tone names (`info`, `live`, `accent`, `warning`) stay as
  aliases that render as `progress`, `success`, `historical` and `attention` respectively,
  so no call site breaks.
- **Status tones are looked up per vocabulary** in `apps/web/src/lib/status-registry.ts`,
  never from a bare string. The same word can mean different things: an ACTIVE project is
  `progress` (the work is underway), while an ACTIVE supplier is `success` (the record is
  usable). The registry covers every lifecycle vocabulary in the schema.
- **Components:**
  - `StatusPill` in `@erp/ui` is a pill that always carries its dot.
  - `StatusText` is the quiet dot + text form for secondary axes, with an optional axis label
    ("Posting: Pending").
  - `StatusBadge` in the app is `StatusPill` plus the registry.
- **One primary pill per document.** A document shows exactly one pill, its document status.
  The posting and match axes render as `StatusText`.
- **Rule: no screen keeps its own status→colour map.** A new vocabulary is added to the
  registry.

Tone changes that are deliberate, not regressions:

| Status | Was | Now |
|---|---|---|
| APPROVED | blue or purple | `success` |
| CANCELLED, CLOSED | red or green | `historical` |
| Posting FAILED | warning | `danger` |
| Match APPROVED_EXCEPTION | warning | `success` |
| Project / contract ACTIVE | green | `progress` (the work is underway, not finished) |
| DRAFT | warning (per `frontend-theme.md`) | `neutral` |

### 2. Primary button is navy ink

`Button`'s default variant moves from `brand-primary` (blue) to `brand-ink` (navy #172033,
light ink in dark mode). The reason is to keep a single meaning for blue: `brand-primary`
stays reserved for links, the focus ring and the selected tab, so the one primary action on a
screen reads as weight rather than as another link.

This amends `frontend-theme.md`'s "Interactive" row, which previously listed "the single
primary action" as a `brand-primary` carrier.

### 3. MoneyDisplay

`MoneyDisplay` in `@erp/ui` renders a money figure in five states that are never conflated:

- **known value:** `$48,250.50`
- **known zero:** `$0.00`
- **not applicable:** `—`
- **hidden by permission:** muted lock + `—`, with an sr-only label
- **loading:** skeleton

Supporting rules:

- The server omits hidden fields, so absence cannot distinguish hidden from not-applicable.
  The caller passes `hidden` from the capability flags.
- USD only (ADR-024). Negatives take a leading minus (open item below). Compact notation
  (`$1.2M`) is for KPI tiles only.

### 4. Lucide is the only icon library

`@phosphor-icons/react` is removed. Icons are drawn from `lucide-react` at 16/20/24px with
the default stroke width. Hand-rolled inline SVGs are retired as screens migrate.

### 5. Small alignments

- `EmptyState`'s icon tile uses `rounded-panel` and a hairline border, off an ad-hoc
  `rounded-xl`.
- `Progress` / `Meter` default tone moves from `brand-primary` to `progress`. A progress
  indicator is a status carrier (`frontend-theme.md`), not an accent.
- `Alert variant="success"` uses the `success` tokens instead of a brand-blue border, and
  moves to `rounded-panel`.
- **Fixed latent bug in `cn()`.** tailwind-merge did not know the closed type scale, so it
  read `text-caption`, `text-body-sm` and the other scale classes as colours. As a result,
  `cn('text-brand-on-primary', 'text-caption')` silently dropped the colour; Avatar's white
  initials rendered dark, for example. The scale is now registered with
  `extendTailwindMerge`.
- `formatStatus` / `StatusToken` are removed from `lib/format.ts`. Their two callers
  (`StatusBadge`, `LifecycleCommandDrawer`) use the registry. `LifecycleCommandDrawer` takes a
  `statusVocabulary` prop and no longer uses hard-coded palette classes.

## Not changed

- Surface, border, text, success, warning, danger and historical token values.
- Radii, type scale, spacing, shadows and motion. Claude Design marked its shadow and easing
  values as placeholders, so the existing ones are kept.
- The existing solid `*-subtle` values are kept rather than adopting the design's derived
  12–16% alpha tints. They are visually equivalent and already brand-approved.

## Open items (decide in later batches)

- **Negative money format:** leading minus (current) vs parentheses.
- **Touch targets:** 40px controls vs the 44px touch-target rule in `apps/web/CLAUDE.md`.
  The proposal is a coarse-pointer size-up.
- **Chart palettes** (`chart-*`, `series-*`): unchanged, and the design has not yet
  specified them.

## Consequences

- Every status in the product now changes colour consistently from one file. Some statuses
  visibly change tone (see the table above). That is the point, but it is noticeable on
  first load after deploy.
- Every primary button in the app turns from blue to navy.
- Remaining `Badge tone="info|live|accent|warning"` call sites are deprecated. The eslint
  ratchet can ban them once migration is complete.
