import { Injectable, Inject } from '@nestjs/common';

import type { IOrganizationsRepository } from '../domain/interfaces/organizations-repository.interface.js';
import type { OrganizationEntity } from '../domain/entities/organization.entity.js';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject('IOrganizationsRepository')
    private readonly organizationsRepository: IOrganizationsRepository,
  ) {}

  async findById(id: string, activeOrganizationId: string): Promise<OrganizationEntity | null> {
    if (id !== activeOrganizationId) return null;
    return this.organizationsRepository.findById(id);
  }
}
