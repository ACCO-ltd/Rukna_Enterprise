import type { RoleEntity } from '../entities/role.entity.js';

export interface IRolesRepository {
  findById(id: string): Promise<RoleEntity | null>;
  findAll(orgId: string): Promise<RoleEntity[]>;
  create(data: CreateRoleData): Promise<RoleEntity>;
}

export interface CreateRoleData {
  name: string;
  description?: string;
  organizationId: string;
}
