import { Injectable, Inject } from '@nestjs/common';

import { PERMISSION_DEFINITIONS, type PermissionDefinition } from '@erp/types';
import type { IPermissionsRepository } from '../domain/interfaces/permissions-repository.interface.js';

export type PermissionCatalogueResponse = {
  id: string;
  action: string;
  resource: string;
  description: string | null;
  domain: string;
  riskClass: PermissionDefinition['riskClass'];
};

const metadataByKey = new Map<string, PermissionDefinition>(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition]),
);

@Injectable()
export class PermissionsService {
  constructor(
    @Inject('IPermissionsRepository')
    private readonly permissionsRepository: IPermissionsRepository,
  ) {}

  async findAll(): Promise<PermissionCatalogueResponse[]> {
    const permissions = await this.permissionsRepository.findAll();
    return permissions.map((permission) => {
      const metadata = metadataByKey.get(`${permission.action}:${permission.resource}`);
      return {
        id: permission.id,
        action: permission.action,
        resource: permission.resource,
        description: permission.description,
        domain: permission.domain || metadata?.domain || 'Platform',
        riskClass: permission.riskClass || metadata?.riskClass || 'HIGH',
      };
    });
  }
}
