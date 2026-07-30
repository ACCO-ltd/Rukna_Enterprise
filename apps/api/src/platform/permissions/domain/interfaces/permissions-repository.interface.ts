import type { PermissionEntity } from '../entities/permission.entity.js';

export interface IPermissionsRepository {
  findAll(): Promise<PermissionEntity[]>;
  findById(id: string): Promise<PermissionEntity | null>;
  create(data: CreatePermissionData): Promise<PermissionEntity>;
}

export interface CreatePermissionData {
  action: string;
  resource: string;
  description?: string;
}
