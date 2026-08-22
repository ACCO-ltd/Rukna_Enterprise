import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type { SupplierStatus } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SupplierRepository, CreateSupplierData } from '../infrastructure/supplier.repository.js';

export interface CreateSupplierDto {
  code: string;
  name: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
}

@Injectable()
export class SupplierService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SupplierRepository,
  ) {}

  findAll(identity: RequestIdentity, status?: SupplierStatus) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, status);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const supplier = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  async create(identity: RequestIdentity, dto: CreateSupplierDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`Supplier with code '${dto.code}' already exists`);
    // ADR-022 CONST-DOA-003: record who set the vendor up (the vendor maintainer).
    const data: CreateSupplierData = { organizationId: orgId, createdBy: identity.userId, ...dto };
    return this.repo.create(prisma, data);
  }
}
