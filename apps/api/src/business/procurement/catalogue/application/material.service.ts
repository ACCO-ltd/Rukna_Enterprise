import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { MaterialRepository } from '../infrastructure/material.repository.js';
import { UomRepository } from '../infrastructure/uom.repository.js';
import { MaterialCategoryRepository } from '../infrastructure/material-category.repository.js';
import { SpendCategoryRepository } from '../infrastructure/spend-category.repository.js';

export interface CreateMaterialDto {
  code: string;
  name: string;
  description?: string;
  materialCategoryCode: string;
  defaultSpendCategoryCode?: string;
  baseUomCode: string;
}

@Injectable()
export class MaterialService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: MaterialRepository,
    private readonly uomRepo: UomRepository,
    private readonly categoryRepo: MaterialCategoryRepository,
    private readonly spendRepo: SpendCategoryRepository,
  ) {}

  findAll(identity: RequestIdentity, filters?: { materialCategoryId?: string; spendCategoryId?: string }) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, { status: 'ACTIVE', ...filters });
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const mat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mat) throw new NotFoundException(`Material ${id} not found`);
    return mat;
  }

  async create(identity: RequestIdentity, dto: CreateMaterialDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`Material code '${dto.code}' already exists`);

    const uom = await this.uomRepo.findByCode(prisma, orgId, dto.baseUomCode);
    if (!uom) throw new NotFoundException(`UoM code '${dto.baseUomCode}' not found`);
    if (uom.status !== 'ACTIVE') throw new BadRequestException(`UoM '${dto.baseUomCode}' is inactive`);

    const category = await this.categoryRepo.findByCode(prisma, orgId, dto.materialCategoryCode);
    if (!category) throw new NotFoundException(`Material category '${dto.materialCategoryCode}' not found`);

    let defaultSpendCategoryId: string | undefined;
    if (dto.defaultSpendCategoryCode) {
      const spend = await this.spendRepo.findByCode(prisma, orgId, dto.defaultSpendCategoryCode);
      if (!spend) throw new NotFoundException(`Spend category '${dto.defaultSpendCategoryCode}' not found`);
      defaultSpendCategoryId = spend.id;
    }

    return this.repo.create(prisma, {
      organizationId: orgId,
      code: dto.code,
      name: dto.name,
      description: dto.description,
      materialCategoryId: category.id,
      defaultSpendCategoryId,
      baseUnitOfMeasureId: uom.id,
    });
  }

  async discontinue(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const mat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mat) throw new NotFoundException(`Material ${id} not found`);
    return this.repo.setStatus(prisma, id, 'DISCONTINUED');
  }
}
