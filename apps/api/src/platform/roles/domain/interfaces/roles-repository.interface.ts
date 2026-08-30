import type { RoleEntity } from '../entities/role.entity.js';

export interface IRolesRepository {
  findById(id: string): Promise<RoleEntity | null>;
  findAll(orgId: string): Promise<RoleEntity[]>;
  create(data: CreateRoleData): Promise<RoleEntity>;

  /** Org-scoped fetch (never trust a bare id across tenants). */
  findByIdInOrg(id: string, orgId: string): Promise<RoleEntity | null>;
  /** True if another role in the org already uses this name (optionally excluding one id). */
  nameExists(orgId: string, name: string, excludeId?: string): Promise<boolean>;

  /** Detail with its permission catalogue rows. Org-scoped. */
  findWithPermissions(id: string, orgId: string): Promise<RoleWithPermissionsRecord | null>;
  /** Summary rows with cheap aggregates for the roles table. */
  listSummaries(orgId: string): Promise<RoleSummaryRecord[]>;

  /** Create a role and, atomically, its RolePermission rows. permissionIds pre-validated. */
  createWithPermissions(data: CreateRoleWithPermissionsData): Promise<RoleWithPermissionsRecord>;
  update(id: string, orgId: string, data: UpdateRoleData): Promise<void>;

  /** Replace the role's permission set: delete rows not in the set, create the new ones. */
  replacePermissions(id: string, orgId: string, permissionIds: string[]): Promise<void>;

  /** Count of ACTIVE membership-role assignments (removedAt null) referencing this role. */
  countActiveAssignments(id: string): Promise<number>;
  /** Hard-delete the role (RolePermission cascades). Org-scoped. */
  delete(id: string, orgId: string): Promise<void>;

  /** Count permissionIds (from the given set) that exist in the catalogue. */
  countPermissionsInCatalogue(permissionIds: string[]): Promise<number>;
}

export interface CreateRoleData {
  name: string;
  description?: string;
  organizationId: string;
}

export interface UpdateRoleData {
  name?: string;
  description?: string;
}

export interface CreateRoleWithPermissionsData {
  name: string;
  description?: string;
  organizationId: string;
  permissionIds: string[];
}

export interface RolePermissionRecord {
  id: string;
  action: string;
  resource: string;
}

export interface RoleWithPermissionsRecord {
  id: string;
  name: string;
  description: string | null;
  permissions: RolePermissionRecord[];
}

export interface RoleSummaryRecord {
  id: string;
  name: string;
  description: string | null;
  permissionCount: number;
  memberCount: number;
}
