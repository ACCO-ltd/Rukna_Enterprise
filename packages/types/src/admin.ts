// User + Role administration contracts (write side).
// Imported by apps/web to wire the admin screens without guessing API shapes.
// The API validates these with class-validator DTOs; these interfaces are the
// transport contract, not the validation source of truth.

import type { UserStatus } from './user';
import type { MembershipStatus } from './enums';

// ─── Users ──────────────────────────────────────────────────────────────────

export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  /** Plaintext; API hashes with bcrypt cost 12. Minimum length 12. */
  password: string;
  /** Role ids to assign on the user's default org membership. May be empty. */
  roleIds: string[];
}

export interface ProvisionTemporaryUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
}

export interface ProvisionTemporaryUserResponse {
  user: UserWithRolesResponse;
  /** Returned once for authorized delivery to the user; never persisted by the client. */
  temporaryPassword: string;
  expiresAt: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
}

export interface SetUserPasswordRequest {
  /** Plaintext; API hashes with bcrypt cost 12. Minimum length 12. */
  password: string;
}

export interface SetUserRolesRequest {
  roleIds: string[];
}

export interface RoleRef {
  id: string;
  name: string;
}

export interface UserWithRolesResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  /** Membership status on the caller's active organization, if a membership exists. */
  membershipStatus: MembershipStatus | null;
  roles: RoleRef[];
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export interface CreateRoleRequest {
  name: string;
  description?: string;
  /** Why this custom role exists; displayed in access reviews. */
  purpose?: string;
  templateRoleId?: string;
  /** Permission catalogue ids to grant. May be omitted/empty. */
  permissionIds?: string[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  purpose?: string;
}

export interface SetRolePermissionsRequest {
  permissionIds: string[];
}

/** A permission as exposed on a role, keyed by catalogue id with its action:resource string. */
export interface PermissionRef {
  id: string;
  action: string;
  resource: string;
  /** Convenience `action:resource` form. */
  key: string;
}

export interface RoleWithPermissionsResponse {
  id: string;
  name: string;
  description: string | null;
  kind: 'SYSTEM' | 'CUSTOM';
  purpose: string | null;
  ownerUserId: string | null;
  templateRoleId: string | null;
  permissions: PermissionRef[];
}

/** Row shape for the roles table: cheap aggregates, no permission list. */
export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  kind: 'SYSTEM' | 'CUSTOM';
  purpose: string | null;
  ownerUserId: string | null;
  templateRoleId: string | null;
  permissionCount: number;
  /** Count of ACTIVE membership-role assignments (removedAt null) referencing this role. */
  memberCount: number;
}

// ─── Approval-policy versions (ADR-027 GOV-ADM-005) ───────────────────────────
// Read side for the policy version-history, comparison, and rollback-preview views.
// The API is the source of truth for the lifecycle: DRAFT → IN_REVIEW → SCHEDULED
// → ACTIVE → RETIRED (effective-dated). SUPERSEDED is reserved.

export type ApprovalPolicyStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'RETIRED';

/** One version of a policyKey, as listed in the version-history view. */
export interface ApprovalPolicyVersionSummary {
  id: string;
  policyKey: string;
  version: number;
  status: ApprovalPolicyStatus;
  ruleCount: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** All versions of a single policyKey, newest first. */
export interface ApprovalPolicyVersionHistory {
  policyKey: string;
  versions: ApprovalPolicyVersionSummary[];
}

/** The comparable, rule-level shape of one policy rule (order-independent, keyed by ruleKey). */
export interface ApprovalPolicyRuleSnapshot {
  ruleKey: string;
  transactionType: string | null;
  priority: number;
  requiredRole: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  fromState: string | null;
  toState: string | null;
}

/** A field that differs between the base and target snapshot of a changed rule. */
export interface ApprovalPolicyRuleFieldChange {
  field: keyof Omit<ApprovalPolicyRuleSnapshot, 'ruleKey'>;
  base: string | number | null;
  target: string | number | null;
}

/** A rule that exists in both versions but whose configuration changed. */
export interface ApprovalPolicyRuleChange {
  ruleKey: string;
  changes: ApprovalPolicyRuleFieldChange[];
}

/** An SoD rule difference between the two versions, keyed by (unversioned) code. */
export interface ApprovalPolicySodDiff {
  code: string;
  base: { description: string; isActive: boolean } | null;
  target: { description: string; isActive: boolean } | null;
}

/**
 * Diff of two versions of the same policyKey. Backs both the version-comparison view and the
 * rollback preview (compare an old version as `target` against the current active version as
 * `base` to see what activating the clone would change).
 */
export interface ApprovalPolicyComparison {
  policyKey: string;
  base: ApprovalPolicyVersionSummary;
  target: ApprovalPolicyVersionSummary;
  rules: {
    added: ApprovalPolicyRuleSnapshot[];
    removed: ApprovalPolicyRuleSnapshot[];
    changed: ApprovalPolicyRuleChange[];
  };
  sodRules: ApprovalPolicySodDiff[];
}
