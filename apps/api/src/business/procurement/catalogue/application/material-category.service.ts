import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { MaterialCategoryRepository } from '../infrastructure/material-category.repository.js';

export interface CreateMaterialCategoryDto {
  code: string;
  name: string;
  nameAr?: string;
  parentCode?: string;
}

@Injectable()
export class MaterialCategoryService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: MaterialCategoryRepository,
  ) {}

  findAll(identity: RequestIdentity) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, 'ACTIVE');
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const cat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!cat) throw new NotFoundException(`Material category ${id} not found`);
    return cat;
  }

  async create(identity: RequestIdentity, dto: CreateMaterialCategoryDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`Material category code '${dto.code}' already exists`);

    let parentId: string | undefined;
    if (dto.parentCode) {
      const parent = await this.repo.findByCode(prisma, orgId, dto.parentCode);
      if (!parent) throw new NotFoundException(`Parent category '${dto.parentCode}' not found`);
      parentId = parent.id;
    }

    return this.repo.create(prisma, { organizationId: orgId, code: dto.code, name: dto.name, nameAr: dto.nameAr, parentId });
  }

  async deactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const cat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!cat) throw new NotFoundException(`Material category ${id} not found`);
    return this.repo.setStatus(prisma, id, 'INACTIVE');
  }
}
