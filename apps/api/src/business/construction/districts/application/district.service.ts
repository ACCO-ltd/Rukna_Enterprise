import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { DistrictRepository } from '../infrastructure/district-prisma.repository.js';
import type { CreateDistrictDto, UpdateDistrictDto } from '../presentation/dto/district.dto.js';

/**
 * ADR-025 — the district registry. Districts are org-scoped construction reference data and the
 * site segment of a project code (WBR in ACCO-WBR-26-0065). The `code` is immutable once created
 * because project codes key on it; the `name` and `active` flag are editable. Managed in Settings
 * so ACCO can add districts beyond Banaadir.
 */
@Injectable()
export class DistrictService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: DistrictRepository,
  ) {}

  list(identity: RequestIdentity, activeOnly: boolean) {
    return this.repo.list(this.tenancy.getClient(), identity.activeOrganizationId, activeOnly);
  }

  async create(identity: RequestIdentity, dto: CreateDistrictDto) {
    const prisma = this.tenancy.getClient();
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('District code is required');

    const duplicate = await this.repo.findByCode(prisma, identity.activeOrganizationId, code);
    if (duplicate) throw new ConflictException(`District code '${code}' already exists`);

    return this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      code,
      name: dto.name.trim(),
    });
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateDistrictDto) {
    const prisma = this.tenancy.getClient();
    const existing = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!existing) throw new NotFoundException(`District ${id} not found`);

    return this.repo.update(prisma, id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    });
  }
}
