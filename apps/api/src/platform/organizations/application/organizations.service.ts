import { ForbiddenException, Injectable, Inject } from '@nestjs/common';

import { PlatformFileService } from '../../files/application/platform-file.service.js';
import type {
  IOrganizationsRepository,
  OrganizationBrandingPatch,
} from '../domain/interfaces/organizations-repository.interface.js';
import type { OrganizationEntity } from '../domain/entities/organization.entity.js';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject('IOrganizationsRepository')
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly files: PlatformFileService,
  ) {}

  async findById(id: string, activeOrganizationId: string): Promise<OrganizationEntity | null> {
    if (id !== activeOrganizationId) return null;
    return this.organizationsRepository.findById(id);
  }

  /**
   * A caller may only brand their own active organization — `id` is a URL param the client
   * controls, `activeOrganizationId` is the tenant resolved from the request, and the two must
   * agree or this is cross-tenant write, not a 404-worthy typo.
   */
  async updateBranding(
    id: string,
    activeOrganizationId: string,
    patch: OrganizationBrandingPatch,
  ): Promise<OrganizationEntity> {
    if (id !== activeOrganizationId) {
      throw new ForbiddenException('Cannot update branding for another organization.');
    }
    const updated = await this.organizationsRepository.updateBranding(id, patch);

    // TEMPORARY → BOUND, same as every other "attach a fresh upload to a record" flow (DPR
    // evidence, document revisions). A previously-bound logo the org is replacing is left as-is —
    // this system never unbinds a file, only stops referencing it; see PlatformFileService.bind.
    if (patch.logoFileId) {
      await this.files.bind(patch.logoFileId, `organization logo for ${id}`);
    }

    return updated;
  }
}
