# Access governance (ADR-027) — go-live rollout checklist

**Status:** Rollout runbook (Work Package E, item 8c).
**Audience:** Whoever cuts the ACCO governance go-live.
**Principle (from ADR-027 / the API contract):** ship the authoring surface behind a platform
feature flag; migrate `ADMIN` to a system role; keep read-only workflow endpoints; and enable policy
authoring **only after** seeded ACCO policies validate in a non-production tenant.

The authoring surface is OFF by default (`GOVERNANCE_AUTHORING_ENABLED` unset ⇒ disabled). Every step
below runs with it still OFF, except the final flip. Reads (policy inventory, version history,
compare, bindings) work throughout; only the write endpoints are gated.

Run each step against the target tenant with `DATABASE_URL` pointing at that tenant's database.

---

## 0. Prerequisites

- [ ] Tenant is provisioned and migrated (`pnpm --filter @erp/api db:migrate:tenant:prod`). New
      tenants already get the governed SYSTEM roles at provision time (`scripts/tenant-provision.ts`
      → `seedGovernedSystemRoles`); an already-provisioned tenant (the live ACCO DB) needs step 1.
- [ ] **Audit-outbox delivery decision made.** Governance writes emit `auditOutboxEvent` rows, but
      nothing drains them yet (see [audit-outbox-delivery.md](./audit-outbox-delivery.md)). Before any
      downstream consumer is told to rely on outbox delivery, schedule the relay
      (`AuditOutboxPublisherService.publishPending`). If no consumer exists yet, record that events
      are intentionally undelivered. The immutable `audit_logs` trail is unaffected either way.

## 1. Back-fill publish authority (existing tenants only)

- [ ] Run the WP-A back-fill seed on the ACCO tenant:

      ```
      cd apps/api
      DATABASE_URL=<acco-tenant-db> ORG_SLUG=acco npx tsx prisma/seeds/sync-governance-publish-authority.seed.ts
      ```

      `prisma/seeds/sync-governance-publish-authority.seed.ts` upserts the two governed SYSTEM roles
      (`CFO`, `GOVERNANCE_PUBLISHER`) via `scripts/governed-roles.ts` → `seedGovernedSystemRoles`, links
      their permission sets **including `publish:workflow`**, and ensures `ADMIN` also carries
      `publish:workflow` + `view:governance-impact`. Idempotent and additive — safe to re-run.

- [ ] Confirm: `CFO` and `GOVERNANCE_PUBLISHER` exist with `kind = SYSTEM` and both hold
      `publish:workflow`. (This is exactly what part 1 of the acceptance test — step 4 — asserts.)

## 2. Seed the ACCO governance configuration (if not already seeded)

- [ ] Seed the workflow chains, value bands, lifecycle/BOQ chains, and SoD rules into the tenant:

      ```
      pnpm --filter @erp/api governance:seed        # prisma/seeds/seed-acco-governance.seed.ts
      ```

      This runs `seedAccoWorkflows` (`src/platform/workflows/seeders/acco-workflows.seed.ts`), which
      builds from `acco-value-bands.ts` and `acco-lifecycle-chains.ts`. Everything is seeded
      **inactive**; the ACCO_GOVERNANCE policy version is ACTIVE only so the mandatory SoD rules take
      effect. No transaction routing switches on here.

## 3. Assign CFO / Governance Publisher roles to real users

- [ ] Assign the `CFO` and `GOVERNANCE_PUBLISHER` SYSTEM roles to the real people who will hold them
      (via the administration user/role screens or membership seeding). The publisher of a policy
      version **must be a different person from its submitter** — four-eyes is enforced in
      `WorkflowsService.schedulePolicy` (`409` when the submitter tries to publish their own version).
- [ ] Confirm the matrix (see [acco-approval-policy-matrix.md](./acco-approval-policy-matrix.md)):
      reviewer/publisher = CFO or Governance Administrator, activator = CFO after the effective date,
      Platform Administrator is never an approver for a business transaction.

## 4. Run the non-production acceptance test

- [ ] Run the end-to-end governance acceptance test against a non-prod Postgres:

      ```
      cd apps/api
      DATABASE_URL=<non-prod-tenant-db> npx jest src/platform/workflows/__tests__/governance-acceptance.spec.ts
      ```

      `src/platform/workflows/__tests__/governance-acceptance.spec.ts` seeds its own isolated tenant
      and proves the full loop: the governed roles seed, authoring a version DRAFT → add rule →
      submit-review → schedule (four-eyes) → activate through the real `WorkflowsService`, then a real
      manual-journal `DRAFT → SUBMITTED` that is correctly gated (an approval instance is required,
      the submitter cannot self-approve under SoD, and an authorized approver completes it). It cleans
      up after itself. It requires a reachable Postgres (it is an integration test, run in CI).

## 5. Validate seeded ACCO policies in a non-production tenant (flag still OFF)

- [ ] With `GOVERNANCE_AUTHORING_ENABLED` still OFF, use the read endpoints to inspect the seeded
      policies in the non-prod tenant: `GET /workflows/policies`, `.../by-key/:policyKey/versions`,
      `.../compare`, `.../:id`, `.../bindings`. Reads are ungated; authoring writes return
      `403 "Governance authoring is not enabled"`.
- [ ] Confirm the seeded ACCO_GOVERNANCE policy and its SoD rules read as expected and the value-band
      bindings are present and inactive. Only proceed to step 6 once this validation passes — this is
      the ADR-027 contract's gate ("enable policy authoring only after seeded ACCO policies validate
      in a non-production tenant").

## 6. Flip the feature flag ON

- [ ] Set the platform feature flag and restart the API process:

      ```
      GOVERNANCE_AUTHORING_ENABLED=true
      ```

      Only the literal `true` / `1` enables it (`GovernanceAuthoringConfig`); anything else fails safe
      to OFF. This is a process-level env flag — no schema change, no migration.

- [ ] Verify the flag is live: `GET /health` returns
      `capabilities.governanceAuthoringEnabled: true`. The web reads this to reveal the authoring
      affordances (it still additionally honours each caller's `manage:workflow` / `publish:workflow`
      permission — the flag gates the whole surface, the permissions gate the individual actor).
- [ ] Smoke-test one authoring write end-to-end in the non-prod tenant (create draft → add rule →
      submit-review → schedule with a different publisher → activate) before enabling in production.

## Rollback

- [ ] To withdraw the authoring surface, unset `GOVERNANCE_AUTHORING_ENABLED` (or set it to `false`)
      and restart. Writes 403 again immediately; reads and any already-active policies are unaffected.
      In-flight `ApprovalInstance`s always continue against the version that created them (GOV-ADM-005),
      so disabling authoring never changes routing for an approval already under way.

---

## Referenced artefacts

| Step | Artefact |
|---|---|
| 1 | `apps/api/prisma/seeds/sync-governance-publish-authority.seed.ts` → `scripts/governed-roles.ts` |
| 2 | `pnpm --filter @erp/api governance:seed` → `apps/api/prisma/seeds/seed-acco-governance.seed.ts` → `src/platform/workflows/seeders/acco-workflows.seed.ts` (uses `acco-value-bands.ts`) |
| 4 | `apps/api/src/platform/workflows/__tests__/governance-acceptance.spec.ts` |
| 6 | `GOVERNANCE_AUTHORING_ENABLED` — `src/platform/workflows/application/governance-authoring.config.ts`; surfaced on `GET /health` |
| 0 | [audit-outbox-delivery.md](./audit-outbox-delivery.md) |
| — | [acco-approval-policy-matrix.md](./acco-approval-policy-matrix.md) |
