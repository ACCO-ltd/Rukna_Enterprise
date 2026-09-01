import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type { SupplierStatus } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { SupplierRepository, CreateSupplierData, UpdateSupplierData } from '../infrastructure/supplier.repository.js';

export interface CreateSupplierDto {
  code: string;
  name: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
}

export interface UpdateSupplierDto {
  name?: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  address?: string;
}

// A15 (D8): the master-data fields an edit may touch. `code` (identity) and `status` are
// intentionally excluded — editing supplier master data cannot change the supplier's stable
// identity, and status is owned by a separate activate/deactivate flow.
const EDITABLE_FIELDS = ['name', 'taxNumber', 'defaultCurrency', 'paymentTermsDays', 'address'] as const;

@Injectable()
export class SupplierService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SupplierRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
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

  /**
   * A15 (D8): correct supplier master data (name, tax number, default currency, payment
   * terms, address). Permission-gated + audited. Edits ONLY the master record — the supplier's
   * `code`/identity and `status` are not touched, and no historical transactional facts are
   * rewritten: issued POs and SupplierBills reference the supplier by FK (`supplierId`) and
   * snapshot no supplier fields, so future usage reads the corrected values while past documents
   * carry no stale copy to rewrite.
   */
  async update(identity: RequestIdentity, id: string, dto: UpdateSupplierDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // Keep only defined, editable keys — silently drops any stray field (e.g. code) and lets us
    // detect an empty edit.
    const patch: UpdateSupplierData = {};
    for (const key of EDITABLE_FIELDS) {
      if (dto[key] !== undefined) (patch as Record<string, unknown>)[key] = dto[key];
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('At least one editable field must be provided');
    }

    // Org-scope: 404 if the supplier is not in the caller's organization (no cross-tenant edits).
    const existing = await this.repo.findById(prisma, orgId, id);
    if (!existing) throw new NotFoundException(`Supplier ${id} not found`);

    // before/after limited to the changed fields — the audit trail of the correction.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof UpdateSupplierData)[]) {
      before[key] = existing[key] ?? null;
      after[key] = patch[key] ?? null;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, patch);

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Supplier',
        resourceId: id,
        sourceCommand: 'supplier.update',
        eventType: 'SUPPLIER_MASTER_DATA_UPDATED',
        idempotencyKey: `supplier-update-${id}-${Date.now()}`,
        before,
        after,
      });

      return updated;
    });
  }
}
