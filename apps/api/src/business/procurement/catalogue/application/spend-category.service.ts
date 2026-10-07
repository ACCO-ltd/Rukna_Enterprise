import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SpendCategoryRepository } from '../infrastructure/spend-category.repository.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { changeCatalogueStatus, type CatalogueStatusFilter } from './catalogue-status.js';

export interface CreateSpendCategoryDto {
  code: string;
  name: string;
  parentCode?: string;
}

@Injectable()
export class SpendCategoryService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SpendCategoryRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  findAll(identity: RequestIdentity, status: CatalogueStatusFilter = 'ACTIVE') {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, status);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const cat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!cat) throw new NotFoundException(`Spend category ${id} not found`);
    return cat;
  }

  async create(identity: RequestIdentity, dto: CreateSpendCategoryDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`Spend category code '${dto.code}' already exists`);

    let parentId: string | undefined;
    if (dto.parentCode) {
      const parent = await this.repo.findByCode(prisma, orgId, dto.parentCode);
      if (!parent) throw new NotFoundException(`Parent category '${dto.parentCode}' not found`);
      parentId = parent.id;
    }

    return this.repo.create(prisma, { organizationId: orgId, code: dto.code, name: dto.name, parentId });
  }

  async deactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const cat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!cat) throw new NotFoundException(`Spend category ${id} not found`);
    return changeCatalogueStatus(prisma, this.auditOutbox, identity, {
      resourceType: 'SpendCategory',
      resourceId: id,
      label: `Spend category ${cat.code}`,
      from: cat.status,
      to: 'INACTIVE',
      allowedFrom: ['ACTIVE'],
      sourceCommand: 'spend-category.deactivate',
      eventType: 'SPEND_CATEGORY_DEACTIVATED',
      write: (tx) => this.repo.setStatus(tx, id, 'INACTIVE'),
    });
  }

  async reactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const cat = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!cat) throw new NotFoundException(`Spend category ${id} not found`);
    return changeCatalogueStatus(prisma, this.auditOutbox, identity, {
      resourceType: 'SpendCategory',
      resourceId: id,
      label: `Spend category ${cat.code}`,
      from: cat.status,
      to: 'ACTIVE',
      allowedFrom: ['INACTIVE'],
      sourceCommand: 'spend-category.reactivate',
      eventType: 'SPEND_CATEGORY_REACTIVATED',
      write: (tx) => this.repo.setStatus(tx, id, 'ACTIVE'),
    });
  }
}
