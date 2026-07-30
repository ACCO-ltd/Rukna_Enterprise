import { Injectable } from '@nestjs/common';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IPermissionsRepository,
  CreatePermissionData,
} from '../domain/interfaces/permissions-repository.interface.js';
import { PermissionEntity } from '../domain/entities/permission.entity.js';

@Injectable()
export class PermissionsPrismaRepository implements IPermissionsRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findAll(): Promise<PermissionEntity[]> {
    const prisma = this.tenancyService.getClient();
    const perms = await prisma.permission.findMany();
    return perms.map((p) => this.toDomain(p));
  }

  async findById(id: string): Promise<PermissionEntity | null> {
    const prisma = this.tenancyService.getClient();
    const perm = await prisma.permission.findUnique({ where: { id } });
    return perm ? this.toDomain(perm) : null;
  }

  async create(data: CreatePermissionData): Promise<PermissionEntity> {
    const prisma = this.tenancyService.getClient();
    const perm = await prisma.permission.create({ data });
    return this.toDomain(perm);
  }

  private toDomain(raw: {
    id: string;
    action: string;
    resource: string;
    description: string | null;
    createdAt: Date;
  }): PermissionEntity {
    return new PermissionEntity(raw.id, raw.action, raw.resource, raw.description, raw.createdAt);
  }
}
