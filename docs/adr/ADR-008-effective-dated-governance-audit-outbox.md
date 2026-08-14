# ADR-008: Effective-Dated Governance and Transactional Audit Outbox

Status: ACCEPTED

Date: 2026-08-11

Deciders: Eng Ahmed Shirie (CEO / ACCO governance authority), Abdulsalam (Backend Engineer)

## Decision

1. ACCO workflow and delegation-of-authority configuration is stored in a
   versioned `WorkflowPolicyVersion`, with `effectiveFrom`, optional
   `effectiveTo`, reporting currency, and amount basis.
2. The first approved ACCO governance version is `SCHEDULED` with no effective
   date. It cannot be selected by the workflow engine until a formal effective
   date is entered and its status is changed to `ACTIVE`.
3. Amounts are evaluated from an immutable USD reporting-amount snapshot at
   submission. Services must not embed amount bands or approver roles.
4. PO policy remains inactive because authority mapping for USD 10,000–50,000
   and above USD 50,000, and the net-versus-gross VAT basis, are unresolved.
5. Central `SegregationOfDutiesRule` records hold ACCO's approved prohibitions.
   They remain inactive until the policy version is active. Feature services
   supply transaction actor facts; the central evaluator decides whether the
   action is allowed.
6. An explicit emergency route is policy data and must emit audit evidence. It
   is never a generic workflow bypass.
7. A business mutation in the first-release audit scope must write an immutable
   `AuditLog` and a durable `AuditOutboxEvent` in the same tenant DB
   transaction. The outbox is delivered after commit using its unique
   idempotency key.

## Consequences

- The legacy HTTP audit interceptor remains backward-compatible visibility
  logging only; it does not satisfy the transactional invariant and must not be
  used as evidence of compliance for migrated commands.
- Commands are migrated incrementally to `TransactionalAuditOutboxService`.
  A command is in scope only after its aggregate mutation and outbox write share
  a Prisma transaction.
- Audit-log access stays permission-based (`view:audit-log`); no broad manager
  access is granted.

## Activation gates

Before the policy version may be activated, ACCO must record:

- the formal effective date;
- PO authority mapping for USD 10,000–50,000 and above USD 50,000;
- whether procurement thresholds use net amount or gross amount including VAT;
- approver chains for supplier payments, project lifecycle, IPA, and IPC;
- delegation, escalation, emergency, exception/Board-referral details.

---

## Implementation

Completed: 2026-08-12

### TransactionalAuditOutboxService — fully wired to all 7 modules

Every command below now writes `AuditLog` + `AuditOutboxEvent` in the **same** Prisma
transaction as the business mutation. The legacy HTTP interceptor remains as supplementary
visibility logging only; it is not compliance evidence for any of these commands.

| Module | Commands migrated |
|---|---|
| `InterimPaymentCertificate` | `ipc.certify`, `ipc.supersede` |
| `InterimPaymentApplication` | `ipa.create`, `ipa.transition` (all 4), `ipa.cancel` |
| `Project` | `project.transition` (all 8), `project.cancel`, `project.suspend`, `project.resume` |
| `Contract` | `contract.transition` (all lifecycle commands), `contract.cancel` |
| `MaterialRequest` | `mr.create`, `mr.submit`, `mr.approve`, `mr.reject`, `mr.cancel` |
| `PurchaseOrder` | `po.create`, `po.submit`, `po.approve`, `po.revise`, `po.cancel` |
| `GoodsReceiptNote` | `grn.create`, `grn.post`, `grn.cancel`, `grn.approve-exception` |

Idempotency key format: `<entity>-<command>-<id>[-<fromStatus>][-rev-<revId>]`

### CommandGovernanceService — new governance seam

`apps/api/src/platform/workflows/application/command-governance.service.ts`

Hides `WorkflowTriggerResolverService` + `ApprovalInstance` creation behind a single
public method. Business services no longer import the resolver directly.

```typescript
// Returns null → proceed immediately
// Returns GovernanceGate → approval instance created; surface approvalInstanceId to client
async gateStateTransition(
  identity: RequestIdentity,
  entityType: GovernedEntity,   // type-safe — compile error on unknown entity
  fromState: string,
  toState: string,
  resourceId: string,
): Promise<null | GovernanceGate>

// Throws ConflictException(409) with { message, approvalInstanceId } when gated
function throwIfGated(gate: GovernanceGate | null, message: string): asserts gate is null
```

Wired to: `ProjectService`, `IpaService`. All future state-transition-governed entities
must use this seam — direct `WorkflowTriggerResolverService` injection in business services
is now an architecture violation.

### GovernedEntity — type-safe entity registry

`packages/types/src/enums.ts`

```typescript
export type GovernedEntity =
  | 'Project'
  | 'InterimPaymentApplication';
```

The `entityType` string in `WorkflowTriggerBinding` is governed: any caller passing an
unknown string to `gateStateTransition()` is a compile error. Add to this union when
wiring a new entity to the governance seam.

### WorkflowsPrismaRepository — transactionType nullable fix

`createInstance()` signature corrected: `transactionType: WorkflowTransactionType | null`
(was non-nullable, mismatched `ApprovalInstance.transactionType?` schema field).

### Accounting date rule enforced

All reversal/allocation postings use the **source document's** `accountingDate` — never
`new Date()`. `CommitmentLedgerWriter` encodes this: callers must supply `accountingDate`
explicitly; `occurredAt` (wall-clock) is set automatically by the writer.
