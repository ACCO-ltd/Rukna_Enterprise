# Audit outbox delivery — review and recommendation

**Status:** Review (ADR-027 Work Package E, item 8a). Not an implementation.
**Scope:** The *delivery / relay* side of the transactional audit outbox. The *write* side is done
and correct; this document only assesses whether anything drains what is written.

## What exists

### Write side (complete, in-transaction)

Every governance write pairs an `AuditLog` row with an `AuditOutboxEvent` row inside the same
transaction as the aggregate mutation, so the audit record and the durable outbox event either
commit together with the change or roll back together (ADR-008, GOV-ADM-008). Two paths write it:

- `TransactionalAuditOutboxService.record(tx, command)` —
  `apps/api/src/platform/audit-logs/application/transactional-audit-outbox.service.ts`. The shared
  helper: creates the `auditLog`, then the `auditOutboxEvent` with a caller-supplied
  `idempotencyKey`.
- `WorkflowsPrismaRepository` — `apps/api/src/platform/workflows/infrastructure/workflows-prisma.repository.ts`.
  The ADR-027 policy-authoring writes (`transitionPolicy`, `clonePolicyToDraft`, rule
  update/delete/reorder, SoD upsert) inline the same `auditLog.create` + `auditOutboxEvent.create`
  pair, each with a fresh `randomUUID()` idempotency key.

The row is `AuditOutboxEvent` (`apps/api/prisma/schema.prisma`), with the fields a relay needs:

| Field | Purpose |
|---|---|
| `idempotencyKey` (`@unique`) | Durable dedupe key handed to the consumer; a redelivery is safe. |
| `publishedAt` (`DateTime?`) | Delivery watermark. `null` = not yet delivered. |
| `publishAttempts` (`Int @default(0)`) | Incremented on every delivery attempt (success or failure). |
| `lastError` (`String?`) | Truncated last failure message, for triage. |
| `occurredAt` | Order key — a drain publishes oldest-first. |

There is an index `@@index([organizationId, publishedAt, occurredAt])` that is exactly the access
path a poll-drain query wants (`WHERE organizationId = ? AND publishedAt IS NULL ORDER BY occurredAt`).

### Relay side (present as a service, but NOT invoked)

`AuditOutboxPublisherService.publishPending(organizationId, publisher, limit)` —
`apps/api/src/platform/audit-logs/application/audit-outbox-publisher.service.ts`. It:

1. selects up to `limit` (default 100) unpublished events for one org, oldest first;
2. for each, calls an injected `AuditOutboxPublisher.publish(...)` port;
3. on success, sets `publishedAt = now()`, increments `publishAttempts`, clears `lastError`;
4. on failure, increments `publishAttempts` and stores `lastError` (event stays unpublished for a
   later retry).

This is a correct, safe at-least-once relay body: it is idempotent for consumers (durable
`idempotencyKey`), commit-ordered, and per-event fault-isolated.

## What is missing

**Nothing drains the outbox.** `publishPending` has no caller anywhere in the codebase — verified by
searching for `publishPending`, `AuditOutboxPublisherService`, `@Cron`, `ScheduleModule`,
`setInterval`. There is:

- no scheduled worker / cron / `@nestjs/schedule` registration that calls it,
- no concrete `AuditOutboxPublisher` implementation (the interface has no production adapter — the
  only consumer of the port is the service signature itself),
- no bootstrap wiring in `main.ts` or any module that starts a background loop.

**Consequence:** `auditOutboxEvent` rows are written on every governance (and variation) mutation and
accumulate with `publishedAt = null` **forever**. The immutable audit trail in `audit_logs` is intact
and queryable — the compliance record is not lost — but the *event-distribution* half of the outbox
(notifying downstream consumers: a SIEM, an analytics sink, a notifications service) is inert. The
outbox is being filled and never emptied.

Secondary gaps in the relay body, relevant once a drain is scheduled:

- **No max-attempts cap / dead-letter (DLQ).** A permanently-failing event is retried on every drain
  pass indefinitely. `publishAttempts` is recorded but never used as a stop condition, and there is
  no `deadLetteredAt` / status column to quarantine a poison event.
- **No backoff.** A failing event is eligible again on the very next pass; there is no
  `nextAttemptAt` / delay column, so a broken consumer is hammered at the drain frequency.
- **Multi-tenant / multi-instance drainer strategy is undefined.** `publishPending` drains one
  `organizationId` at a time and does not lock rows (`SELECT ... FOR UPDATE SKIP LOCKED`), so two
  concurrent drainers could both attempt the same event. That is *safe* (consumers dedupe on
  `idempotencyKey`) but wasteful; a real relay should claim rows.

## Recommendation

Do **not** ship ADR-027 authoring go-live assuming events are delivered. Two options:

1. **Preferred — schedule the existing drain.** Add a small scheduled worker (e.g. `@nestjs/schedule`
   `@Cron` every N seconds, or a dedicated relay process for a shared box) that, per active tenant,
   resolves the tenant Prisma client and calls `AuditOutboxPublisherService.publishPending(orgId,
   publisher)` with a concrete `AuditOutboxPublisher` adapter. This is separate infrastructure and is
   explicitly **out of scope** for this work package (the prompt says do not build a full
   relay/worker). Before it is production-grade, also add: a `publishAttempts` cap that moves an event
   to a dead-letter state, exponential backoff via a `nextAttemptAt` column, and row-claiming
   (`FOR UPDATE SKIP LOCKED`) if more than one drainer can run.

2. **If no consumer exists yet**, that is fine — but make the "events are written but not delivered"
   state an explicit, documented decision rather than a silent gap, and put the relay on the roadmap
   before any downstream system is told to rely on outbox delivery. The
   [access-governance rollout checklist](./access-governance-rollout-checklist.md) lists the relay as
   a go-live prerequisite for exactly this reason.

### Trivial, safe note (not built here)

If a drain is scheduled later, the one-line safety addition worth making at the same time is a
`publishAttempts` ceiling in `publishPending` (skip / dead-letter an event once
`publishAttempts >= MAX`), so a single poison event cannot make every drain pass fail forever. It is
called out here rather than implemented because it is only meaningful alongside the scheduler, which
is separate infra.

## Pointers

- Row model: `apps/api/prisma/schema.prisma` → `model AuditOutboxEvent`
- Write helper: `apps/api/src/platform/audit-logs/application/transactional-audit-outbox.service.ts`
- Authoring writes: `apps/api/src/platform/workflows/infrastructure/workflows-prisma.repository.ts`
- Relay body (uninvoked): `apps/api/src/platform/audit-logs/application/audit-outbox-publisher.service.ts`
- Module (provides + exports both services): `apps/api/src/platform/audit-logs/audit-logs.module.ts`
