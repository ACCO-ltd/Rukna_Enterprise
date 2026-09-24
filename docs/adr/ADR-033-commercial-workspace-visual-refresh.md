---
Status: accepted
Date: 2026-09-24
Owner approval: Abdulsalam
---

# Commercial workspace visual refresh + platform design-token refinement

## Context

The Commercial tab was asked to be rebuilt against three pasted reference screenshots
(Overview / Contract & Milestones / Billing & Collection), with the explicit instruction to
change the shared `@erp/ui` design system rather than scope the change to Commercial alone.
`docs/reference/ux-doctrine.md` §1 is marked **CANONICAL** and states the token layer "is not
up for redesign" and that brand colours "do not change" — so this is recorded as a decision,
not a silent override, per AGENTS.md's conflict-resolution policy.

A second reference — an "Enterprise UI Foundation" design-system validation gallery, with an
explicit Design Tokens swatch (border radius, control height, spacing scale, typography,
semantic colours) and a canonical-components strip (buttons, inputs, checkboxes, radios,
status badges, progress/meter, alerts, empty states) — confirmed the target is a *refinement*
of the existing token values, not a different system: `@erp/ui`'s existing brand-primary,
badge-tone vocabulary, and most of the canonical-components strip already matched the
reference almost exactly before this ADR.

## Decision

**The token values move; the architecture doesn't.** `@erp/ui` stays a closed, semantic,
eslint-ratcheted token scale — that architecture is exactly what makes a four-line CSS edit
cascade correctly to all ~289 files that consume it, instead of requiring a per-screen
rewrite. Specifically (`apps/web/src/app/globals.css`, `packages/ui/src/components/card.tsx`,
`record-layout.tsx`, `button.tsx`):

- `--radius-panel`: 10px → 8px.
- `--control-height` / `--row-height`: 44px → 40px comfortable; compact steps from 36px → 34px.
- `--shadow-panel`: softened (both themes), reading closer to a flat `shadow-sm`.
- `Card`/`RecordHeader`/`RecordLayout` internal padding and macro gaps: 20px → 24px (padding),
  20px → 32px (inter-section gaps) — the reference's "24/32" spacing pairing.
- `Button` moved off a hardcoded `rounded-md`/arbitrary `shadow-[var(--shadow-control)]` onto
  the registered `rounded-control`/`shadow-e1` tokens (pre-existing drift, fixed so it moves in
  lockstep with the rest of the system) and gained a `link` variant for tertiary text actions.
- `--brand-primary` and the `success`/`warning`/`danger`/`historical` status-colour vocabulary
  are **unchanged** — they already matched the reference, and changing them would un-anchor the
  chart/series colour-encoding validation `globals.css` already documents.

**One architectural exception, narrowly scoped:** a new `TimelineIcon` component
(`packages/ui/src/components/timeline-icon.tsx`) permits a tone-mapped icon tile inside
timeline/activity-feed rows specifically, reusing `Badge`'s closed tone vocabulary rather than
a new palette. `ux-doctrine.md` §7's existing rule — one accent, one size, region-level only,
via `RecordPanel`'s `icon` prop — is otherwise untouched; see the amendment recorded there for
the exact boundary.

**Two new primitives**, filling the only genuine gaps found against the canonical-components
reference (everything else — buttons, inputs, checkboxes, radios, badges, progress/meter,
alerts, empty states — already existed): `Pagination` (`pagination.tsx`) and `TimelineIcon`.
Both exported from `packages/ui/src/index.ts`.

**Amends ADR-030 CD16.** ADR-030 (2026-09-13) called for a 4-tab layout with the Overview tab
removed; the shipped code (`commercial-nav.tsx`) instead kept a 3-tab layout with Overview as
the universal landing tab. This ADR records that as the standing decision rather than treating
ADR-030 as still describing the live IA. It does not reopen ADR-017/023/026/029/032's billing
math, tie-out, or lifecycle invariants.

## Commercial tab: gap-fill wiring

Auditing the three sub-tabs against the reference screenshots found the workspace almost
entirely wired to real data already — this is overwhelmingly a restyle. The concrete gaps
closed alongside the restyle:

- **Overview** — a "Commercial position" panel (contract reference/status/next invoice
  status), composed from data already on the existing summary/overview response; the
  already-built `CommercialActivity` feed, previously mounted only on Contract & Milestones,
  now also renders here.
- **Billing & Collection** — a client-side status-pill filter (Open/Drafts/Paid) and search
  box over the already-fetched invoice list; "Record delivery" and "Complete invoice" row
  actions (wrapping the existing `recordPackageDelivery`/`issuePackage` mutations, previously
  reachable only from Contract & Milestones).

No new API endpoints were required for any of the above — all data and mutations already
existed in `hooks/use-commercial.ts` / `commercial-api.ts`.

## Explicitly out of scope

- Rebuilding the live Procurement/Accounting/Project-Cost-Control screens to match the
  design-system gallery's illustrative example cards — those cards are a demonstration
  surface (`/design`), not a spec for rewriting those modules' actual layouts.
- A pixel-level design-review pass of the ~250 other files across BOQ, Procurement, Finance,
  Admin, Accounting, IPA/IPC, Contracts, Documents, Team, Receipts, Workflows. They inherit
  the token refresh automatically wherever they already consume `@erp/ui` correctly; full
  manual verification of all of them is separate, later work.
- Migrating the Progress tab off its scoped `ref-ui.tsx` kit onto the refreshed `@erp/ui`.
- Fixing the pre-existing `docs/reference/api-reference.md` §6.9b drift (several live
  Commercial endpoints undocumented) — a known, pre-existing gap, not this change's job.
