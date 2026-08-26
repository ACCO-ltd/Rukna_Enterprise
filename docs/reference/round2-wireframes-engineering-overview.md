# Round 2 — Stage 2 Wireframes: Project Workspace Overview reshape

Status: **Low-fidelity, for review before implementation.** Structure/behaviour, not pixels —
colour/spacing/tokens governed by `ux-doctrine.md` + `frontend-theme.md`. Tokens and Rukna colours
unchanged.

Pilot sub-slice of the **Engineering delivery flow** (first slice, cross-cutting: every Engineering
tab inherits the shell). Traces to `round2-audit-engineering-flow.md` findings **P1, P2** (+ trivial
**A1**). BOQ (B1) is the reference target this reshape moves the Overview toward.

Legend: `●` status/attention dot · `◆` accent (primary/interactive) · `·····` hairline rule ·
`[card]` opt-in bordered panel (earns it: bounded + linked sub-content).

---

## Problem (from the grill)

The Overview is *a metric strip done right sitting on six bordered cards done wrong*. Programme shows
**three times** (shell strip tile, lifecycle strip, and a "Programme" card); Client/Contract/PM
restate the shell. The one thing that answers "what needs me here" — the guidance panel backed by
the already-built `GET /projects/:id/workspace-guidance` — is **buried under the field dump**. This
is the "card around everything" anti-pattern (doctrine §2.1/§7), the same disease the portfolio
dashboard had.

## Target

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Projects › Hodan District Office Tower                                    ⌘K   AD  │ ← shell (keep)
│ Hodan District Office Tower   ● Active            [ ◆ primary action ]  [ ⋯ ]       │
│ ●──────●──────◐──────○──────○   Preparation·Active·PC·Closeout·Closed  (lifecycle)  │ ← keep (P4)
│ CONTRACT VALUE   PROGRESS   CERTIFIED TO DATE   OUTSTANDING                         │ ← the ONE
│ $4,500,000.00    62%        $2,790,000.00       $410,000.00                         │   metric strip
│ ──────────── │ ────────── │ ──────────────── │ ──────────                            │   (shell owns it)
├──────────────────────────────────────────────────────────────────────────────────┤
│  Overview body                                                                     │
│                                                                                    │
│  NEEDS ATTENTION                                                                   │ ← LEADS (P1)
│  ·································································· from workspace-guidance │
│   ● IPA-0003 awaiting your approval            submitted 2 days ago    [ Review → ]  │
│   ● Guarantee expires in 12 days                                        [ Open → ]   │
│   (or, empty:  “No immediate attention required.”)                                  │
│                                                                                    │
│  PROJECT DETAILS                                                                   │ ← ONE hairline
│  ·································································· (2-col definition list) │   section, NO
│   Client            Baraka Real Estate LLC    Commercial model   Client contract    │   per-fact cards
│   Main contract     ACCO-2026-V26NG           Programme          1 Feb – 31 Aug 26   │   (P1/P2)
│   Project manager   System Admin              Participation      Sole                │
│   (facts NOT already in the shell strip; no Programme/stage/value restated)         │
│                                                                                    │
│  ┌ Delivery progress ──────────┐ ┌ Commercial snapshot ───────┐ ┌ Cost commitments ┐│ ← cards KEEP
│  │ 62% · 18 of 29 packages     │ │ Certified $2.79M · Paid…    │ │ Committed $1.14M… ││   (each owns a
│  │              [ Progress → ] │ │           [ Commercial → ] │ │   [ Procurement → ]││   link + sub-
│  └─────────────────────────────┘ └────────────────────────────┘ └──────────────────┘│   content)
└──────────────────────────────────────────────────────────────────────────────────┘
```

### What changes
1. **Guidance panel leads** the Overview body (P1). It's the project-scoped "requires your action"
   queue — same role the portfolio dashboard's queue will play. Backed by the existing feed; no
   backend work. Empty state is an honest one-liner, not a hidden panel.
2. **The three identity cards collapse to one hairline "Project details" section** (P1/P2) — a 2-col
   `DefinitionList`, no per-group borders. Only facts *not already in the shell strip* (drop the
   restated Programme/Current-stage/Contract-value/PM).
3. **The shell metric strip is the single summary** (P2). The Overview body stops rendering its own
   competing tile row — the shell already owns it (`project-workspace-shell.tsx`).
4. **Three summaries stay as cards** — Delivery progress, Commercial snapshot, Cost commitments —
   because each is a bounded summary that *owns a link and sub-content* (the doctrine's opt-in-panel
   test, §2.1). But each drops any row already shown in the strip.
5. **Keep** the lifecycle dots (P4), the header one-primary + overflow, breadcrumb, ⌘K — the shell's
   existing strengths, already doctrine-aligned.

### Mobile (375px)
Metric strip stacks (2-col hairline grid, as shipped on the dashboard). Guidance items are
full-width rows with a chevron-tap target ≥44px. The three summary cards stack single-column.
Definition list becomes single-column (label above value).

---

## Riding along: A1 (trivial correctness fix)
The Commercial applications table prints a raw cuid (`cmssv27jp004w…`) in the CERTIFICATE column.
One cell: render `certificateRef` (fallback `#certificateNumber`, else `—`), exactly as
`ipc-list-panel` already does. It's not on Overview, but it's a one-line professionalism bug worth
folding into this PR rather than deferring. *(If it complicates the diff, it moves to the token pass.)*

## Explicitly NOT in this slice
- Token re-skin of IPA/IPC/progress (X1) — the next slice.
- Progress tab reshape + the tab-in-tab product call (PR1/X3) — needs an Eng-Ahmed/owner decision.
- IPC wizard → form (C1/C2) — last, behind tests.
- RTL dead-code removal (P5) — its own broad pass.

## Component notes for Stage 3
- Reuse `MetricStrip` (shipped in the dashboard slice) if the shell strip isn't already it — unify.
- `DefinitionList`/`DefinitionRow` already exist in `@erp/ui` (used by `record-layout`) — use them.
- The guidance panel component already exists (`useProjectWorkspaceGuidance`); this is re-ordering +
  restyling to lead, not new data wiring.
- Structure with `SectionHeader` + hairlines; panels only for the three linked summaries.

## Build sequence (Stage 3 — pending review of this wireframe)
1. Overview reshape (P1/P2) — one PR, frontend-only, `frontend-engineer` → `qa-engineer`.
2. A1 cuid fix folded in.
Then browser-QA (light/dark/375, the guidance-leads layout, no duplicated facts) before merge.

## Owed live confirmation (does NOT gate this pilot)
Overview was walked live (desktop + 633px). The IPA *detail* and IPC *wizard* still owe a live walk
before *their* slices are wireframed — irrelevant to this Overview pilot.
