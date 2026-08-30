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
  /** Permission catalogue ids to grant. May be omitted/empty. */
  permissionIds?: string[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
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
  permissions: PermissionRef[];
}

/** Row shape for the roles table: cheap aggregates, no permission list. */
export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  permissionCount: number;
  /** Count of ACTIVE membership-role assignments (removedAt null) referencing this role. */
  memberCount: number;
}
