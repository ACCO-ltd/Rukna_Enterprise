---
Status: accepted
---

<!-- ACCEPTED 2026-09-15. Owner-approved (Abdulsalam) as the "build a real notification center" option
during the payment-schedule follow-up. First driver: payment-stage due/overdue + client-invoice
overdue. Ships dark behind NOTIFICATIONS_GENERATION_ENABLED=false. Owed: Eng Ahmed confirms the
recipient audience for "money you're owed" (default = project members ∪ bypass roles); production
enablement of the flag; browser QA of the populated bell/feed against real data. -->

# In-app notifications: per-recipient persistence and scheduled derivation

## Context

The platform had **no persistent notification system**. The only user-facing signals were ephemeral
toasts (mutation results) and derived, in-page "attention" lists on the Commercial summary; a
`notification-event.policy.ts` declared event types but was dormant
(`NOTIFICATION_DELIVERY_POLICY_CONFIGURED = false`), and the audit outbox was written but never
drained. The top bar even carried a comment *reserving* a notification-bell spot "when the endpoint
ships".

The payment-schedule redesign added a due/overdue **cue** (a chip on the stage row and in the cycle
ribbon), derived client-side from each installment's `dueDate`. The owner asked to make that a real
in-app notification — a top-bar bell with an unread badge, a dropdown, and a feed page — so a stage
that is about to slip is surfaced wherever the user is, not only when they open that project's
Payment Schedule tab.

This ADR introduces the first **notifications bounded context** and the first **scheduler
infrastructure** in the system. Both are trade-offs a future reader must not silently undo, so they
are recorded here.

## Decision

**1. A persistent `Notification` aggregate, one row per (recipient × condition).** Fan-out at
generation time — each notification carries a `recipientUserId`, `readAt`, `resolvedAt`, and a
`dedupeKey` unique per `(organizationId, recipientUserId, dedupeKey)`. Chosen over a shared-event +
per-user read-join because at single-tenant ACCO scale the row multiplication is negligible, while it
keeps the polled unread-count and the feed **join-free** and makes idempotency a database constraint
rather than application bookkeeping. The table holds **no foreign keys** to its source (installment /
invoice / user): a notification must outlive a soft-delete or a payment-plan re-profile that removes
the un-invoiced installment it points at (the same intent as `ClientInvoice`'s SetNull source links).
`contextData` carries only interpolation values — user-facing strings are rendered client-side via
next-intl, never stored. The migration is purely additive (one table + two enums), so it is a safe
live migration with no backfill.

**2. Scheduled, idempotent derivation — not event-sourced from the audit outbox.** A daily
`@nestjs/schedule` cron scans live conditions and UPSERTs by `dedupeKey`; running it twice creates no
duplicate rows. An auto-resolve pass sets `resolvedAt` when the underlying condition clears (a stage
gets billed, an invoice is paid), so resolved rows drop out of the unread badge and never leave the
server. The generator is **flag-gated** (`NOTIFICATIONS_GENERATION_ENABLED`, default false) and ships
dark. We deliberately did **not** build on the never-drained audit outbox — direct derivation from
current state is simpler, self-healing (a missed run just regenerates next cycle), and needs no event
plumbing.

**3. The cron establishes tenant context itself.** `TenancyService.getClient()` throws outside a
request (it reads request-scoped `AsyncLocalStorage`). So the generator enumerates ACTIVE tenants
from the platform DB, calls `resolveTenant(slug)`, and runs each org's cycle inside
`tenancyStorage.run(ctx, …)`. **This is the reference pattern every future background job must copy.**
A single prod api instance (docker compose) means no multi-node cron contention, so no distributed
lock is needed.

**4. Recipients reuse the existing access model.** A project's notification fans out to the project's
active members (`ProjectMember.removedAt IS NULL`) ∪ org holders of `PROJECT_MEMBERSHIP_BYPASS_ROLES`
— the exact set `ProjectAccessService` already authorizes — so a notification never reaches someone
who could not already open its source screen. The precise narrowing (all members vs. finance function
only) for "money you're owed" is an **open domain decision for Eng Ahmed**; the safe default ships and
narrowing later is a pure filter with no schema impact. A project-less overdue invoice has no project
audience and is skipped rather than fanned out org-wide (under-notifying is the safe direction).

**5. Kinds are pluggable.** The generator loops an array of `NotificationSource` strategies. V1 covers
`STAGE_PAYMENT_DUE` / `STAGE_PAYMENT_OVERDUE` (an ACTIVE MILESTONE installment with a `dueDate`, still
un-billed) and `CLIENT_INVOICE_OVERDUE` (a posted, unpaid invoice past its due date). Adding
guarantee-expiry later is one strategy file reusing `deriveGuaranteeAttention` — no change to the
aggregate, endpoints, or frontend. The due-soon window (7 days) mirrors the frontend `dueStatus` so
the server clock is authoritative and the mapping is unit-testable.

**6. Delivery is in-app only.** A bell with an unread badge, a dropdown of recent items, and a
`/notifications` feed page; the unread count is **polled** (60s) since there is no websocket. No email
or SMS. A user reads only their own rows (`identity.userId` + `activeOrganizationId`); a foreign id
returns 404, never a 403 existence leak. Owning your own notifications is not gated by an
`action:resource` permission.

## Consequences

- **New dependency + infra:** `@nestjs/schedule` and `ScheduleModule.forRoot()`. Its pure-ESM package
  cannot be parsed by the unit Jest config, so tests redirect `@nestjs/schedule` to a small CJS stub
  via `moduleNameMapper`; production builds use the real package and the generator body is exercised
  directly through `generateAllTenants()`.
- **Owed:** Eng Ahmed's recipient-scope decision; enabling the flag in production; browser QA of the
  populated bell/feed (the operational states are unit-covered, but no run has been observed against
  real data). Guarantee-expiry and approval-assignment kinds are natural follow-ons.
- **Not chosen:** a shared-event/read-join model (worse hot-path queries), lazy on-read generation
  (defeats a persistent unread badge and cross-project aggregation), and building on the audit outbox
  (would require first implementing its consumer).

## References
- Plan: the payment-schedule follow-up planning session (2026-09-15).
- Reuses: `guarantee-attention-policy.ts` (windowing), `project-access.service.ts` (recipient set),
  `platform/audit-logs` (module layering), `tenancy.context.ts` / `tenancy.service.ts` (cron-tenancy).
- Frontend cue it promotes: `apps/web/src/features/commercial/presentation.ts` `dueStatus`.
