# ADR-049 — One Approvals inbox across modules

**Status:** Accepted, built 2026-10-28 (Step 3). It implements the ADR-047 §4 grill decision:
"One Approvals tab with a count, not an inbox per module."

## Context

Decisions wait in many places: submitted journals, submitted supplier bills, draft supplier
payments, quotation requests awaiting a choice, submitted material requests, submitted daily
progress reports, and, once an organisation turns governance on, steps in ADR-011 approval chains.
Each module showed its own queue, if it showed one at all, so an approver had to visit every
module to learn what was waiting.

## Decision

### One read model, in the platform

`GET /approvals/inbox` (`platform/approvals-inbox`) returns `{ items, count }`: everything waiting
on the caller's decision, oldest first. It is a read model. It reads the owning modules' tables
through Prisma and imports none of their services (ARCH-BOUNDARY-001, the same pattern as
`platform/search`). Each queue is capped at 100 rows.

| Kind | Waiting state | Queue runs for a caller holding | Left out for the caller when |
|---|---|---|---|
| `JOURNAL` | `SUBMITTED` | `manage:journal` | they prepared it, unless they hold `post-own:journal` (ADR-046 §1) or the four-eyes rule is off |
| `BILL` | `SUBMITTED` | `manage:payable` | they received goods on its PO (`GOODS_RECEIVER_CANNOT_APPROVE_BILL`) |
| `PAYMENT` | `DRAFT` (no separate submit) | `manage:payable` | they approved a bill it settles (`BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT`) |
| `QUOTATION` | `AWAITING_DECISION` | `award:quotation` | they requested the MR or touched the quote evidence (ADR-044 §6) |
| `MATERIAL_REQUEST` | `SUBMITTED` | `approve:material-request` | they requested it |
| `PROGRESS_REPORT` | `SUBMITTED` | `approve:progress` | — |
| `WORKFLOW` | `ApprovalInstance` `PENDING` | a role equal to the current step's `roleRequired` | they started it, it is already listed from its own queue, or they are a System Administrator (CONST-DOA-001) |

The rules are the ones the Approve / Decide commands enforce. The service evaluates them with
`SegregationOfDutiesService.violation` against the organisation's active rule codes, so the inbox
never offers a decision the server would refuse. Project documents are limited to the caller's
projects (`ProjectAccessService.accessibleProjectIds`); documents without a project stay visible.

### The inbox never decides

Each row opens the document's own page, and the decision is made there with its full context:
lines, attachments, matching, history. There is no bulk approve. An approval is a governed,
audited command, and approving from a list without seeing the document is the failure this design
avoids. Routes live in `features/approvals/approval-href.ts`. A governed document whose page needs
more than its id (a project-scoped variation) is listed without a link.

### The count

- **Sidebar:** "Approvals" is a top-level sidebar item with the count, shown as a dot on the
  icon rail.
- **Page:** `/approvals` lists the items with area tabs (All / Finance / Procurement / Site).
  Each row shows who sent it and how long it has waited; anything waiting more than 3 days is
  marked.
- **One request:** the sidebar and the page share one query.
- **Freshness:** it refreshes every minute, on window focus, and after any successful mutation
  (`QueryProvider`), so a decision made anywhere updates the count at once.

## Consequences

- A module gains an inbox queue by adding a repository query and a row in the table above. The
  ADR-046 §2–§4 settings (approval by amount) will add or remove items without changing the inbox.
- `WORKFLOW` items show the chain's name and amount, not the document's reference. A later step
  can resolve references per transaction type.
- The inbox reads several tables per request. Each query is bounded and indexed by status. Measure
  before optimising (AGENTS.md, Performance Philosophy).
