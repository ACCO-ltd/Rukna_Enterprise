# Domain — Platform (foundation)

Cross-cutting capabilities every business module depends on. Platform never depends on a
business module.

| Capability | Code | ADR | Status |
|---|---|---|---|
| Auth (JWT + refresh rotation) | `apps/api/src/platform/auth` | ADR-001/003 | INTEGRATED |
| Multi-tenancy (DB-per-tenant) | `platform/tenancy` | ADR-001 | INTEGRATED |
| Organizations / Membership | `platform/organizations` | ADR-004 | INTEGRATED |
| Roles / Permissions (RBAC) | `platform/roles`, `platform/permissions` | — | INTEGRATED |
| Project access scope | `platform/project-access` | ADR-009 | INTEGRATED |
| Workflow / DOA + governance seam | `platform/workflows` | ADR-008/011/015 | PARTIAL |
| Audit (transactional outbox) | `platform/audit-logs` | ADR-008 | INTEGRATED |
| Notifications | `platform/notifications` (domain stub only) | — | NOT_DESIGNED |

**Key seam:** `CommandGovernanceService.gateStateTransition()` — the single entry point for
RBAC + DOA gating on a state transition. Returns `null` (proceed) or `{ gated: true,
approvalInstanceId }`. `throwIfGated()` throws 409. `GovernedEntity` (in `@erp/types`) types the
entity name at the call site.

**Built (ADR-022):** value-threshold routing (amount-banded `WorkflowTriggerBinding`) and SoD
enforcement (`SegregationOfDutiesService`, called by bills, payments, manual journals, buyer
advances and quotation awards). Both are configured per organization and seeded inactive; go-live
is `governance:seed` then `governance:activate`.

See `docs/reference/tenancy.md`, `docs/reference/boundaries.md`,
`docs/02-domain-boundaries.md`.
