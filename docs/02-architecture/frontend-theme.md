# Rukna Frontend Theme

Status: Active

Rukna uses semantic CSS tokens for every color consumed by application and shared UI
components. Light, dark, and system preferences are first-class display modes.

**The rendered reference is `/design`.** Every token and every primitive is on that page in
every state, with switches for theme, direction, and density. No shared component is approved
from a description — it is approved there, flipped through all three switches.

## The scales are closed sets

A token layer only becomes a system when the set of allowed values is finite and enforced.
Before Phase 0 the color tokens were the only enforced layer, and the codebase had accumulated
14 arbitrary pixel font sizes, 290 ad-hoc radius classes, 68 verbose arbitrary box-shadow
spellings, and three hardcoded transition durations. `--radius-panel` had been declared and
referenced by nothing at all — it was never registered with Tailwind, so no utility existed and
`rounded-lg` took its place 166 times.

| Scale | Values | Utilities |
|---|---|---|
| Type | 8 steps | `text-display` `text-h1` `text-h2` `text-h3` `text-body` `text-body-sm` `text-caption` `text-micro` |
| Radius | 3 + pill | `rounded-control` (6px) `rounded-panel` (10px) `rounded-container` (14px) `rounded-full` |
| Elevation | 3 + focus | `shadow-e1` resting · `shadow-e2` raised · `shadow-e3` overlay · `shadow-ring` focus |
| Motion | 3 + 1 curve | `--motion-exit` 120ms · `--motion-enter` 180ms · `--motion-layout` 240ms · `ease-brand` |
| Density | 2 | `h-control` `h-row` — 44px comfortable, 36px compact |
| Space | 4pt grid | `1 2 3 4 5 6 8 10 12 16` (4–64px), plus half-steps `0.5 1.5 2.5 3.5` for dense controls |

Static scales live in `@theme` in `globals.css`; values that change between light and dark stay
in `:root` and are bridged through `@theme inline`. That split is what lets `shadow-e2` keep a
per-theme value while `rounded-panel` stays constant.

`eslint.config.mjs` enforces all of it. The rules are `warn` while Phase 1 migrates the
pre-existing call sites; each becomes `error` as the last commit of the module that finishes
its migration, so the ratchet only ever tightens.

### Two deliberate non-obvious choices

**Weight is never baked into a `text-*` token.** It stays an explicit `font-*` at the call
site, so composition order cannot surprise anyone. 600 is the heaviest heading weight below h1
because Inter is loaded variable and would render 650 faithfully while IBM Plex Sans Arabic is
loaded at fixed 400/500/600/700 — a 650 heading would be 650 in English and 700 in Arabic on
the same document.

**Reduced motion collapses durations to 1ms, not 0.** A transition that never fires
`transitionend` leaves some Radix panels mounted forever, so `animation: none` would trade a
motion-sensitivity fix for a stuck dialog. One global rule in `globals.css` covers the whole
product; no component implements it.

## Token ownership

- Brand tokens control product identity: primary action, selected navigation, and focus.
- Surface tokens control canvas, panels, elevated overlays, hover, and selected states.
- Status tokens control lifecycle meaning and remain platform-owned.
- Component code consumes semantic Tailwind utilities; it does not use palette utilities or
  hardcoded color values.

Tenant branding may override brand tokens only. It must not override status, danger, warning,
success, surface, border, or text tokens because those carry accessibility and business meaning.
Semantic color is never the accent, and the accent never carries state meaning.

### What each colour means

The rule above is easy to agree with and easy to break. The BOQ workspace broke it on its
first pass: the pricing-completeness bar was `brand-primary`, so a fully priced BOQ and a
half-priced one looked identical, and every accent on the screen — active tab, links, both
primary buttons, the progress bar, the selected row — was the same blue. The screen carried
plenty of information and no signal.

| Meaning | Token | Carried by |
|---|---|---|
| Complete, approved, on track | `success` / `success-subtle` | Baselined and posted badges, a 100% progress bar, "matches approved baseline", reconciled figures |
| In progress, needs attention | `warning` / `warning-subtle` | Draft badges, a sub-100% progress bar, rows missing required data, readiness and exception banners |
| Blocking or destructive | `danger` / `danger-subtle` | Validation failures, discard and delete, over-claim, currency mismatch |
| Historical, superseded | `historical` / `historical-subtle` | Superseded versions, reversed journals, prior revisions |
| **Interactive** | `brand-primary` | The single primary action, links, the active tab, the focus ring — **and nothing else** |
| Structure and figures | `foreground` / `muted-foreground` | Codes, descriptions, units, and money |

Two consequences worth stating outright, because both are counter-intuitive:

**Money stays neutral.** Colouring figures turns a dense table into a heat map and the eye
stops landing on the number. Colour belongs on the *state* beside the figure — a row edge, a
badge — not on the figure.

**A progress indicator is a status carrier, not an accent.** If it can reach a finished
state it must look different when it gets there. `warning` while incomplete, `success` at
100%. A brand-blue progress bar is the accent pretending to carry state, which is exactly
what the ownership rule forbids.

**One primary per screen.** `brand-primary` marks the single action the user should take
next. Two blue buttons compete and neither reads as the answer; a *disabled* blue button is
worse still, because the one thing drawing the eye is the one thing that cannot be done.
Where the obvious next action changes with state, resolve it in a pure module and let the
button follow — see `apps/web/src/features/boq/boq-next-step.ts`.

## Theme behavior

The account menu exposes Light, Dark, and System preferences. The non-sensitive display
preference is stored under `rukna.theme.preference`. A pre-hydration script resolves the active
theme onto `data-theme` on the root element to prevent a light flash in dark mode. System mode
tracks `prefers-color-scheme`; storage events synchronize open tabs.

## Density behavior

Density is stored under `rukna.density.preference` and resolved onto `data-density` by the same
pre-hydration script, so a compact user never sees one comfortable frame first. It has no
`system` mode — the operating system has no notion of table density, so there is nothing to
track.

Comfortable is the default because most screens are read, checked, and approved rather than
typed into. Compact exists for the screens where someone spends a whole shift entering rows —
BOQ editors, manual journals, the account ledger, the trial balance — and shows roughly a third
more data per screen.

`density-store.ts` deliberately mirrors `theme-store.ts` rather than sharing an abstraction
with it: the theme has a `system` mode that resolves against a media query and density does not,
so merging them would mean one shared module with a branch inside it.

## Verification

Every new shared component must be verified in light and dark themes, English LTR and Arabic
RTL, and at the mandatory 375px mobile viewport. Status presentation always includes a text
label and an icon; color alone never communicates lifecycle meaning.
