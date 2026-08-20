# ADR-009: Collapse Project-Access Scope Resolution into ProjectAccessService

Status: ACCEPTED
Date: 2026-08-11
Deciders: Abdulsalam (Backend Engineer)
Supersedes: Nothing — internal refactor of `platform/project-access/`.

---

## Context

`ProjectAccessService` controls whether a user must be filtered to only their own
project memberships (regular member) or may see all projects (bypass role). The
bypass logic was originally gated on a public `hasBypass(identity)` method. Four
calling services — `project.service.ts`, `contract.service.ts`, `ipa.service.ts`,
and `ipc.service.ts` — repeated the same inline decision:

```ts
// leaking bypass knowledge to every caller
this.projectAccess.hasBypass(identity) ? undefined : identity.userId
```

This violates the **Single Responsibility** principle (constraint 3.5 in
`constraints.md`) and the module-boundary rule that callers must not depend on a
service's internal decision logic. Every new service that filters collections would
need to copy the same bypass-check pattern. Any change to the bypass rule (new
role, new condition) would require updating four independent call-sites instead of
one.

---

## Decision

1. **Add `scopedUserId(identity): string | undefined` to `ProjectAccessService`.**
   It returns `undefined` when the caller has a bypass role (meaning: no
   membership filter) and `identity.userId` otherwise.

2. **Make `hasBypass` private.** No code outside `ProjectAccessService` may
   observe whether a role has bypass privilege. The concept is an implementation
   detail of the service.

3. **Update the four callers** (`project.service.ts`, `contract.service.ts`,
   `ipa.service.ts`, `ipc.service.ts`) to call `this.projectAccess.scopedUserId(identity)`
   instead of the inline ternary.

The resulting contract:

```ts
// ProjectAccessService — public surface
scopedUserId(identity: RequestIdentity): string | undefined
accessibleProjectIds(identity: RequestIdentity): Promise<string[] | undefined>
assertMember(identity: RequestIdentity, projectId: string): Promise<void>
assertContract(identity: RequestIdentity, contractId: string): Promise<void>
assertApplication(identity: RequestIdentity, applicationId: string): Promise<void>
assertCertificate(identity: RequestIdentity, certificateId: string): Promise<void>

// private — no external access
private hasBypass(identity: RequestIdentity): boolean
```

---

## Consequences

**Positive**

- Callers no longer know about the bypass/userId mechanism. Adding or removing a
  bypass role requires changing only `ProjectAccessService`.
- `hasBypass` can be extended (e.g., to check a feature flag or an org-level
  override) without touching any business service.
- New collection-scoping services follow the same one-call pattern: call
  `scopedUserId`, pass the result to the repository filter.
- Consistent with constraint ARCH-BOUNDARY-001 implied by `boundaries.md` —
  modules communicate through explicit public interfaces only.

**Neutral**

- The refactor is a pure rename/encapsulation; no database queries change, no
  permissions change, no API contracts change.
- The `scopedUserId` method is synchronous (no Prisma call) — callers that need
  the full membership ID list continue to use `accessibleProjectIds`.

**Negative / Risks**

- None identified. The change reduces surface area and duplicated logic.

---

## Implementation notes

- `ProjectAccessService` lives at `apps/api/src/platform/project-access/`.
- All four callers are in `apps/api/src/business/construction/` and
  `apps/api/src/business/procurement/`.
- The spec file `project-access.service.spec.ts` must cover `scopedUserId` for
  bypass roles and for regular members; `hasBypass` should have no direct tests
  (it is private implementation detail).
- The refactor is complete as of the date of this ADR — this document
  post-records the decision.
