import { Injectable, Inject } from '@nestjs/common';

import type { IRolesRepository } from '../domain/interfaces/roles-repository.interface.js';
import type { RoleEntity } from '../domain/entities/role.entity.js';

@Injectable()
export class RolesService {
  constructor(
    @Inject('IRolesRepository')
    private readonly rolesRepository: IRolesRepository,
  ) {}

  async findAll(orgId: string): Promise<RoleEntity[]> {
    return this.rolesRepository.findAll(orgId);
  }
}
