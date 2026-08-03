# Frontend → Backend Requests

Raised by: Frontend Engineer (`apps/web`, `packages/ui`)
For: **Abdulsalam** (backend, `apps/api`) — and where marked, **Eng Ahmed Shirie** (domain)
Date: 2026-08-03
Status: Open

This document is the source of truth for backend work the frontend is waiting on.
Items marked **Blocking** prevent a UI surface from functioning at all — they are not
feature requests.

Findings were produced by reading `apps/api/src` directly, not by inference from docs.
Line references are against commit `e1f2139`.

---

## Summary

| ID | Severity | Area | Summary |
|---|---|---|---|
| [B1](#b1) | **Blocking — bug** | Projects | No project can ever get its first member |
| [B2](#b2) | **Blocking** | Users | No endpoint lists users in an organization |
| [B3](#b3) | **Blocking** | Workflows | `GET` endpoint requires a request body — uncallable from a browser |
| [B4](#b4) | **Security** | Workflows | Approver identity is taken from the request body |
| [B5](#b5) | **Security** | Roles, Audit | `orgId` read from query string, unscoped by token |
| [B11](#b11) | **Security** | BOQ | Version endpoints missing the organization check |
| [B6](#b6) | Contract | Several | Undocumented empty response bodies |
| [B7](#b7) | Correctness | BOQ | Money totals computed in floating point |
| [B8](#b8) | Scale | Projects | No pagination, search, or sort |
| [B9](#b9) | Gap | Users | No way to persist a language preference |
| [B10](#b10) | Gap | Projects | No summary/aggregate endpoint |
| [D1](#d1) | **Domain** | BOQ | Mixed-currency nodes sum into one meaningless total |
| [D2](#d2) | Docs | — | `api-reference.md` inaccuracies |

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

## What the frontend is building meanwhile

Unblocked and in progress:

- Auth hardening: silent refresh, session bootstrap, correct logout, host-derived tenant
- App shell: navigation, i18n/RTL, responsive layout
- Dashboard: status counts and recent projects
- Projects: list, create, detail, lifecycle transitions, suspend/resume

Deferred pending the items above:

- Project members UI — **B1**, **B2**
- Any approval/workflow UI — **B3**, **B4**
- BOQ parent totals for mixed-currency subtrees — **D1**
