---
Status: accepted
---

# Approval loop-back: the caller re-drives a gated transition after its instance is approved

## Context

`CommandGovernanceService.gateStateTransition` armed a gate — resolve a binding, create an
`ApprovalInstance`, return `409 { approvalInstanceId }` — but **nothing completed the cycle**:
no code consumed `isFullyApproved`, so once approvers finished, the entity's transition was never
carried out. Every governed entity (IPA, Project, PurchaseOrder, SupplierBill, SupplierPayment)
shared this dead-end: governance was wired but inert.

## Decision

Adopt the **re-drive** mechanism. `gateStateTransition` reconciles against the latest
`ApprovalInstance` for the resource before opening a new one:

- **APPROVED** → consume it (single-use) and return `null` → the transition proceeds.
- **PENDING** → return the same instance (no duplicate) → still gated.
- **none / terminal (REJECTED/CANCELLED/consumed)** → open a fresh instance → gated.

Flow: `submit` → 409 (instance created) → approvers approve via the workflow endpoints → the caller
**re-invokes the same command** → the gate finds the APPROVED instance, consumes it, and the
transition completes. No new infrastructure, no event bus; the existing call sites are unchanged.

## Considered alternatives

- **Completion callback** — `ApprovalService.approve` calls back into the entity on final approval.
  Auto-completes, but needs a transactionType→handler registry and couples the workflow layer to
  every business module.
- **Outbox event** — approval emits a domain event a handler consumes. Most decoupled, most
  plumbing; overkill for the current stage.

Re-drive was chosen for being the smallest change that makes governance functional and for leaving
the call sites untouched.

## Consequences

- **Consumption uses the `CANCELLED` terminal status**, not a dedicated `CONSUMED` value — adding an
  enum value requires a Prisma client regen, which the environment could not do (dev-server file
  lock on the query engine). The approver audit trail is preserved in `ApprovalAction` rows; only the
  instance's terminal label is imprecise. A dedicated `CONSUMED` status is the intended refinement.
- **Matching is by `(transactionType, transactionId)`, not `toState`** — the instance does not record
  the target state. For single-gated-transition entities (PO/bill/payment) this is exact. For a
  multi-transition entity (Project), an APPROVED instance could satisfy a *different* transition on
  the same resource if attempted before the intended one re-drives. Rare, and bounded by single-use
  consumption; the proper fix is to persist `toState` on the instance (deferred — schema change).
- The caller (frontend) must re-invoke the command after seeing the instance APPROVED. This is the
  explicit contract of the re-drive model.
