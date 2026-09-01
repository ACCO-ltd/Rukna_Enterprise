import { UserStatus } from '@erp/types';

import type { UserEntity } from '../entities/user.entity.js';

export interface IUsersRepository {
  findById(id: string, organizationId: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findAll(orgId: string): Promise<UserEntity[]>;
  create(data: CreateUserData): Promise<UserEntity>;
  update(id: string, data: UpdateUserData): Promise<UserEntity>;
  delete(id: string): Promise<void>;

  // ─── Read model (memberships → roles) ──────────────────────────────────────
  findByOrganizationWithRoles(orgId: string): Promise<UserWithRolesRecord[]>;
  findByIdWithRoles(id: string, orgId: string): Promise<UserWithRolesRecord | null>;

  // ─── Provisioning + role administration (all org-scoped, atomic) ────────────
  /**
   * Atomically create the User (ACTIVE), a default ACTIVE OrganizationMembership,
   * and one OrganizationMembershipRole per roleId (assignedBy = actorUserId).
   * roleIds are assumed pre-validated to belong to the organization.
   */
  createWithMembership(data: CreateUserWithMembershipData): Promise<UserWithRolesRecord>;

  /** Set the user's status and password hash (either may be provided). Org-scoped. */
  updateStatus(id: string, orgId: string, status: UserStatus): Promise<void>;
  updatePassword(id: string, orgId: string, passwordHash: string): Promise<void>;

  /** Deactivate: user INACTIVE + membership non-ACTIVE with removedAt/removedBy set. */
  deactivate(id: string, orgId: string, actorUserId: string): Promise<void>;
  /** Reactivate: user ACTIVE + membership ACTIVE, removedAt/removedBy cleared. */
  reactivate(id: string, orgId: string): Promise<void>;

  /**
   * Replace the role set on the user's org membership: soft-remove assignments whose
   * roleId is not in roleIds, and add/un-remove the rest (assignedBy = actorUserId).
   * roleIds are assumed pre-validated to belong to the organization.
   */
  replaceMembershipRoles(id: string, orgId: string, roleIds: string[], actorUserId: string): Promise<void>;

  /** Count roleIds (from the given set) that exist in the organization. */
  countRolesInOrg(orgId: string, roleIds: string[]): Promise<number>;
  completeTemporaryPasswordChange(id: string, orgId: string, passwordHash: string, actorUserId: string): Promise<void>;
  regenerateTemporaryPassword(id: string, orgId: string, passwordHash: string, expiresAt: Date, actorUserId: string): Promise<boolean>;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  organizationId: string;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  status?: UserStatus;
}

export interface CreateUserWithMembershipData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  roleIds: string[];
  actorUserId: string;
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: Date;
  auditAction?: string;
}

export interface UserWithRolesRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  membershipStatus: import('@erp/types').MembershipStatus | null;
  roles: { id: string; name: string }[];
}
