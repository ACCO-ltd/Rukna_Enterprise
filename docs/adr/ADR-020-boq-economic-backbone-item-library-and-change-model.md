---
Status: accepted
---

<!-- Domain-approved by Eng Ahmed Shirie 2026-08-17. Variation branch (CONST-BOQ-025) remains Sprint 6, blocked on #51. -->

# BOQ as the project's economic backbone: item library, one-BOQ UX, and the change model

## Status note

Extends ADR-016 (BOQ workspace contract). Engineering shape owned by Abdulsalam; the domain
rules (change classification, variation routing, cost↔revenue firewall) are gated on **Eng Ahmed
Shirie** — the variation/ChangeOrder work is already roadmapped as Sprint 6 (blocked on #51) and
the resource→cost work as Sprint 7. **Near-term (Round 2 UX):** the item library, the one-BOQ
UX, capability roles. **Sprint 6/7:** the post-baseline change classifier's branches. This ADR
records the target so all of it stays coherent.

## Context

Stop-4 review confirmed the BOQ models (ADR-016) are sound but three product gaps remain: (1) QSs
retype identical work items across projects, creating dirty master data and unreportable scope;
(2) versioning is technically correct but its UX invites picking stale versions from a dropdown —
a purchasing officer could raise procurement against a superseded BOQ; (3) there is no guided path
for a need discovered *after* baseline, so the only affordance is "add BOQ item," which corrupts
contract value. Underlying all three: the BOQ is treated as a data-entry screen rather than the
project's shared scope-and-value model that planning, procurement, progress, commercial
certification, and financial reporting all derive from.

## Decision

### CONST-BOQ-019 — BOQ is the project economic backbone
The BOQ (scope + quantities + rates) is the single shared model from which Programme, Procurement
(commitments/actual cost), Commercial (IPA/IPC revenue), and Project Financial Position derive. It
is not a standalone data-entry screen. This principle governs the rules below.

### CONST-BOQ-020 — Reusable Standard Work Items (BOQ Item Library)
An org-level `BoqItemLibrary` of reusable *work items* — `code`, `description`, `defaultUnit`,
`measurementMethod`, `pricingBasis`, `category`, `active`. It is **distinct from the procurement
`Material` catalogue**: a BOQ item is scope ("Supply and cast RC C25 — m³"); a material is a
procurable good ("cement"). Entry UX: search item → select → unit auto-fills → enter quantity
(+ rate) → add. Unknown item → dialog: **"Use once"** or **"Save to library & add"** — the
catalogue grows just-in-time from real work, never via a Settings→Create ceremony.

### CONST-BOQ-021 — No authoritative library rate
The library does **not** hold a `defaultRate` treated as truth (rates vary by location, market,
year, spec, currency). At most it surfaces `lastUsedRate` as *assistance* ("Last used $102/m³ on
Project X"). A governed rate library / cost book is a separate future domain, introduced only from
evidence.

### CONST-BOQ-022 — Capability-based BOQ roles
BOQ editing authority is modelled as capabilities, not department names: `BOQ_SCOPE_EDITOR`
(sections/items/quantities), `BOQ_COST_EDITOR` (rates), `BOQ_APPROVER` (baseline/revision
approval). ACCO assigns them to whoever does the work (QS, estimator, cost engineer) — never
hardcode `FINANCE_ROLE → edit rate`.

### CONST-BOQ-023 — One BOQ, not "versions" (UX)
Users see **"BOQ — Current Baseline"** with total, approval date, and a **Recent Changes** feed
(what/was→is/who/when), plus a **Revision History** timeline. There is **no version dropdown of
peers.** Selecting a historical baseline enters an unmistakable **read-only** mode banner: *"Viewing
historical BOQ — not used for current procurement, progress, certification, or reporting."* A
superseded baseline is **never valid for a new operational transaction.** Reuses the `isEffective`
pattern (IPC) and the existing compare panel.

### CONST-BOQ-024 — Pre-baseline free edit; post-baseline classified change
- **Before baseline:** free editing (add/edit/delete/reorder sections, items, quantities, rates)
  with ordinary audit — no `v1.1/v1.2` churn. `[Baseline BOQ]` creates the first immutable
  contractual baseline.
- **After baseline:** no direct destructive edit. Changes split by nature:
  - **Metadata correction** (description typo, note, attachment, classification) — does not alter
    contractual value/measurement → allowed as a controlled, audited correction.
  - **Commercial/scope change** (quantity, rate, unit, measurement method, pricing basis, added or
    deleted scope) → requires a formal revision/variation → approval → new effective baseline.
  Fixing "Cermaic" must never require a full variation; changing a quantity always must.

### CONST-BOQ-025 — Post-baseline new-need router + cost↔revenue firewall
After baseline, site/QS users act via **`Request Unplanned Requirement`**, classified before it
touches procurement or the BOQ:
```
○ Resource for existing BOQ work  → MR/PO linked to the BOQ item (no BOQ change)   [Sprint 7 cost]
○ New/changed client scope        → Variation/ChangeOrder → BOQ revision            [Sprint 6]
○ Internal omission / unplanned    → project cost, recoverable:No, margin impact     [Sprint 7]
○ Emergency requirement            → fast-path of the above, reconciled after
```
**Cost↔revenue firewall (shared with ADR-018 CONST-MATCH-013):** a new *cost* never automatically
becomes new client *revenue*. The system routes each need to the correct commercial treatment so a
site engineer is never expected to understand contract law — but the client BOQ/contract value is
never silently changed.

## Considered options
- **Remove BOQ versioning to simplify UX (rejected).** Would destroy the contractual basis that
  certified/paid amounts reference. The fix is UX (one-BOQ view), not removing versions.
- **`defaultRate` in the library (rejected).** Becomes false authority months later; `lastUsedRate`
  as assistance is safer.
- **`+ Add BOQ Item` after baseline (rejected).** Corrupts contract value; replaced by the
  classified router (CONST-BOQ-025).
- **Department-named edit roles (rejected).** ERP roles follow organizational responsibility, not
  generic department labels.

## Consequences
- **Round-2 (near-term):** `BoqItemLibrary` + fast entry (CONST-BOQ-020/021), one-BOQ UX
  (CONST-BOQ-023), capability roles (CONST-BOQ-022), pre/post-baseline edit rules
  (CONST-BOQ-024, metadata-correction path).
- **Sprint 6/7:** the router branches (CONST-BOQ-025) — variation→revision (Sprint 6), resource &
  unplanned-cost→project cost (Sprint 7). `boqNodeId` already flows into MR/PO/commitment, so no
  procurement redesign.
- **Preserve for later:** BOQ work item → resource breakdown (materials/labour/equipment/
  subcontract). Do not conflate BOQ items with materials now (Sprint 7+).
- Gated on Eng Ahmed for the domain rules; variation work already blocked on #51.
