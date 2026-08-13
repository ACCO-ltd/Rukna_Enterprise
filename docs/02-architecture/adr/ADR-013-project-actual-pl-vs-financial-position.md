---
Status: accepted
---

# Project Actual P&L (GL) and Project Financial Position are two read models; commitments never enter the accounting P&L

## Context

The GL already carries a full dimension set on `JournalLine` (`projectId`, `boqNodeId`,
`contractId`, …), and the posting paths populate it: `supplier-bill.service.ts` and
`client-invoice.service.ts` stamp `projectId`/`boqNodeId` at post time, and `pl-report.service.ts`
already accepts a `projectId` filter. So a project-scoped accounting P&L is substantially built —
what is missing is a project index, a convenience endpoint, and the frontend fields that capture the
dimension at entry. ADR-010 separately defines a **Financial Position** projection
(`financial-position/application/financial-position.policy.ts`) that already includes remaining
approved-PO commitments and forecast, behind `view:financial-position`.

## Decision

Keep two distinct read models, and do not conflate them:

- **Project Actual P&L (GL P&L)** — posted GL truth only: posted project revenue, posted
  project-cost lines, net. Statutory/accounting view. Ship now as the thin capability
  (`@@index([projectId])` + `@@index([contractId])` on `journal_lines`, a `GET /projects/:id/pl`
  wrapping the existing tested P&L query). Label it *Project Actual P&L* — never present it to a PM
  as the complete project financial picture.
- **Project Financial Position** — the PM/control view: Budget (BOQ) · Certified · Invoiced ·
  Received · Actual cost · **Remaining committed cost** · Forecast cost (actual + remaining
  commitments) · Forecast margin. This is the project-scoped extension of ADR-010's Financial
  Position projection, built on the shared Tier-3 reporting spine (BOQ budget + CommitmentLedger +
  GL actuals + commercial revenue). It naturally absorbs subcontract commitments (ADR-012).

**Commitments are not GL expenses and must never be inserted into the accounting P&L.** Forecast and
committed cost live only in the Financial Position read model.

## Consequences

- For any PM-facing project financial surface, **remaining committed cost is mandatory, not
  optional** — a posted-actuals-only view that omits committed cost overstates margin and is
  actively misleading. This is why the thin P&L must be labelled as accounting-only.
- Thin now unlocks immediate value (mostly frontend + a hours-scale backend endpoint) without
  waiting on the rich projection; rich next is the same spine Tier 3 needs, so the work is not
  duplicated.
- The two models are queried and cached independently; a change to forecast logic never touches the
  statutory P&L, and vice versa.
