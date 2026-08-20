---
Status: accepted
---

# Procurement and AP approvals go through the `gateStateTransition` seam, not `ApprovalService.initiate`

## Context

There are two front doors to the approval engine, and they converge on the same
`WorkflowsPrismaRepository.createInstance(...)` and the same `ApprovalInstance` →
`approve`/`reject` flow:

- `CommandGovernanceService.gateStateTransition(entityType, fromState, toState)` — looks up a
  binding via `WorkflowTriggerResolverService`, returns the uniform `409 { approvalInstanceId }`
  contract. Used today by IPA and Project (the ADR-009 seam that removed direct resolver imports).
- `ApprovalService.initiate(transactionType)` — looks up a `WorkflowDefinition` directly by
  `transactionType`. Used by nothing for PURCHASE_ORDER / SUPPLIER_PAYMENT.

The PO and SUPPLIER_PAYMENT approval chains are already seeded as `WorkflowDefinition` rows and
are directly consumable by *either* door. The engine and the chains are built; what is missing is
the binding rows and roughly a dozen call sites.

## Decision

Wire PurchaseOrder, SupplierBill and SupplierPayment approvals through
`CommandGovernanceService.gateStateTransition`, the same seam IPA and Project use — extending the
`GovernedEntity` type and seeding trigger bindings that point at the already-seeded definitions.
Treat `ApprovalService.initiate` as legacy and do not grow it.

## Consequences

- One approval contract (`409 + approvalInstanceId`) across every governed entity, so the existing
  frontend approval panel serves all of them without a second code path.
- The Segregation-of-Duties hook and the audit-outbox write live in one seam, wired once.
- **Value-threshold routing (ADR-007: a large PO takes a longer chain) is unbuilt on *both* doors** —
  the `conditions` metadata on the seeded definitions is currently unread. It is new work regardless
  of door, and therefore not a reason to pick a door. It is expected to land in
  `WorkflowTriggerResolverService.resolveForDocument` (which already exists, `triggerKind: 'DOCUMENT'`,
  the natural trigger for a document submission), by evaluating `conditions` against candidate
  bindings before returning — reusing the existing org/tenant-default priority cascade as the tier
  axis rather than inventing a second one.
