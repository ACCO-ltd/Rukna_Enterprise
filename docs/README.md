# Rukna Documentation

Documentation is layered. **Read top to bottom.** Higher layers are authoritative about *status*;
lower layers hold detail and history.

```
Code + tests
    ↓ verified into
01-capability-matrix.md      ← single source of truth for WHAT IS BUILT
    ↓ organised by
domains/ + 02-domain-boundaries.md + 03-business-flows.md
    ↓ detailed by
reference/ (domain-model, api-reference, accounting-event-catalog, SAD)
    ↓ decided by
adr/ (immutable decision history)
```

## Source-of-truth rule

If two documents disagree about whether something is implemented, **`01-capability-matrix.md`
wins** — it is verified against the code. Fix the other document.

## Start here (authoritative overview)

| File | What it answers |
|---|---|
| [`00-system-map.md`](00-system-map.md) | The mental model — domains, the three flows, two ledgers, the control triangle. Read first. |
| [`01-capability-matrix.md`](01-capability-matrix.md) | **Implementation truth map** — built / partial / missing, backend vs frontend. |
| [`02-domain-boundaries.md`](02-domain-boundaries.md) | Aggregate ownership + source-of-truth rules (who owns which fact). |
| [`03-business-flows.md`](03-business-flows.md) | Flow A revenue · Flow B cost · Flow C accounting · Flow D change. |

## Per-domain

[`domains/`](domains/) — platform · project-and-boq · commercial · procurement · accounting ·
not-built (Programme, Inventory, Variations, Subcontracts, Site, Documents, Notifications).

Programme & Progress continuation spec:
[`domains/programme-progress-delivery-spec.md`](domains/programme-progress-delivery-spec.md).

## Reference (detailed, kept but not authoritative on status)

[`reference/`](reference/) — `domain-model.md`, `api-reference.md`, `accounting-event-catalog.md`,
`architecture.md` (SAD), `roadmap.md`, `boundaries.md`, `tenancy.md`, `constraints.md`,
`frontend-design.md`, `frontend-theme.md`, `sprint6-ux-refactor-spec.md` (LOCKED).

## Decisions

[`adr/`](adr/) — ADR-001 … ADR-017. Immutable; supersede, don't edit.

## Other

- [`qa/`](qa/) — visual QA evidence (BOQ, Commercial).
- [`03-explainers/`](03-explainers/) — running-example walkthrough.
- [`backend-requests/`](backend-requests/) — open cross-team questions/blockers.

---
*Structure established 2026-08-14. Stale per-sprint "implemented" tables in `reference/` are
superseded by `01-capability-matrix.md`.*
