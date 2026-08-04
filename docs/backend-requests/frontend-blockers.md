# Frontend → Backend Requests

Raised by: Frontend Engineer (`apps/web`, `packages/ui`)
For: **Abdulsalam** (backend, `apps/api`) — and where marked, **Eng Ahmed Shirie** (domain)
Date: 2026-08-03
Status: Open

This document is the source of truth for backend work the frontend is waiting on.
Items marked **Blocking** prevent a UI surface from functioning at all — they are not
feature requests.

Findings were produced by reading `apps/api/src` directly, not by inference from docs.

- **B-series** (Sprint 1–2 platform, projects, BOQ) — line references against commit `e1f2139`.
  Re-verified against `776b695` on 2026-08-03: **none are fixed**.
- **C-series** (Sprint 3 commercial modules) — line references against commit `776b695`,
  the most recent commit touching `apps/api`. Raised 2026-08-03 before frontend work on
  Contracts, IPA, IPC and Receipts began.

---

## Summary

| ID | Severity | Area | Summary | Issue |
|---|---|---|---|---|
| [B1](#b1) | **Blocking — bug** | Projects | No project can ever get its first member | [#5](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/5) |
| [B2](#b2) | **Blocking** | Users | No endpoint lists users in an organization | [#6](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/6) |
| [B3](#b3) | **Blocking** | Workflows | `GET` endpoint requires a request body — uncallable from a browser | [#7](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/7) |
| [B4](#b4) | **Security** | Workflows | Approver identity is taken from the request body | [#8](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/8) |
| [B5](#b5) | **Security** | Roles, Audit | `orgId` read from query string, unscoped by token | — |
| [B14](#b14) | **Blocking — bug** | BOQ | `move` always 500s and half-applies, corrupting descendant paths | [#4](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/4) |
| [B11](#b11) | **Security** | BOQ | Version endpoints missing the organization check | — |
| [B13](#b13) | Contract | BOQ | `move` never reindexes siblings, so positions can tie | — |
| [B6](#b6) | Contract | Several | Undocumented empty response bodies | — |
| [B7](#b7) | Correctness | BOQ | Money totals computed in floating point | — |
| [B8](#b8) | Scale | Projects | No pagination, search, or sort | — |
| [B9](#b9) | Gap | Users | No way to persist a language preference | — |
| [B10](#b10) | Gap | Projects | No summary/aggregate endpoint | — |
| [B12](#b12) | Gap | Types | `@erp/types` exports no Project DTO | — |
| [D1](#d1) | **Domain** | BOQ | Mixed-currency nodes sum into one meaningless total | — |
| [D2](#d2) | Docs | — | `api-reference.md` inaccuracies | — |

### Sprint 3 — commercial modules

| ID | Severity | Area | Summary | Issue |
|---|---|---|---|---|
| [C2](#c2) | **Security** | IPC | `POST /ipc` checks nothing about the application it certifies | [#9](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/9) |
| [C3](#c3) | **Security** | IPA | Unit rate is taken from the request, not the contractual BOQ | [#10](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/10) |
| [C1](#c1) | **Blocking — design** | IPC | Retention and advance-recovery arithmetic is delegated to the browser | [#12](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/12) |
| [C7](#c7) | **Correctness — bug** | Finance | Payment status measures against gross, so a settled IPC never reads `PAID` | [#11](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/11) |
| [C4](#c4) | Correctness | IPA | No guard against over-claiming or a negative period quantity | — |
| [C5](#c5) | Contract | IPA | Workflow policy is resolved but no approval instance is created | — |
| [C6](#c6) | Gap | Types | Five more aggregates with no DTO in `@erp/types` | — |
| [C8](#c8) | Contract | Finance | `totalAllocated` returns a number, breaking the money-as-string rule | — |
| [C9](#c9) | Gap | BOQ | `measurementMethod` and `pricingBasis` can never be set | — |
| [C10](#c10) | Contract | Contracts | Retention split is spelled `…OnPc` in, `…OnPC` out | — |
| [C13](#c13) | Gap | Contracts | Cancel and terminate require a reason and discard it | — |
| [C14](#c14) | **Blocking — bug** | IPA | `RETURNED_FOR_REVISION` is a dead end — editable, unsubmittable | [#13](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/13) |
| [C15](#c15) | Gap | IPA | Claimed items carry a bare `boqNodeId` — no code or description | — |
| [C17](#c17) | **Correctness — bug** | Finance | A negative allocation is accepted and defeats the over-allocation guard | [#14](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/14) |
| [C16](#c16) | Gap | Finance | No way to list or attribute certificates by client | — |
| [D3](#d3) | Docs | Clients, Contracts | Documented request shapes that return `400` | — |

---

## Blocking

### <a id="b1"></a>B1 — No project can ever get its first member

**Severity:** Blocking. This is a bug in shipped code, not a missing feature.

`ProjectService.addMember` requires the *caller* to already be an active member:

- `apps/api/src/business/construction/projects/application/project.service.ts:210`
  → `await this.assertMember(prisma, projectId, identity.userId);`
- `assertMember` throws `403 You are not a member of this project.` (line 244–249)

But `ProjectService.create` (line 63–82) never enrols the creator as a member, and
`ProjectPrismaRepository.create` only inserts the `Project` row.

**Result:** every `POST /projects/:id/members` returns `403`, for every user, forever.
A project's member list is permanently empty and unreachable through any API path.
There is no workaround from the client.

**What the frontend needs — either:**

1. `create` auto-enrols the creator as a member with `PROJECT_MANAGER`, or
2. `addMember` permits a non-member caller holding an appropriate org-level role.

Option 1 also gives the project an owner, which the UI needs for the detail header.
This is a decision about the domain model, so it may be worth confirming with Eng Ahmed
which roles may enrol members.

**Frontend impact:** the Projects members tab is deferred until this lands.

---

### <a id="b2"></a>B2 — No endpoint lists users in an organization

**Severity:** Blocking (depends on B1 being fixed to matter).

`apps/api/src/platform/users/presentation/users.controller.ts` exposes only
`GET /users/:id`. `POST /projects/:id/members` requires a `userId`, and the frontend
has no way to discover one — you cannot type a CUID into a picker.

**What the frontend needs:** `GET /users` scoped to the caller's organization from the
token (not a query param — see B5).

Questions that shape the UI, worth deciding when the endpoint is designed:

- Paginated, or is a full org list acceptable at ACCO's size?
- Server-side search by name/email, or client-side filter?
- Can it exclude users already on a given project (`?notInProject=<id>`)? This is the
  difference between a clean picker and one that lists people then errors with `409`.

---

### <a id="b3"></a>B3 — `GET /workflows/definition/:transactionType` requires a request body

**Severity:** Blocking for any workflow UI.

`apps/api/src/platform/workflows/presentation/workflows.controller.ts:38`

```ts
@Get('definition/:transactionType')
getDefinition(
  @Param('transactionType') transactionType: WorkflowTransactionType,
  @Body('organizationId') organizationId: string,   // ← body on a GET
)
```

The Fetch standard forbids a body on `GET`; `fetch()` throws before sending. `XMLHttpRequest`
and most HTTP clients drop it. This endpoint cannot be called from a browser at all.

**What the frontend needs:** derive `organizationId` from the token
(`identity.activeOrganizationId`), consistent with every Projects endpoint.
Failing that, a query parameter — but the token is the correct source.

---

### <a id="b14"></a>B14 — `POST .../nodes/:id/move` always fails, and leaves the tree corrupted

**Severity:** Blocking. Reproduced against the running API; two defects in one function.

`BoqPrismaRepository.moveNode` (`boq-prisma.repository.ts:115–150`) runs two raw statements.

**Defect 1 — every call errors.** Step 2 interpolates a JS number as the substring offset:

```ts
// boq-prisma.repository.ts:144
SET "path" = ${newNodePath} || '/' || substring("path", ${oldPath.length + 2}),
```

Prisma binds that number as `bigint`, and PostgreSQL has no `substring(text, bigint)`:

```
Raw query failed. Code: 42883.
ERROR: function substring(text, bigint) does not exist
```

Every move answers `500`, whatever the node.

**Defect 2 — the failure half-applies.** The two statements are not wrapped in a
transaction, so step 1 has already committed when step 2 throws. Verified directly:

```
before:  A sort_order=1,  B sort_order=2
POST .../nodes/B/move  {"newParentId": S, "newSortOrder": 1}   → 500
after:   A sort_order=1,  B sort_order=1     ← written despite the error
```

For a node with descendants this is worse than a failed write: the moved node's `path` and
`depth` are updated while its descendants keep the old prefix, so the materialized-path
index no longer describes the tree. Every `path LIKE 'oldPath/%'` query — including the
next move and the subtree copy performed when a draft is created — then reads a tree that
does not match reality.

**Suggested fix:**

1. Cast the offset, e.g. `substring("path", ${oldPath.length + 2}::int)`, or pass it as
   `Prisma.raw(String(n))`.
2. Wrap both statements in `prisma.$transaction` so a failure cannot half-apply.
3. Consider a regression test that moves a node **with children** and asserts every
   descendant path was rewritten — defect 2 is invisible on a leaf.

**Frontend impact:** the reorder controls are written and tested but not rendered
(`REORDER_ENABLED = false` in `apps/web/src/features/boq/node-actions.ts`). Shipping a
button that corrupts the BOQ is worse than shipping no button. Flipping that flag is the
whole re-enable once this lands.

---

## Security

### <a id="b4"></a>B4 — Approver identity is supplied by the client

`workflows.controller.ts` — `approve` and `reject` both read the actor from the body:

```ts
@Body() body: { actorId: string; notes?: string }
```

Any authenticated user can approve as any other user by changing one field. `AGENTS.md`
requires approval workflows to be enforced server-side and never trust client-side
approval state; `apps/api/CLAUDE.md` says the same.

**What the frontend needs:** `actorId` derived from the JWT via `@CurrentUser()`.
The frontend will not send an `actorId`. Until this changes, no approval UI will be built.

---

### <a id="b5"></a>B5 — `orgId` taken from the query string

- `apps/api/src/platform/roles/presentation/roles.controller.ts:23` — `findAll(@Query('orgId') orgId: string)`
- `apps/api/src/platform/audit-logs/presentation/audit-logs.controller.ts:19` — `findByOrg(@Query('orgId') orgId: string)`

Neither checks the value against `identity.activeOrganizationId`. A tenant database can
hold multiple organizations, so a user can read another organization's roles and its
**audit log** by changing a query parameter. The audit log is the more serious of the two.

**What the frontend needs:** both should scope to the token's organization and drop the
parameter. The frontend will not pass `orgId`.

---

### <a id="b11"></a>B11 — BOQ version endpoints skip the organization check

`BoqTreeService.requireBoqForProject` does verify ownership:

```ts
// boq-tree.service.ts:216
if (boq.organizationId !== organizationId) throw new ForbiddenException();
```

`BoqVersioningService` does not. Its `requireBoq` / `getBoq` call
`repo.findByProject(prisma, projectId)` (`boq-prisma.repository.ts:12`), which filters on
`projectId` alone with no organization predicate. This affects `getBoq`, `initialize`,
`createDraftFromApproved`, `baseline`, and `cancelDraft`.

**Result:** within a tenant, a user in org A can read another org's BOQ and its version
history, baseline its draft, or cancel it. `initialize` is worse — it creates a `Boq` row
stamped with the *caller's* `organizationId` against another org's `projectId`.

**What the frontend needs:** the same ownership check the tree service already performs.
This one is independent of the frontend — it should be fixed regardless of UI plans.

---

## Contract & correctness

### <a id="b6"></a>B6 — Undocumented empty response bodies

These return `200` with **no body**, because the service method returns `void`:

| Endpoint | Source |
|---|---|
| `POST /projects/:id/suspend` | `project.service.ts:171` |
| `POST /projects/:id/resume` | `project.service.ts:189` |
| `DELETE /projects/:id/members/:userId` | `project.service.ts:225` |
| `POST /auth/logout` | `auth.controller.ts:60` |
| `POST …/nodes/:nodeId/move` | `boq-tree.service.ts:144` |
| `DELETE …/nodes/:nodeId` | `boq-tree.service.ts:184` |

`api-reference.md` documents response shapes for the six lifecycle transitions and for
cancel — all correct — but says nothing about the response of these six. A client that
assumes JSON (as ours did) throws on `res.json()`.

**Two requests, in preference order:**

1. Return the updated resource (project / BOQ tree), so the UI can update without a
   second round-trip. This is what the lifecycle transitions already do, and consistency
   here is worth more than the saved bytes.
2. If an empty body is intentional, return `204 No Content` rather than `200`, and
   document it.

The frontend now handles empty bodies defensively either way, so this is not blocking.

---

### <a id="b7"></a>B7 — Money totals computed in floating point

`boq-tree.service.ts:254`

```ts
return Math.round(quantity * unitRate * 100) / 100;
```

and `:265` / `:284–296`, where `totalAmount` (a Prisma `Decimal`) is converted with
`Number()` and accumulated into `computedTotal` as a JS `double`.

Decimal columns are being summed as binary floating point. At ACCO's contract values
(~1e8, 2dp) this stays within `double` precision, so it is not currently producing wrong
numbers — but it is a correctness landmine as values grow or as more arithmetic is layered
on, and it undercuts the reason the columns are `Decimal` in the first place.

**Suggested:** use `Prisma.Decimal` arithmetic and serialize the total as a string, like
every other money field. The frontend does no money arithmetic (all totals come from
`computedTotal`), so a string is the preferred shape — it is also more consistent, since
`totalAmount` is already a string while `computedTotal` is a number.

---

## Gaps (non-blocking)

### <a id="b8"></a>B8 — `GET /projects` has no pagination, search, or sort

`project-prisma.repository.ts:22` — `findMany` with an optional status filter and
`orderBy: { createdAt: 'desc' }`. No `skip`/`take`, no text search.

Fine at ACCO's current scale. The frontend fetches the full list and filters client-side,
which is a deliberate, documented trade-off — not an oversight. It will need revisiting
before the list reaches a few hundred projects.

### <a id="b9"></a>B9 — No way to persist a language preference

`User.preferredLanguage` populates the JWT `lang` claim, and the frontend now seeds the UI
language from it. But there is no `PATCH /users/:id` (or `/users/me`), so when a user
switches language the change is device-local and lost on the next device.

**What the frontend needs:** an endpoint to update the current user's `preferredLanguage`.

### <a id="b10"></a>B10 — No summary/aggregate endpoint

The dashboard shows project counts by status, computed client-side from the full
`GET /projects` response. A `GET /projects/summary` returning counts per status would
remove that, and becomes necessary once B8 does.

Not urgent — raised so it is on the roadmap rather than discovered later.

### <a id="b13"></a>B13 — `move` never reindexes siblings, so positions can tie

`sortOrder` is required on create and the API never allocates one, while `moveNode` writes
the given position onto the moved node alone and leaves its siblings untouched. Nothing
prevents two siblings from holding the same `sortOrder`, and
`findNodesByVersion` orders by `[depth, sortOrder]` — so tied siblings come back in an
order PostgreSQL does not guarantee and which can change between reads.

The frontend avoids creating ties: new nodes take `max(sibling.sortOrder) + 1`, and
reordering is expressed as a two-node swap rather than a renumber. That keeps our own
writes clean but cannot repair ties introduced elsewhere.

**Suggested:** either reindex the destination siblings inside the move (and inside create),
or add a partial unique index on `(version_id, parent_id, sort_order)` so a tie is rejected
rather than silently stored. Lower priority than B14, but the two are worth fixing
together since both live in `moveNode`.

### <a id="b12"></a>B12 — `@erp/types` exports no Project DTO

`apps/web/CLAUDE.md:170` instructs the frontend to import shared types and never redefine
them locally — the right rule, and one we want to follow. But `packages/types` exports the
`ProjectStatus`, `ProjectRole` and `BoqVersionStatus` enums with no accompanying record
shapes, and `packages/types` is backend-owned.

So `apps/web/src/features/projects/types.ts` declares the `Project` wire shape locally,
with a comment pointing here. That file is now a second definition of a backend contract
and will drift the first time a column is added.

**What the frontend needs:** DTOs in `@erp/types` for the shapes the API actually returns,
starting with `Project`, then `ProjectMember`, `Boq`, `BoqVersion` and `BoqTreeNode`.

Two details that matter for the DTO to be usable as-is:

- `Decimal` columns serialize as **strings** (`contractValue: "4500000.00"`), not numbers.
  The DTO should say `string`, matching the wire format rather than the Prisma type.
- `DateTime` columns serialize as ISO strings, not `Date` objects. Note that the existing
  `UserDto` and `OrganizationDto` declare `createdAt: Date`, which is wrong for anything
  that has been through `JSON.parse` — worth correcting at the same time.

---

## Sprint 3 — commercial modules

Raised before building the Contracts → IPA → IPC → Receipts UI. Credit where it is due
first: these modules are noticeably more disciplined than the Sprint 1 platform code.
Every controller derives identity from `@CurrentUser()`, `IpaService.addItem` computes
`previousEffectiveCertified`, `periodQuantity` and `periodAmount` server-side in `Decimal`,
`IpcService.findOne` returns `netCertified` as a decimal string, and receipt allocation is
properly guarded against over-allocation. The findings below are concentrated in two
places: what `POST /ipc` accepts, and what it does not check.

### <a id="c2"></a>C2 — `POST /ipc` validates nothing about the application it certifies

**Severity:** Security. Same class as B11, and the highest-priority item in this section.

`IpcService.issue` (`ipc.service.ts:51`) takes `dto.applicationId` and uses it directly.
It never loads the IPA. There is no organization check, no status check, and no check that
the items being certified belong to that application:

```ts
// ipc.service.ts:57 — looked up by id alone
const appItem = await prisma.interimPaymentApplicationItem.findUnique({
  where: { id: item.applicationItemId },
  select: { cumulativeClaimed: true, unitRateSnapshot: true },
});
```

Three consequences, in order of severity:

1. A user in org A can issue a certificate against org B's application. The certificate is
   stamped with the *caller's* `organizationId` — the same shape of defect as B11's
   `initialize`.
2. A certificate can be issued against a `DRAFT` application that was never submitted,
   bypassing the entire IPA approval sequence.
3. `applicationItemId` is never checked against `dto.applicationId`, so a certificate can
   certify line items belonging to a different application entirely — and it will price
   them using *that* application's `unitRateSnapshot`.

Every sibling service does this correctly: `ContractService`, `IpaService` and
`FinanceService` all call a `requireX(prisma, identity.activeOrganizationId, id)` helper
first. `IpcService` is the one that does not.

**What the frontend needs:** the same `requireIpa(identity.activeOrganizationId, …)` guard
its siblings use, a status check that the IPA is `SUBMITTED`, and an
`applicationItem.applicationId === dto.applicationId` assertion.

This one should be fixed regardless of any UI plans.

---

### <a id="c3"></a>C3 — Unit rate is taken from the request, not the contractual BOQ

**Severity:** Security / correctness.

`AddIpaItemDto` requires the client to send `unitRateSnapshot`, and `IpaService.addItem`
stores it verbatim. Nothing compares it to the BOQ node's `unitRate`.

The service is already reading that exact row one line earlier:

```ts
// ipa.service.ts:148 — the node is loaded, but only for measurementMethod
const boqNode = await prisma.boqNode.findUnique({
  where: { id: dto.boqNodeId },
  select: { measurementMethod: true },
});
```

So any authenticated user can claim any quantity at any price they choose, and the field
named "snapshot" records the client's number rather than the contract's. `periodAmount` is
then computed from it server-side, which lends a fabricated rate the appearance of a
server-derived total.

**What the frontend needs:** add `unitRate` and `currency` to that `select` and take both
from the node. The frontend will stop sending `unitRateSnapshot` once it does.

Note this also silently ignores the contract's `boqVersionId`: an item can reference a BOQ
node from any version, including a draft one, rather than the baselined version the
contract is bound to.

---

### <a id="c1"></a>C1 — Retention and advance-recovery arithmetic is delegated to the browser

**Severity:** Blocking for the IPC issuance UI. This is a design question, not a bug.

`CreateIpcDto` requires the client to compute and send:

- `certifiedTotal` — the gross certified amount
- for every deduction: `deductionType`, `rate`, `basis` and `amount`

`IpcService.issue` recomputes each item's `certifiedAmount` from the application item's
`unitRateSnapshot` — correctly, in `Decimal` — but stores `certifiedTotal` and every
deduction amount exactly as received, with no cross-check against the item sum it just
calculated. `IpcDetail` then returns both numbers, which can disagree.

The backend holds everything needed to derive these itself: `ContractRetentionTerms`
(`retentionRate`, `retentionCap`, `retentionSplitOnPC`) and `ContractAdvanceTerm`
(`recoveryRate`) hang off the contract that owns the application.

`apps/web/CLAUDE.md:347` says a wrong retention calculation costs real money for real
people. This API asks the frontend to own that calculation, and `apps/api/CLAUDE.md` is
explicit that financial derivation belongs server-side.

**What the frontend needs — in preference order:**

1. The API derives `certifiedTotal` from the certified items, and derives retention and
   advance-recovery deductions from the contract terms. The client sends certified
   quantities and variance reasons only — the two things a human actually decides.
2. Failing that, the API validates what it is sent: reject a `certifiedTotal` that does not
   equal the item sum, and a retention `amount` that does not match `basis × retentionRate`.
   The arithmetic still happens in the browser, but a mistake cannot be persisted.

**Frontend impact:** the IPC issuance UI is sequenced last and will not be built until this
is settled. Certificate *viewing* and supersession do not depend on it and will ship first.
Manual deductions the user genuinely authors — an ad-hoc contra charge, for instance —
should stay client-supplied under either option.

---

### <a id="c7"></a>C7 — A fully-settled certificate can never report `PAID`

**Severity:** Correctness. A bug in shipped code.

`getCertificatePaymentSummary` (`finance-prisma.repository.ts:71–94`) compares total
allocations against the certificate's **gross** `certifiedTotal`:

```ts
const certTotal = Number(cert?.certifiedTotal ?? 0);   // gross, before deductions
const totalAllocated = Number(alloc._sum.allocatedAmount ?? 0);
if (totalAllocated >= certTotal) status = 'PAID';
else if (totalAllocated > 0) status = 'PARTIALLY_PAID';
```

But a client pays the **net** — `certifiedTotal` minus retention, advance recovery and tax.
`IpcService.findOne` already computes and returns exactly that figure as `netCertified`.

So for any certificate carrying a deduction — which is every certificate on a contract with
retention terms — allocations can only ever sum to the net, the comparison never succeeds,
and the status is pinned at `PARTIALLY_PAID` forever. A 5% retention makes `PAID`
unreachable. The only certificates that can reach `PAID` are those with no deductions at
all.

**Suggested fix:** compare against net certified, computed the same way `findOne` does.
Worth a regression test asserting that a receipt equal to `netCertified` yields `PAID` on a
certificate that carries a retention deduction.

**Frontend impact:** the Receipts UI will show allocation amounts and remaining balance,
which are trustworthy, but will not present this endpoint's `status` as settlement truth
until it is fixed. Showing "partially paid" on a fully-paid certificate is the kind of
plausible wrong number that gets a finance officer to stop trusting the system.

---

### <a id="c4"></a>C4 — No guard against over-claiming or a negative period quantity

**Severity:** Correctness — and partly a domain question (see D4).

`IpaService.addItem` computes `periodQuantity = cumulativeClaimed − previousEffectiveCertified`
and stores it without constraining either side. Nothing checks:

- `cumulativeClaimed` against the BOQ node's `quantity` — a line can be claimed well beyond
  the contracted quantity with no warning;
- that `cumulativeClaimed ≥ previousEffectiveCertified` — a lower figure yields a negative
  `periodQuantity` and a negative `periodAmount`, silently.

The negative case may well be legitimate — a claw-back after an over-certification is
normal on measured contracts — which is why this needs a domain answer before the UI
decides whether to block it, warn on it, or accept it silently. Over-claiming past the BOQ
quantity is harder to justify and is likely a data-entry error worth rejecting.

**What the frontend needs:** a decision on each case (see D4), then whatever validation
follows from it. The form will mirror the server's rule rather than invent its own.

---

### <a id="c5"></a>C5 — Workflow policy is resolved but no approval instance is created

**Severity:** Contract clarity. Not a defect — the behaviour is deliberate and commented.

`IpaService.transition` (`ipa.service.ts:99`) resolves the `WorkflowRequirementPolicy` for
`submit-for-approval` and `return-for-revision`, then changes the status directly:

```ts
// Enforce WorkflowRequirementPolicy. Resolver throws 422 if REQUIRED and no binding configured.
// When a binding is found, transition proceeds — approval instance creation is Sprint 4+ work.
```

This is genuinely good news for the frontend: it means IPA lifecycle UI can be built now
without waiting on B3 and B4, which is what unblocked this phase.

Recording it because it changes what the buttons *mean* later. Today `approve-for-submission`
approves. Once approval instances exist, `submit-for-approval` will produce a pending
instance and approval will move to a different actor and a different screen.

**What the frontend is doing about it:** lifecycle controls are built on one shared module
(`getAvailableActions` + `useLifecycleCommand`) so the change lands in one place rather than
across three detail screens. No further backend action needed — please just flag it on the
ADR when the approval instance work is scheduled.

---

### <a id="c6"></a>C6 — Five more aggregates with no DTO in `@erp/types`

Extends B12. `Client`, `Contract` (and its five sub-entities), `Ipa`, `Ipc` and `Receipt`
are all consumed by the frontend with no shared DTO.

Rather than scatter them, all wire shapes now live in one frontend-owned file,
`apps/web/src/lib/api-types.ts`, explicitly marked as a mirror to be deleted when shared
DTOs exist. Drift now has one place to be found instead of a dozen.

**A cheaper ask than hand-writing DTOs:** the API exposes its full OpenAPI document at
`/docs-json`, but every `@ApiResponse` is `{ status, description }` with no `type:`, so the
spec describes request bodies accurately and says nothing about responses. Adding `type:`
to the response decorators would let the frontend generate response types from the live
spec and delete the mirror file permanently — a smaller change than authoring DTOs by hand,
and one that cannot drift.

---

### <a id="c8"></a>C8 — `totalAllocated` returns a number, breaking the money-as-string rule

`getCertificatePaymentSummary` returns `totalAllocated` as a JS number via `Number()`
(`finance-prisma.repository.ts:86–87`), and `getTotalAllocated` (`:44–48`) does the same
before using it in the over-allocation guard.

Every other money field on the API is a decimal string. This is the same class as B7 —
`Decimal` columns summed in binary floating point — and it means the over-allocation check
at `finance.service.ts:59` is itself performed in floating point, on the value that decides
whether a payment is accepted.

**Suggested:** keep the sum in `Prisma.Decimal` and serialize as a string, consistent with
`netCertified` and every other money field.

---

### <a id="c9"></a>C9 — `measurementMethod` and `pricingBasis` can never be set

The roadmap lists "BOQ node extensions (measurementMethod, pricingBasis)" as delivered in
Sprint 3 Phase 1, and the columns do exist on `BoqNode` with defaults `QUANTITY` and
`UNIT_RATE`. Both are returned by the tree endpoint.

But **no DTO accepts either field**. `CreateNodeDto` and `UpdateNodeDto` declare neither,
and `BoqTreeService` never writes them. With `forbidNonWhitelisted: true`, sending one is a
`400`. So every BOQ node in the system is permanently `QUANTITY` / `UNIT_RATE`, and a
lump-sum or milestone-billed line cannot be expressed at all.

This matters downstream: `IpaService.addItem` snapshots `measurementMethod` onto every
claimed line (`ipa.service.ts:148`), so the snapshot is currently always the default. The
IPA item picker will label every line "quantity" regardless of what it really is.

**What the frontend needs:** both fields accepted on create and on update, so a lump-sum
line can be entered. Until then the BOQ editor will not offer the choice — an input that
silently has no effect is worse than no input.

---

### <a id="c10"></a>C10 — Retention split is spelled `…OnPc` going in and `…OnPC` coming out

`AddRetentionTermsDto` declares `retentionSplitOnPc`. The Prisma column is
`retentionSplitOnPC`, and `upsertRetentionTerms`
(`contract-prisma.repository.ts:105–130`) translates between the two.

Nothing is broken server-side, but the request and response shapes for this one field
differ by a single letter's case. Combined with `forbidNonWhitelisted: true`, reading a
contract and posting its retention terms back — the obvious way to write an edit form —
returns:

```
property retentionSplitOnPC should not exist; retentionSplitOnPc is not a valid decimal number.
```

Found by running the seed script against the live API, not by reading the code, which is
roughly how a frontend engineer would find it at 6pm on a Friday.

**Suggested:** rename the DTO field to `retentionSplitOnPC` so request and response agree.
It is a one-word change in a Sprint 3 DTO that no client depends on yet.

---

### <a id="c13"></a>C13 — Cancel and terminate require a reason and discard it

`CancelContractDto` and `TerminateContractDto` both mark `reason` `@IsNotEmpty()` with a
500-character limit, so the client must supply one. `ContractService` then throws it away:

```ts
// contract.service.ts:143 and :158
void reason; // audit trail deferred to Phase 4 AuditLog
```

No column on `Contract` holds it, so the explanation for ending a contract early exists
nowhere after the request completes. The deferral is deliberate and commented — this is
raised because of what it means for the UI, not because it looks accidental.

Terminating a live construction contract is a legally significant act, and "why" is the
part that matters six months later. Projects already do this properly: a suspension reason
is persisted on `ProjectSuspension`.

**What the frontend does meanwhile:** the confirmation dialogs collect the reason, because
the API rejects the request without it, and say plainly that it is not stored yet rather
than implying an audit trail that does not exist.

---

### <a id="c14"></a>C14 — `RETURNED_FOR_REVISION` is a dead end

**Severity:** Blocking for the IPA revision loop. Reproduced against the running API.

`TRANSITIONS['submit-for-approval']` accepts `DRAFT` and nothing else
(`ipa.service.ts:18`), so an application that has been returned for revision can never be
resubmitted:

```
POST /ipa/:id/submit-for-approval
→ 400 "Cannot 'submit-for-approval' an IPA with status 'RETURNED_FOR_REVISION'.
       Expected 'DRAFT'."
```

The state is not merely a gap, it is a trap, because the two halves disagree:

- `MUTABLE_STATUSES` **includes** `RETURNED_FOR_REVISION` (`ipa.service.ts:30`), so items
  and deductions can be added and removed. The reviewer's feedback can be acted on.
- No transition leaves the state except `cancel`.

So a quantity surveyor can be told what to fix, fix it, and then discover the corrected
application cannot go anywhere. The only exit is to cancel and re-enter the whole claim on
a new application — losing the line history that was just corrected.

The name of the transition says what was intended: an application is *returned for
revision* so that it can be revised and come back.

**Suggested fix:** accept `RETURNED_FOR_REVISION` as a second source state for
`submit-for-approval`:

```ts
'submit-for-approval': ['DRAFT', 'RETURNED_FOR_REVISION'],
```

Worth a regression test that walks the full loop — submit, return, edit, resubmit, approve
— since the forward path passes today while the loop does not.

**Frontend impact:** the detail screen shows the full set of line controls in this state,
because the API genuinely allows editing, and an explanation that the result cannot be
submitted. That is the honest presentation of the current behaviour, and it is a bad
screen — it should stop being needed rather than be designed around.

---

### <a id="c15"></a>C15 — Claimed items carry a bare `boqNodeId`

`GET /ipa/:id` returns each `InterimPaymentApplicationItem` with a `boqNodeId` and nothing
that describes it — no `code`, no `description`. `IpaPrismaRepository.findById` includes
`items: true` with no relation expansion, and `BoqNode` is never joined.

So a claimed-lines table built from that response alone can only show an opaque cuid. The
frontend fetches the BOQ tree for the contract's version and joins client-side, which is
affordable here because the line picker needs the tree anyway — but every other consumer
will have to repeat it, and a printed or exported application would too.

**Suggested:** expand the node on the item, or denormalise `code` and `description` onto
the item at creation, the way `measurementMethodSnapshot` and `unitRateSnapshot` already
are. The snapshot argument is stronger here than for most fields: a BOQ line's description
can be reworded in a later version, and a submitted application should keep the wording it
was actually claimed under.

---

### <a id="c17"></a>C17 — A negative allocation is accepted and defeats the over-allocation guard

**Severity:** Correctness. A bug in shipped code, reproduced against the running API.

`AllocateReceiptDto.allocatedAmount` is `@IsDecimal()`, which accepts `"-100.00"`, and
`FinanceService.allocate` guards only the UPPER bound:

```ts
// finance.service.ts:65
if (afterAllocation.greaterThan(receiptAmount)) { throw ... }
```

So a negative allocation passes, and because it is summed into `getTotalAllocated`, it
INCREASES the headroom available to later allocations.

**Reproduced on a 1,000.00 receipt:**

```
allocate  1500.00  → rejected, correctly
allocate  -100.00  → ACCEPTED
allocate   600.00  → accepted
allocate   500.00  → accepted   (600 + 500 = 1100, under the cap only because of the -100)
```

The receipt then reports a total of exactly 1,000.00 and looks fully settled, while holding
a line that means nothing.

**It also persists.** Deleting the negative allocation afterwards leaves the receipt with
**1,100.00 allocated against 1,000.00**, because the guard runs only on insert and nothing
re-checks the invariant on removal. Verified — that is the state the dev database is in
now.

**Suggested fix:**

1. Reject a non-positive `allocatedAmount` — `@IsPositive()` alongside `@IsDecimal()`, or an
   explicit check in the service.
2. Re-assert the invariant on `removeAllocation`, or make the guard a database constraint,
   so an over-allocated receipt cannot survive a delete.

Worth a regression test for the sequence above rather than for a single over-allocation:
the simple case already passes today.

**What the frontend does meanwhile:** `allocationProblem` rejects empty, non-numeric, zero
and negative amounts as well as anything over the remaining balance, so the UI cannot
create this state. It cannot repair a receipt that already holds it.

---

### <a id="c16"></a>C16 — No way to list or attribute certificates by client

`GET /ipc` filters on `applicationId` alone, and a certificate row carries nothing else
identifying — no client, no contract, no project. So answering "which certificates can this
client's payment be allocated against?" means walking

```
certificate → application → contract → client
```

with three unfiltered list calls (`GET /ipc`, `GET /ipa`, `GET /contracts`) and a
client-side join. That is what the allocation picker does today; it is affordable at ACCO's
size and will not stay that way.

The same gap makes the allocation itself unguarded: `FinanceService.allocate` checks that
the certificate belongs to the caller's ORGANIZATION but not that it belongs to the
RECEIPT'S CLIENT, so client A's payment can be allocated against client B's certificate.
Nor is currency checked — a USD receipt allocates against a SOS certificate without
complaint.

**What the frontend needs, in preference order:**

1. `GET /ipc?clientId=` — or a `contractId`/`projectId` filter, from which a client filter
   follows.
2. Expansion of the owning contract and client on the certificate row, so a certificate can
   be labelled without two more round-trips.
3. A server-side check that the certificate and the receipt share a client, and a warning
   or rejection when their currencies differ.

The picker restricts choices to the receipt's own client and flags a currency mismatch, so
our calls are correct — but nothing stops another client from getting it wrong.

---

## Domain questions — for Eng Ahmed Shirie

### <a id="d1"></a>D1 — Mixed-currency BOQ nodes sum into one meaningless total

`currency` is an optional field on each individual BOQ node
(`create-node.dto.ts`, `@IsOptional() @Length(3,3)`). Nothing constrains sibling nodes to
share a currency, and `BoqTreeService.sumTotals` (`boq-tree.service.ts:284`) adds
`computedTotal` across children without inspecting currency at all.

A BOQ containing a USD leaf and a SAR leaf produces a parent total that is arithmetically
the sum of two different currencies, and the UI would display it with a single currency
symbol — confidently wrong, in a document used for contract valuation.

**Questions:**

1. Can a single BOQ ever legitimately hold more than one currency? (Split FX contracts and
   imported-materials packages are the cases I'd expect, but I don't know ACCO's practice.)
2. If not — should currency live on the Project or the BOQ rather than the node, so it
   cannot diverge?
3. If yes — what should a parent total show?

The frontend will not display parent totals for mixed-currency subtrees until this is
settled. Showing a plausible wrong number is worse than showing none.

---

### <a id="d4"></a>D4 — Can a payment application claim less than was already certified?

Context for C4. An IPA line carries `cumulativeClaimed` — the total claimed to date, not
this period — and the server derives the period figure by subtracting what the last
effective certificate certified. Neither side is currently constrained.

**Questions:**

1. Can `cumulativeClaimed` legitimately be *lower* than `previousEffectiveCertified`,
   producing a negative period amount? My assumption is yes — a claw-back after an
   over-certification is normal on measured contracts — but I would rather not assume it.
2. Should a claim be allowed to exceed the BOQ line's contracted quantity? Variations are
   the usual answer, and this platform has no variation module yet, so I expect the answer
   is "reject it for now" — but that decision belongs to you, not to me.
3. If over-claiming is allowed, should the UI warn, require a note, or stay silent?

This decides whether the IPA item form blocks the entry, warns and continues, or accepts it
without comment. The form will implement whatever the API enforces — the request here is
for the rule, not for UI advice.

---

## Documentation

### <a id="d2"></a>D2 — `api-reference.md` gaps

`docs/02-architecture/api-reference.md` is genuinely good and was the fastest way to get
oriented. Three corrections:

1. **§5.8 Suspend/Resume, §5.9 move/delete** — response bodies are not documented and are
   empty. See B6.
2. **§5.4 Roles, §5.6 Audit Logs** — the required `?orgId=` query parameter is not shown
   in the endpoint table. Requests without it currently return an empty result rather than
   an error, which is a confusing failure mode.
3. **§5.7 Workflows** — the `GET definition` entry does not mention the required
   `organizationId`, which is in the request body. See B3.

---

### <a id="d3"></a>D3 — Documented request shapes that return `400`

These matter more than ordinary doc drift, because the global `ValidationPipe` runs with
`forbidNonWhitelisted: true` (`main.ts:18–23`). An unrecognised field is not ignored — it
is a `400`. So a documented example body containing a field the DTO does not declare fails
outright when copied.

1. **`api-reference.md:283–293`, create client.** The example body includes
   `"status": "ACTIVE"`, which `CreateClientDto` does not declare. Posting that example
   verbatim returns `400`. The field should be removed from the example, or accepted by the
   DTO.
2. **`api-reference.md:276` and `apps/web/CLAUDE.md:84`, list clients.** Both document
   `GET /clients (?status=ACTIVE)`. `ClientsController.findAll` takes no query parameters
   and `ClientPrismaRepository.findAll` applies no status filter — the parameter is simply
   ignored. Either implement the filter or drop it from both documents; the frontend
   filters client-side meanwhile, as it does for projects (B8).
3. **Contract lifecycle.** `ContractStatus` includes `TERMINATED`, and `POST
   /contracts/:id/terminate` is documented, but the lifecycle chain shown in
   `roadmap.md:61` and `apps/web/CLAUDE.md:130` ends at `CLOSED` and never mentions the
   terminated state. Worth showing it as a terminal state alongside `CANCELLED`.

---

## What the frontend is building meanwhile

Delivered:

- Auth hardening: silent refresh, session bootstrap, correct logout, host-derived tenant
- App shell: navigation, i18n/RTL, responsive layout
- Dashboard: status counts and recent projects, aggregated client-side (see B8, B10)

- BOQ: initialize, version selection, tree with currency-safe totals, baseline, discard
  draft, start revision, and add/edit/delete of sections and items
- Projects: list, search and filter, create, edit (DRAFT), detail, all six lifecycle
  transitions, cancel, suspend and resume

In progress — the Sprint 3 billing chain, built in this order:

1. Clients
2. Contracts, then contract commercial terms (retention, advances, guarantees, milestones)
3. IPA — creation, item and deduction lines, lifecycle
4. Receipts — recording and allocation against certificates
5. IPC — viewing and supersession first; **issuance is gated on C1**

Deferred pending the items above:

- Project members UI — **B1**, **B2**
- Any approval/workflow UI — **B3**, **B4**
- BOQ parent totals for mixed-currency subtrees — **D1**
- BOQ row reordering — **B14**
- IPA revision loop — **C14**. A returned application is a dead end today.
- IPC issuance — **C1** (and **C2** before any certificate is written in anger)
- Certificate settlement status in the Receipts UI — **C7**

The two security items, **C2** and **C3**, are independent of all of this. Both should be
fixed regardless of what the frontend builds.
