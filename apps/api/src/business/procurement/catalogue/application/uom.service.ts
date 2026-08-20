import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { UomRepository } from '../infrastructure/uom.repository.js';

export interface CreateUomDto {
  code: string;
  name: string;
  symbol: string;
}

@Injectable()
export class UomService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: UomRepository,
  ) {}

  findAll(identity: RequestIdentity) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, 'ACTIVE');
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const uom = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!uom) throw new NotFoundException(`Unit of measure ${id} not found`);
    return uom;
  }

  async create(identity: RequestIdentity, dto: CreateUomDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`UoM code '${dto.code}' already exists`);
    return this.repo.create(prisma, { organizationId: orgId, ...dto });
  }

  async deactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const uom = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!uom) throw new NotFoundException(`Unit of measure ${id} not found`);
    return this.repo.setStatus(prisma, id, 'INACTIVE');
  }
}
