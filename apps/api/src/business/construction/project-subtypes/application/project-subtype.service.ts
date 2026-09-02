import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectCategory } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectSubtypeRepository } from '../infrastructure/project-subtype-prisma.repository.js';
import type { CreateProjectSubtypeDto } from '../presentation/dto/project-subtype.dto.js';

/**
 * Project type (PTD1-PTD5) — the subtype registry. Subtypes are org-scoped classification data
 * within a fixed ProjectCategory: a pure reporting attribute that drives no workflow, template or
 * approval, and is not part of the project code (ADR-025 unchanged). Managed in Settings and created
 * inline from the project form. Mirrors the District registry: name is unique within its category,
 * a subtype is deactivated (never deleted) to hide it from new-project pickers while the projects
 * already classified under it keep their history.
 */
@Injectable()
export class ProjectSubtypeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectSubtypeRepository,
  ) {}

  list(identity: RequestIdentity, filter: { category?: ProjectCategory; activeOnly?: boolean }) {
    return this.repo.list(this.tenancy.getClient(), identity.activeOrganizationId, filter);
  }

  async create(identity: RequestIdentity, dto: CreateProjectSubtypeDto) {
    const prisma = this.tenancy.getClient();
    const name = dto.name.trim();

    const duplicate = await this.repo.findByCategoryAndName(
      prisma,
      identity.activeOrganizationId,
      dto.category,
      name,
    );
    if (duplicate) {
      throw new ConflictException(`Subtype '${name}' already exists for category ${dto.category}`);
    }

    return this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      category: dto.category,
      name,
    });
  }

  async deactivate(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const existing = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!existing) throw new NotFoundException(`Project subtype ${id} not found`);

    return this.repo.updateStatus(prisma, id, 'INACTIVE');
  }
}
