---
Status: accepted
---

# The Commercial workspace: settlement ownership, term lifecycle, and one reconciliation policy

## Context

The Commercial surface — client contracts, guarantees, interim payment applications (IPA),
interim payment certificates (IPC), and the client invoices/receipts they settle against —
grew across Sprints 2–4 (ADR-004, ADR-005, ADR-006) and is now being rebuilt to the Project
Workspace design language. Before any UI work, an audit against the running code found
correctness and safety gaps that a redesign must not paper over:

- **Nested child mutations were authorized through the parent but mutated by child id
  alone.** `ContractService.removeAdvanceTerm`, `updateGuarantee`, and `completeMilestone`
  called `assertContract(contractId)` and then `delete/update({ where: { id: childId } })`.
  A caller with access to *one* contract could delete an advance term, flip a guarantee, or
  complete a milestone belonging to *another* contract or tenant — an IDOR.
- **Commercial terms had no lifecycle gate.** Retention, advances, guarantees, and
  milestones could be changed on an ACTIVE contract, contradicting the intent that an
  executed contract's commercial baseline is immutable.
- **Child mutations emitted no audit.** Contract create/transition/cancel/terminate were
  audited; retention/advance/guarantee/milestone changes were not.
- **IPC totals were computed in more than one place.** `issue()` derived a gross total and
  wrote deductions; `findOne()` re-summed items and deductions independently. Nothing
  rejected an inconsistent certificate.
- **IPC-to-invoice generation threw on repeat.** `generateFromIpc` raised `409 Conflict`
  when an invoice already existed, so a double-click or retry surfaced an error instead of
  the existing invoice.
- **Guarantee expiry had no backend derivation.** Expiry attention would otherwise be
  computed from the browser clock.

Two ownership questions also had to be pinned down before building read models: what is the
single source of truth for *settlement* (paid / outstanding), and what vocabulary the
product uses for contract value while the Variation model is deferred.

## Decision

This ADR freezes the commercial rules below. They are enforced in backend
domain/application code; the frontend consumes derived capabilities and displays backend
numbers but never re-implements these rules (constraints §10, §20).

### Frozen commercial rules

- **CONST-COM-001 — Immutable baseline.** Once a contract is past DRAFT its commercial
  baseline (header, retention terms, advance terms, guarantees, milestones as a set) is
  frozen. Material change must eventually flow through Variations. *Variations are deferred
  and are not part of this delivery.*
- **CONST-COM-002 — Parent-scoped child mutation.** Every nested commercial mutation is
  verified and mutated through `organizationId + contractId + childId`. Never authorize
  through the parent and mutate by child id alone. A mismatch returns `404`.
- **CONST-COM-003 — Effective IPC only.** Certified value counts only effective IPC
  records. The effective statuses are the documented `CERTIFIED` and `PARTIALLY_CERTIFIED`
  (ADR-005 / `IpcStatus`). No new statuses are invented.
- **CONST-COM-004 — AR owns settlement.** Posted Accounts Receivable records own
  settlement truth: the posted `ClientInvoice` is the receivable, `ClientReceiptAllocation`
  is the settlement, and `outstanding = posted invoice amount − valid posted receipt
  allocations`. IPC must not maintain an independent authoritative paid balance.
- **CONST-COM-005 — Auditable mutations.** Every material commercial mutation creates an
  organization-scoped audit record (actor, action, entity, entity id, timestamp,
  before/after where useful), transactionally aligned with the business write.
- **CONST-COM-006 — Idempotent invoicing.** Generating an invoice from an effective IPC is
  idempotent: at most one active `ClientInvoice` per IPC. Repeating the command returns or
  identifies the existing invoice and never creates a second receivable.
- **CONST-COM-007 — One reconciliation.** Line subtotal → gross certified → retention →
  advance recovery → other deductions → net certified are derived by one backend policy.
  Issuance fails atomically if the certificate does not reconcile. The frontend displays
  backend results.
- **CONST-COM-008 — Terminal readability.** CLOSED / CANCELLED / TERMINATED contracts remain
  readable but commercially immutable except for explicitly documented administrative
  operations.

### Terminology

Use exactly: **Contract Value**, **Certified**, **Invoiced**, **Received**, **Outstanding**.
Do **not** use *Revised Contract Value*, *Current Contract Value*, or *Forecast Contract
Value* — those require the future Variation model.

### Settlement ownership (locked chain)

```
Contract → IPA → IPC → Client Invoice → Receipt → Receipt Allocation → Outstanding Balance
```

- IPA records the contractor's application.
- IPC records the certified commercial result (construction owns it).
- Client Invoice records the receivable and its GL posting (AR owns it).
- Receipt records cash received; Receipt Allocation settles invoices (AR owns them).
- Outstanding is computed from posted AR data only.

The legacy `ReceiptAllocation` (receipt ↔ IPC, Sprint 3 commercial tracking) is **not**
authoritative for settlement; `ClientReceiptAllocation` (receipt ↔ ClientInvoice) is. This
was already the schema's documented intent; no destructive migration is performed. ARCH-
BOUNDARY-001 is preserved: construction depends on accounting, never the reverse.

### Term lifecycle policy (backend-owned)

`CommercialTermPolicy.evaluate(status, mutationKind)` is the single gate. Substantive
baseline mutations (`CONTRACT_HEADER`, `RETENTION_TERMS`, `ADVANCE_TERM`, `GUARANTEE_TERM`,
`MILESTONE_TERM`) are allowed only in DRAFT. Operational mutations are the explicit
exception to the freeze:

| Contract status | Substantive term change | Guarantee status | Milestone complete |
|---|---|---|---|
| DRAFT | Allowed | Allowed | Blocked (not executing) |
| UNDER_REVIEW | Blocked | Allowed | Blocked |
| PENDING_SIGNATURE | Blocked | Allowed | Blocked |
| ACTIVE | Blocked | Allowed | Allowed |
| FINAL_ACCOUNT_PENDING | Blocked | Allowed | Allowed |
| CLOSED / CANCELLED / TERMINATED | Blocked | Blocked | Blocked |

A blocked mutation returns `409 Conflict` with a machine-stable reason code. The backend
returns these as capabilities (Gate B) so the frontend does not recreate the table.

### Guarantee attention (derived, backend clock)

Stored legal lifecycle (`GuaranteeStatus`: ACTIVE | DISCHARGED | CALLED | EXPIRED |
CANCELLED*) is separate from a derived attention condition `NONE | EXPIRING_SOON | EXPIRED`,
computed from `expiryDate` against an authoritative backend clock, never the browser clock.

(*) The schema enum retains a stored `EXPIRED` value for backward compatibility; going
forward expiry is derived. The enum is not migrated here (would require a reviewed
migration).

## Provisional decisions (require Eng Ahmed Shirie confirmation)

- **Guarantee "expiring soon" window = 30 days.** Taken from the accepted platform default
  in `docs/reference/frontend-design.md` (guarantee expiring within 30 days is a
  WARNING signal). Made explicit in `guarantee-attention-policy.ts`.
- **Operational carve-outs.** Guarantee-status changes allowed in any non-terminal status;
  milestone completion allowed in ACTIVE and FINAL_ACCOUNT_PENDING only.
- **VAT rate 5%** for IPC-derived client invoices (pre-existing, unchanged).
- **"Certified" gross vs net.** The summary read model (Gate B) will expose gross and net
  separately; the product must confirm which is the headline figure.

## Consequences

- New backend domain modules own the rules: `contracts/domain/commercial-term-policy.ts`,
  `contracts/domain/guarantee-attention-policy.ts`, `ipc/domain/ipc-calculation-policy.ts`.
- IDOR closed on all three unsafe child mutations; all child mutations now audited.
- `generateFromIpc` is idempotent and race-safe (unique `source_ipc_id` index backstop).
- Deferred and explicitly out of scope: Variations / revised contract value, forecast
  value, retention-release transactions, advance-recovery adjustments, subcontracts,
  org-specific approval thresholds, Programme & Progress integration. These must not appear
  as working controls.

## Delivery gates

Gate A (this ADR's backend correctness) must pass before the Commercial query layer
(Gate B), which must pass before the Commercial workspace UI (Gate C).
