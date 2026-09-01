# ADR-027: Access Governance Administration

**Status:** ACCEPTED  
**Date:** 2026-08-31  
**Decision owners:** Abdulsalam (Backend), Eng Ahmed Shirie (Business / governance)

## Context

Rukna already enforces organization-scoped RBAC, approval routing, segregation of duties (SoD),
and transactional audit logging. The current administration screens expose only fragments of that
capability: users are created with an administrator-visible temporary password, roles are edited as
raw permission sets, and workflow configuration is read-only. This is insufficient for a governed
enterprise platform.

Administration is a Platform concern. It must remain independent of construction, procurement, and
accounting modules, while those modules continue to consume its public RBAC and approval-gate seam.

## Decision

### GOV-ADM-001 — Administration is an Access & Governance workspace

The product groups administration capabilities as People, Roles & permissions, Approval policies,
Organization data, and Audit log. This is a frontend information-architecture decision; the global
sidebar remains a flat domain-to-destination navigation model.

### GOV-ADM-002 — User onboarding is invitation-based, with a controlled interim path

The target onboarding flow is an invitation: administrators invite a person by work email and assigned
role IDs, the server stores only a hash of a single-use invitation token, and the recipient chooses
their own password through a public acceptance endpoint before expiry. Plaintext passwords and
invitation tokens are never stored, logged, or returned in an API response.

Until a notification delivery provider is available, the approved interim flow provisions a random,
one-time temporary password. It is returned once to the authorized administrator, never persisted in
plaintext, expires after 72 hours, and is accepted only to establish a session that can change the
password. Every other authenticated endpoint is blocked until that change succeeds. Expiry, creation,
password change, deactivation, and session revocation are audited. Completing the password change
increments a server-checked session version and revokes active refresh tokens, invalidating every
prior access and refresh token.

Resend revokes the previous unaccepted invitation before issuing a new one. Revocation, expiry, and
acceptance are explicit states. Suspending a user revokes all active refresh-token families and
prevents future authenticated requests.

### GOV-ADM-003 — Roles are governed templates or controlled custom roles

The platform seeds named system-role templates for approved ACCO operating roles. A system role is
inspectable but its name, purpose, and permission set cannot be edited or deleted through the
organization administration API. A custom role must be created from a system or custom template,
has a business purpose and named owner, and is editable only by `manage:role`.

Direct per-user permission overrides are out of scope. Access is role-derived. A future exception
grant, if required, must be a separate time-bound aggregate with a reason, approver, expiry, and
audit history; it must not be hidden inside `OrganizationMembership`.

### GOV-ADM-004 — Permission catalogue metadata is authoritative

The existing `action:resource` key remains the authorization truth. The platform permission
catalogue is extended with stable metadata: domain, action category, human-readable description,
risk class, and optional SoD implications. The frontend renders this metadata; it must not infer
semantics from permission-key strings.

### GOV-ADM-005 — Approval policies are versioned, not mutable workflows

An approval-policy authoring API manages drafts of the existing `WorkflowDefinition` and
`WorkflowTriggerBinding` capability. A policy version has a trigger, constrained conditions, ordered
role-based approval steps, and publication metadata. Versions are immutable once published.

An in-flight `ApprovalInstance` always continues against the definition/version that created it.
Publishing a replacement changes routing only for later commands. The generic command gate remains
`CommandGovernanceService`; business modules do not import the administration authoring module.

### GOV-ADM-006 — Policy authoring uses a closed schema

The authoring API accepts only registered transaction types, transitions, condition fields,
operators, and role identifiers. It does not accept executable expressions, arbitrary entity fields,
or named-person approval steps. Before draft save and publication, the server validates duplicate or
overlapping bindings, invalid value bands, unavailable roles, empty chains, and SoD violations.

### GOV-ADM-007 — Publication is controlled and auditable

A policy follows the effective-dated lifecycle `DRAFT → IN_REVIEW → SCHEDULED → ACTIVE → RETIRED`
(`SUPERSEDED` is reserved for a version replaced by a later active one). "Publish" is the act of
scheduling a reviewed version for a future effective date and then activating it once that date is
due — it is not a single `PUBLISHED` state. Scheduling/activation requires `publish:workflow` and a
publisher distinct from the version's submitter (four-eyes, enforced in
`WorkflowsService.schedulePolicy`). The system records submitter, reviewer/publisher, reason,
effective time, validation result, and before/after routing impact. An active policy is retired
(effective-dated) rather than edited or deleted. Rollback is a clone-of-an-old-version into a new
DRAFT, never an in-place edit of a past version.

### GOV-ADM-008 — Every governance write is evidence

Invitation, role, permission-set, policy draft, policy test, policy review, publication, retirement,
and user-status changes are immutable audit events written transactionally with the mutation. Audit
reads are paginated and filterable; audit records are never editable or deletable.

### GOV-ADM-009 — Tenant and organization isolation are mandatory

All administration aggregates reside in the tenant database and every organization-owned query
filters by `RequestIdentity.activeOrganizationId`. Tenant access continues to resolve only through
`TenancyService`. Public invitation acceptance obtains tenant identity from the invitation's
tenant-scoped route/token and may not use an unverified client-supplied organization ID.

## Consequences

- The first implementation adds invitation, role-template metadata, permission metadata, and
  versioned policy-authoring contracts; it does not replace the existing approval engine.
- Notification delivery is a separate Platform dependency. The temporary-password flow is removed
  once secure invitation delivery is available; it is not an alternative long-term credential model.
- Existing `ADMIN` data must migrate to a protected system role without removing current permissions.
- Existing read-only workflow endpoints remain supported during rollout.

## Rejected alternatives

- **Direct user permissions:** creates untraceable access drift and bypasses role review.
- **Editing a published workflow in place:** changes the authority basis of running approvals.
- **A free-form automation canvas:** permits rules the domain and approval engine cannot validate.
- **Administrator-created plaintext credentials:** exposes passwords and cannot prove secure delivery.

## Required follow-up

Implement: contract/types → migration and repositories → invitation/auth commands → role catalogue
→ policy draft/version/publication → administration UI. Each phase requires API, authorization,
audit, tenant/org isolation, and regression tests.
