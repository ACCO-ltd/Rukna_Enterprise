# P1 — Audit Atomicity Decision Record (Draft)

Status: Needs architecture approval  
Owner: Abdulsalam  
Last updated: 2026-08-10

## Problem

The global audit interceptor records successful HTTP mutations after the business operation
has completed. This covers the required audit categories, but it is not transactionally
atomic with the business write. If audit persistence fails after a committed mutation, the
client can receive an error even though the business state changed; retrying may then create
or advance another document.

This conflicts with the intent of `CONST-012` auditability and `CONST-005` transactions for
multi-step operations. It must not be “fixed” by silently swallowing audit failures, because
that would create unrecorded financial activity.

## Options Considered

| Option | Result | Decision |
|---|---|---|
| Keep post-operation interceptor | Simple but can report a failure after a committed mutation. | Reject for financial operations. |
| Swallow audit failures | Preserves HTTP success but can lose required audit records. | Reject. |
| Request-wide transaction | Couples all endpoint work to a long-lived transaction and is difficult to enforce across modules. | Reject. |
| Transactional audit outbox | Write immutable audit event in the same tenant transaction as the business change; deliver/read it asynchronously. | Recommended. |

## Recommended Boundary

Introduce a platform-owned transactional audit outbox in the tenant schema:

1. A business application service opens its existing Prisma transaction.
2. The service writes its domain change and immutable audit-outbox record in that same
   transaction.
3. The API returns success only after both writes commit.
4. A platform worker projects the outbox event into `AuditLog`, using an idempotency key.
5. The current interceptor remains only for non-financial, low-risk events until those callers
   are migrated; it must not claim atomicity.

## Scope of the First Migration

Apply the outbox pattern first to operations explicitly required by `constraints.md`:

- authentication and authorization changes;
- role and permission management;
- project lifecycle commands;
- purchase-order approval/cancellation;
- invoice/bill approval or posting;
- configuration changes and user management.

Each module migration needs its own tests proving that a failed outbox insert rolls back the
business mutation and that repeated delivery creates only one audit log.

## Approval Required

This changes the transaction boundary and introduces a new platform persistence component.
It therefore requires an approved ADR before schema migration or broad implementation. Until
then, the existing interceptor is suitable for demo observability but not the final production
audit guarantee for financial operations.
