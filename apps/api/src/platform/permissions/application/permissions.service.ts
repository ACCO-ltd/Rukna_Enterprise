import { Injectable, Inject } from '@nestjs/common';

import type { IPermissionsRepository } from '../domain/interfaces/permissions-repository.interface.js';
import type { PermissionEntity } from '../domain/entities/permission.entity.js';

@Injectable()
export class PermissionsService {
  constructor(
    @Inject('IPermissionsRepository')
    private readonly permissionsRepository: IPermissionsRepository,
  ) {}

  async findAll(): Promise<PermissionEntity[]> {
    return this.permissionsRepository.findAll();
  }
}
