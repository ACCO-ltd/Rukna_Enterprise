import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { MeasurementMethod, PricingBasis } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqItemLibraryRepository } from '../infrastructure/boq-item-library.repository.js';

export interface CreateBoqItemDto {
  code: string;
  description: string;
  defaultUnit?: string;
  measurementMethod?: MeasurementMethod;
  pricingBasis?: PricingBasis;
  category?: string;
}

export interface RecordItemUsageDto {
  rate: string | number;
  projectId?: string;
}

/**
 * ADR-020 CONST-BOQ-020/021 — the reusable BOQ work-item library. QSs search it and add items fast;
 * it grows just-in-time via "save to library & add". It carries no authoritative rate — only a
 * last-used rate recorded on use, surfaced as assistance.
 */
@Injectable()
export class BoqItemLibraryService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: BoqItemLibraryRepository,
  ) {}

  search(identity: RequestIdentity, query?: string) {
    const prisma = this.tenancy.getClient();
    return this.repo.search(prisma, identity.activeOrganizationId, query);
  }

  async create(identity: RequestIdentity, dto: CreateBoqItemDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`A library item with code '${dto.code}' already exists`);
    return this.repo.create(prisma, {
      organizationId: orgId,
      code: dto.code,
      description: dto.description,
      defaultUnit: dto.defaultUnit,
      measurementMethod: dto.measurementMethod,
      pricingBasis: dto.pricingBasis,
      category: dto.category,
      createdBy: identity.userId,
    });
  }

  /** Records the rate an item was just used at (CONST-BOQ-021 — assistance, not authoritative). */
  async recordUsage(identity: RequestIdentity, id: string, dto: RecordItemUsageDto) {
    const prisma = this.tenancy.getClient();
    const item = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!item) throw new NotFoundException(`Library item ${id} not found`);
    return this.repo.recordUsage(prisma, id, {
      lastUsedRate: new Decimal(dto.rate),
      lastUsedProjectId: dto.projectId,
    });
  }
}
