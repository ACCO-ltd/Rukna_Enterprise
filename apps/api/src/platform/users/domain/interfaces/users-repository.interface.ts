import { UserStatus } from '@erp/types';

import type { UserEntity } from '../entities/user.entity.js';

export interface IUsersRepository {
  findById(id: string, organizationId: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findAll(orgId: string): Promise<UserEntity[]>;
  create(data: CreateUserData): Promise<UserEntity>;
  update(id: string, data: UpdateUserData): Promise<UserEntity>;
  delete(id: string): Promise<void>;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  organizationId: string;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  status?: UserStatus;
}
