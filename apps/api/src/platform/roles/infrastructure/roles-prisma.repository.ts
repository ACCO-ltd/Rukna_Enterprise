import { Injectable } from '@nestjs/common';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IRolesRepository,
  CreateRoleData,
} from '../domain/interfaces/roles-repository.interface.js';
import { RoleEntity } from '../domain/entities/role.entity.js';

@Injectable()
export class RolesPrismaRepository implements IRolesRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findById(id: string): Promise<RoleEntity | null> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.findUnique({ where: { id } });
    return role ? this.toDomain(role) : null;
  }

  async findAll(orgId: string): Promise<RoleEntity[]> {
    const prisma = this.tenancyService.getClient();
    const roles = await prisma.role.findMany({ where: { organizationId: orgId } });
    return roles.map((r) => this.toDomain(r));
  }

  async create(data: CreateRoleData): Promise<RoleEntity> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.create({ data });
    return this.toDomain(role);
  }

  private toDomain(raw: {
    id: string;
    name: string;
    description: string | null;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }): RoleEntity {
    return new RoleEntity(
      raw.id,
      raw.name,
      raw.description,
      raw.organizationId,
      raw.createdAt,
      raw.updatedAt,
    );
  }
}
