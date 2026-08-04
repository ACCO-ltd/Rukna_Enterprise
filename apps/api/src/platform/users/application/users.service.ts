import { Injectable, Inject } from '@nestjs/common';

import type { IUsersRepository } from '../domain/interfaces/users-repository.interface.js';
import type { UserEntity } from '../domain/entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject('IUsersRepository')
    private readonly usersRepository: IUsersRepository,
  ) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.usersRepository.findById(id);
  }

  async findByOrganization(organizationId: string): Promise<UserEntity[]> {
    return this.usersRepository.findAll(organizationId);
  }
}
