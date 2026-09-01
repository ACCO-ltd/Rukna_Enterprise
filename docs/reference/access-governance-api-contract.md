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

A `policyKey` is the stable identity. `WorkflowPolicyVersion` contains trigger binding, conditions,
ordered role-based rules, submitter, reviewer/publisher, effective time, validation result, and
state. An `ACTIVE` or `RETIRED` version is immutable — changes are made by cloning it into a new
`DRAFT` (rollback) or by authoring a new draft.

The implemented lifecycle is effective-dated: `DRAFT → IN_REVIEW → SCHEDULED → ACTIVE → RETIRED`
(`SUPERSEDED` reserved). "Publishing" is scheduling a reviewed version for a future effective date
and then activating it once due — not a single `PUBLISHED` state.

Only conditions in the transaction-type registry may be persisted. Monetary bands are inclusive at
the lower bound and exclusive at the upper bound; overlapping active bindings with equal priority
are rejected.

Endpoints are served under `/workflows/policies` (the workflows module owns the authoring surface).

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/workflows/policies` | `view:workflow` | List all policy versions for the org (status, effective dates, rule counts). |
| `GET` | `/workflows/policies/by-key/:policyKey/versions` | `view:workflow` | List every version of one policy key, newest first (version-history view). |
| `GET` | `/workflows/policies/compare?base=<id>&target=<id>` | `view:workflow` | Diff two versions of the same key: rules added/removed/changed + SoD differences. Backs comparison and rollback preview. |
| `GET` | `/workflows/policies/:id` | `view:workflow` | Version detail with rules. |
| `GET` | `/workflows/policies/:id/history` | `view:workflow` | Audit history for the version. |
| `POST` | `/workflows/policies` | `manage:workflow` | Create draft version. |
| `POST` | `/workflows/policies/:id/rules` | `manage:workflow` | Add a closed-schema PENDING rule to a draft. |
| `PATCH` | `/workflows/policies/:id/rules/:ruleId` | `manage:workflow` | Edit a draft rule. |
| `DELETE` | `/workflows/policies/:id/rules/:ruleId` | `manage:workflow` | Remove a draft rule. |
| `POST` | `/workflows/policies/:id/rules/reorder` | `manage:workflow` | Reorder draft rules. |
| `POST` | `/workflows/policies/:id/validate` | `manage:workflow` | Return structural, overlap, role, and SoD results. |
| `POST` | `/workflows/policies/:id/simulate` | `manage:workflow` | Resolve sample trigger input without creating an approval instance. |
| `POST` | `/workflows/policies/:id/submit-review` | `manage:workflow` | Move a valid draft to `IN_REVIEW`. |
| `POST` | `/workflows/policies/:id/schedule` | `publish:workflow` | Schedule an in-review version for a future effective date (four-eyes). |
| `POST` | `/workflows/policies/:id/activate` | `publish:workflow` | Activate a due scheduled version. |
| `POST` | `/workflows/policies/:id/retire` | `publish:workflow` | Retire an active version with reason and effective time. |
| `POST` | `/workflows/policies/:id/clone` | `manage:workflow` | Clone any version into a new draft (rollback). |

Scheduling, activation, and retirement require a non-empty `reason`. Scheduling rejects the version
submitter as publisher (four-eyes, `409`), a non-future effective date (`400`), and validation
failures (`400`). In-flight approvals keep their original version. `publish:workflow` is held by the
`ADMIN`, `CFO`, and `GOVERNANCE_PUBLISHER` roles.

## 5. Audit contract

Upgrade existing `GET /audit-logs` to platform pagination and filters: `from`, `to`, `actorId`,
`area`, `action`, `resource`, `resourceId`, and `outcome`. It returns immutable event metadata and
redacted before/after summaries.

New actions include `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_INVITATION_REVOKED`,
`USER_INVITATION_ACCEPTED`, `USER_SESSIONS_REVOKED`, `ROLE_TEMPLATE_CLONED`, `ROLE_ACCESS_REVIEWED`,
`APPROVAL_POLICY_RULE_UPDATED`, `APPROVAL_POLICY_RULE_DELETED`, `APPROVAL_POLICY_RULES_REORDERED`,
`APPROVAL_POLICY_SOD_CONFIGURED`, `APPROVAL_POLICY_ROLLBACK_CLONED`, and the lifecycle-transition
actions `APPROVAL_POLICY_IN_REVIEW`, `APPROVAL_POLICY_SCHEDULED`, `APPROVAL_POLICY_ACTIVE`, and
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
