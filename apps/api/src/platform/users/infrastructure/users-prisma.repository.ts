import { Injectable } from '@nestjs/common';

import { UserStatus } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IUsersRepository,
  CreateUserData,
  UpdateUserData,
} from '../domain/interfaces/users-repository.interface.js';
import { UserEntity } from '../domain/entities/user.entity.js';

@Injectable()
export class UsersPrismaRepository implements IUsersRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findById(id: string): Promise<UserEntity | null> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? this.toDomain(user) : null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.findUnique({ where: { email } });
    return user ? this.toDomain(user) : null;
  }

  async findAll(orgId: string): Promise<UserEntity[]> {
    const prisma = this.tenancyService.getClient();
    const users = await prisma.user.findMany({ where: { organizationId: orgId } });
    return users.map((u) => this.toDomain(u));
  }

  async create(data: CreateUserData): Promise<UserEntity> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.create({ data });
    return this.toDomain(user);
  }

  async update(id: string, data: UpdateUserData): Promise<UserEntity> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.update({ where: { id }, data });
    return this.toDomain(user);
  }

  async delete(id: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.user.delete({ where: { id } });
  }

  private toDomain(raw: {
    id: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    status: string;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }): UserEntity {
    return new UserEntity(
      raw.id,
      raw.email,
      raw.passwordHash,
      raw.firstName,
      raw.lastName,
      raw.status as UserStatus,
      raw.organizationId,
      raw.createdAt,
      raw.updatedAt,
    );
  }
}
