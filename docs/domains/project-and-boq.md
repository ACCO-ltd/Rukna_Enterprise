# Domain — Project & BOQ (scope)

## Project

The central business **scope and reporting root** — not a God Aggregate (see
`docs/02-domain-boundaries.md`). Owns identity, 8-state lifecycle, membership, and the
commercial/participation model. Connects BOQ, Contract, Commercial, Procurement, Commitments,
and financial reporting without owning their internals.

- Code: `apps/api/src/business/construction/projects`
- Endpoints: `projects` (CRUD + lifecycle + suspend/resume + members)
- Frontend: `/projects`, `/projects/[id]` (+ boq, commercial, contracts, ipc, members, pl, edit)
- Status: **INTEGRATED**

## BOQ (Bill of Quantities)

Owns **scope structure, quantity, unit, rate, pricing, baseline, and revision lineage** — and
nothing about time, progress, actual cost, or money paid. Procurement and Accounting may
reference BOQ nodes but never mutate them.

- Versioning: `DRAFT → BASELINED → SUPERSEDED` (baselined versions are permanent).
- Tree: materialized-path `BoqNode`; move via raw SQL.
- Provenance: `BoqNode.sourceType` (`BASELINE | VARIATION`) + `sourceChangeOrderId` are prepared
  for Variations (not yet built).
- Code: `business/construction/boq`; ADR-016 (workspace contract).
- Endpoints: `projects/:projectId/boq`
- Frontend: `/projects/[id]/boq`
- Status: **INTEGRATED**

## Gap: Programme & Progress

There is **no** time/schedule or physical-progress domain. Without it the system knows what to
build (BOQ) and what is being spent (Procurement/Accounting), but not what was physically built,
when, and against which planned activity. This is the largest construction gap — see
`docs/00-system-map.md` and `docs/01-capability-matrix.md`.
