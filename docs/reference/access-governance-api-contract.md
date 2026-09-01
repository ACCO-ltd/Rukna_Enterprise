# Access Governance API Contract

**Status:** Proposed implementation contract for ADR-027  
**Owner:** Platform backend  
**Scope:** Additive API and data contract. No endpoint in this document exists yet unless marked
`existing`.

## Principles

- Authenticated administration endpoints derive the organization from `RequestIdentity`, never from
  an organization ID supplied by the browser.
- All identifiers are opaque CUIDs; timestamps are ISO 8601 UTC; paginated endpoints use the
  platform pagination contract.
- Every write requires the listed permission, validates server-side, and writes an audit event in
  the same transaction.
- Sensitive tokens, secrets, and password values are write-only. They never appear in responses,
  audit payloads, or application logs.

## 1. Permission additions

Keep existing permissions (`manage:user`, `manage:role`, `manage:workflow`, `view:audit-log`). Add:

| Key | Purpose |
|---|---|
| `publish:workflow` | Publish or retire an approval-policy version. |
| `view:governance-impact` | Read role/policy impact previews containing affected-user counts. |

Permission catalogue responses gain `domain`, `actionCategory`, `description`, `riskClass`, and
`sodRuleCodes`; existing `id`, `action`, `resource`, and `key` remain backward compatible.

## 2. Invitations

`UserInvitation` belongs to one tenant and organization. It stores email, person name, role IDs,
token hash, status, expiry, inviter, accepted/revoked timestamps, and audit fields. Status is
`PENDING | ACCEPTED | EXPIRED | REVOKED`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `POST` | `/user-invitations` | `manage:user` | Create invitation; revoke pending invitation for that email/org. |
| `GET` | `/user-invitations` | `manage:user` | Paginated list, filterable by status/email. |
| `POST` | `/user-invitations/:id/resend` | `manage:user` | Revoke previous token and issue a replacement. |
| `POST` | `/user-invitations/:id/revoke` | `manage:user` | Revoke a pending invitation. |
| `POST` | `/public/invitations/accept` | public | Consume a valid token once, set password, create/activate membership and roles. |

Create body:

```json
{"email":"person@company.com","firstName":"Amina","lastName":"Hassan","roleIds":["role_cuid"]}
```

Accept body:

```json
{"token":"write-only-secret","password":"write-only-secret"}
```

Create/resend returns invitation metadata and `deliveryStatus`; it never returns a token, link, or
password. Notification delivery is a port. A delivery enqueue failure is retryable and must not
leave an undisclosed usable invitation without an audited recovery path.

### Interim temporary-password provisioning

Until invitation delivery is operational, the following authenticated endpoints are the approved
interim onboarding contract. They are tenant and organization scoped through the request identity.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `POST` | `/users/provision-temporary` | `manage:user` | Create a user with a random, one-time temporary password that expires in 72 hours. |
| `POST` | `/users/change-temporary-password` | authenticated, password-change-only | Replace the temporary password and release the access gate. |

Provisioning accepts `{ email, firstName, lastName, roleIds }` and returns the generated password
exactly once with its expiry timestamp. The API persists only its bcrypt hash. The password-change
endpoint accepts `{ password }`, requires at least 12 characters, and may be the only protected
endpoint accessible to a user who must change their password. Once notification delivery is live,
these endpoints are retired in favour of the invitation aggregate above. Completing the change
increments the server-side session version and revokes every refresh token, so all prior sessions
are invalid immediately.

## 3. Roles and permission catalogue

Role list/detail responses add `kind` (`SYSTEM | CUSTOM`), `templateRoleId`, `purpose`,
`ownerUserId`, `memberCount`, `riskClass`, `lastChangedAt`, and `lastChangedBy`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/role-templates` | `view:role` | List protected system templates. |
| `POST` | `/roles` | `manage:role` | Create custom role from `templateRoleId`; purpose and owner required. |
| `GET` | `/roles/:id/impact` | `view:governance-impact` | Preview members, permission delta, and SoD findings. |
| `PUT` | `/roles/:id/permissions` | `manage:role` | Replace custom-role permissions after impact validation. |

System-role update, permission replacement, and deletion return `409 ROLE_IS_SYSTEM`. A custom role
that is assigned cannot be deleted and returns `409 ROLE_IN_USE` with its member count.

## 4. Approval-policy authoring

`ApprovalPolicy` is the stable identity. `ApprovalPolicyVersion` contains trigger binding,
conditions, ordered role-based steps, editor, reviewer/publisher, effective time, validation
result, and state. Published versions are immutable.

Only conditions in the transaction-type registry may be persisted. Monetary bands are inclusive at
the lower bound and exclusive at the upper bound; overlapping active bindings with equal priority
are rejected.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/approval-policies` | `view:workflow` | Paginated policy list with active-version summary. |
| `POST` | `/approval-policies` | `manage:workflow` | Create draft policy. |
| `GET` | `/approval-policies/:id` | `view:workflow` | Detail with version history. |
| `PATCH` | `/approval-policies/:id/draft` | `manage:workflow` | Edit current draft only. |
| `POST` | `/approval-policies/:id/validate` | `manage:workflow` | Return structural, overlap, role, and SoD results. |
| `POST` | `/approval-policies/:id/simulate` | `view:workflow` | Resolve sample trigger input without creating an approval instance. |
| `POST` | `/approval-policies/:id/submit-review` | `manage:workflow` | Move valid draft to `IN_REVIEW`. |
| `POST` | `/approval-policies/:id/publish` | `publish:workflow` | Publish after four-eyes validation. |
| `POST` | `/approval-policies/:id/retire` | `publish:workflow` | Retire active version with reason and effective time. |

Publication and retirement require a non-empty `reason`. Publish rejects the last editor as
publisher (`409 WORKFLOW_FOUR_EYES_VIOLATION`), validation failures (`400`), and active-binding
collisions (`409`). The service compiles a published version into the existing workflow definition
and trigger-binding read model transactionally. In-flight approvals keep their original version.

## 5. Audit contract

Upgrade existing `GET /audit-logs` to platform pagination and filters: `from`, `to`, `actorId`,
`area`, `action`, `resource`, `resourceId`, and `outcome`. It returns immutable event metadata and
redacted before/after summaries.

New actions include `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_INVITATION_REVOKED`,
`USER_INVITATION_ACCEPTED`, `USER_SESSIONS_REVOKED`, `ROLE_TEMPLATE_CLONED`,
`ROLE_IMPACT_REVIEWED`, `APPROVAL_POLICY_DRAFTED`, `APPROVAL_POLICY_VALIDATED`,
`APPROVAL_POLICY_SUBMITTED_FOR_REVIEW`, `APPROVAL_POLICY_PUBLISHED`, and
`APPROVAL_POLICY_RETIRED`.

## 6. Required tests and rollout

1. Tenant and organization isolation for every new endpoint.
2. Invitation token hashing, single use, expiry, resend/revoke, password policy, and session
   invalidation.
3. System-role immutability, template cloning, permission impact, and SoD validation.
4. Policy overlap, version immutability, in-flight approval continuity, four-eyes publishing, and
   simulation.
5. Transactional audit evidence for every administrative command.

Ship behind a platform feature flag. Migrate `ADMIN` to a system role, retain current read-only
workflow endpoints, and enable policy authoring only after seeded ACCO policies validate in a
non-production tenant.
