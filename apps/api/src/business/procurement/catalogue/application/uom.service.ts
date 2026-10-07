import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { RequestIdentity, UnitOfMeasureLookupStatus, UnitOfMeasureOption } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { UomRepository } from '../infrastructure/uom.repository.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { changeCatalogueStatus, type CatalogueStatusFilter } from './catalogue-status.js';

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
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  findAll(identity: RequestIdentity, status: CatalogueStatusFilter = 'ACTIVE') {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, status === 'ALL' ? undefined : status);
  }

  /**
   * The registry as a lookup for any member of the organization (`GET /units-of-measure`). Scoped
   * to the caller's active organization like every other read here; returns the projection only.
   */
  listLookup(
    identity: RequestIdentity,
    status: UnitOfMeasureLookupStatus = 'ACTIVE',
  ): Promise<UnitOfMeasureOption[]> {
    const prisma = this.tenancy.getClient();
    return this.repo.findLookup(prisma, identity.activeOrganizationId, status);
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
    return changeCatalogueStatus(prisma, this.auditOutbox, identity, {
      resourceType: 'UnitOfMeasure',
      resourceId: id,
      label: `Unit ${uom.code}`,
      from: uom.status,
      to: 'INACTIVE',
      allowedFrom: ['ACTIVE'],
      sourceCommand: 'uom.deactivate',
      eventType: 'UOM_DEACTIVATED',
      write: (tx) => this.repo.setStatus(tx, id, 'INACTIVE'),
    });
  }

  async reactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const uom = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!uom) throw new NotFoundException(`Unit of measure ${id} not found`);
    return changeCatalogueStatus(prisma, this.auditOutbox, identity, {
      resourceType: 'UnitOfMeasure',
      resourceId: id,
      label: `Unit ${uom.code}`,
      from: uom.status,
      to: 'ACTIVE',
      allowedFrom: ['INACTIVE'],
      sourceCommand: 'uom.reactivate',
      eventType: 'UOM_REACTIVATED',
      write: (tx) => this.repo.setStatus(tx, id, 'ACTIVE'),
    });
  }
}
