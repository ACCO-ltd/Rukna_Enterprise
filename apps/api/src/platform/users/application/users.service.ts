import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { RequestIdentity } from '@erp/types';

import { AuditLogsService } from '../../audit-logs/application/audit-logs.service.js';
import type {
  IUsersRepository,
  UserWithRolesRecord,
} from '../domain/interfaces/users-repository.interface.js';
import type { UserEntity } from '../domain/entities/user.entity.js';
import type { CreateUserDto } from '../presentation/dto/create-user.dto.js';
import type { UpdateUserDto } from '../presentation/dto/update-user.dto.js';
import type { SetUserPasswordDto } from '../presentation/dto/set-user-password.dto.js';
import type { SetUserRolesDto } from '../presentation/dto/set-user-roles.dto.js';
import type { ProvisionTemporaryUserDto } from '../presentation/dto/provision-temporary-user.dto.js';
import type { ChangeTemporaryPasswordDto } from '../presentation/dto/change-temporary-password.dto.js';

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;

@Injectable()
export class UsersService {
  constructor(
    @Inject('IUsersRepository')
    private readonly usersRepository: IUsersRepository,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findById(id: string, organizationId: string): Promise<UserEntity | null> {
    return this.usersRepository.findById(id, organizationId);
  }

  async findByOrganization(organizationId: string): Promise<UserWithRolesRecord[]> {
    return this.usersRepository.findByOrganizationWithRoles(organizationId);
  }

  async findByIdWithRoles(id: string, organizationId: string): Promise<UserWithRolesRecord> {
    const record = await this.usersRepository.findByIdWithRoles(id, organizationId);
    if (!record) throw new NotFoundException(`User ${id} not found`);
    return record;
  }

  async create(identity: RequestIdentity, dto: CreateUserDto): Promise<UserWithRolesRecord> {
    const orgId = identity.activeOrganizationId;

    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) throw new ConflictException(`Email '${dto.email}' is already in use`);

    await this.assertRolesInOrg(orgId, dto.roleIds);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const created = await this.usersRepository.createWithMembership({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      organizationId: orgId,
      roleIds: dto.roleIds,
      actorUserId: identity.userId,
    });

    await this.audit(identity, 'USER_CREATED', created.id, { roleIds: dto.roleIds });
    return created;
  }

  async provisionTemporary(identity: RequestIdentity, dto: ProvisionTemporaryUserDto) {
    if (await this.usersRepository.findByEmail(dto.email)) throw new ConflictException(`Email '${dto.email}' is already in use`);
    await this.assertRolesInOrg(identity.activeOrganizationId, dto.roleIds);
    const temporaryPassword = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const user = await this.usersRepository.createWithMembership({
      email: dto.email, firstName: dto.firstName, lastName: dto.lastName, roleIds: dto.roleIds,
      organizationId: identity.activeOrganizationId, actorUserId: identity.userId,
      passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_COST),
      mustChangePassword: true, temporaryPasswordExpiresAt: expiresAt,
      auditAction: 'USER_TEMPORARY_CREDENTIAL_CREATED',
    });
    return { user, temporaryPassword, expiresAt };
  }

  async changeTemporaryPassword(identity: RequestIdentity, dto: ChangeTemporaryPasswordDto): Promise<void> {
    if (!identity.mustChangePassword) throw new BadRequestException('A temporary password change is not required');
    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    await this.usersRepository.completeTemporaryPasswordChange(identity.userId, identity.activeOrganizationId, await bcrypt.hash(dto.password, BCRYPT_COST), identity.userId);
  }

  async regenerateTemporaryPassword(identity: RequestIdentity, id: string) {
    await this.requireUser(id, identity.activeOrganizationId);
    const temporaryPassword = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const updated = await this.usersRepository.regenerateTemporaryPassword(
      id,
      identity.activeOrganizationId,
      await bcrypt.hash(temporaryPassword, BCRYPT_COST),
      expiresAt,
      identity.userId,
    );
    if (!updated) throw new BadRequestException('Only active users can receive a temporary password');
    await this.audit(identity, 'USER_SESSIONS_REVOKED', id);
    return { temporaryPassword, expiresAt };
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateUserDto): Promise<UserWithRolesRecord> {
    const orgId = identity.activeOrganizationId;
    await this.requireUser(id, orgId);
    await this.usersRepository.update(id, {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
    });
    return this.findByIdWithRoles(id, orgId);
  }

  async deactivate(identity: RequestIdentity, id: string): Promise<UserWithRolesRecord> {
    const orgId = identity.activeOrganizationId;
    if (identity.userId === id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    await this.requireUser(id, orgId);
    await this.usersRepository.deactivate(id, orgId, identity.userId);
    return this.findByIdWithRoles(id, orgId);
  }

  async reactivate(identity: RequestIdentity, id: string): Promise<UserWithRolesRecord> {
    const orgId = identity.activeOrganizationId;
    await this.requireUser(id, orgId);
    await this.usersRepository.reactivate(id, orgId);
    await this.audit(identity, 'USER_REACTIVATED', id);
    return this.findByIdWithRoles(id, orgId);
  }

  async setPassword(identity: RequestIdentity, id: string, dto: SetUserPasswordDto): Promise<void> {
    const orgId = identity.activeOrganizationId;
    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    await this.requireUser(id, orgId);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    await this.usersRepository.updatePassword(id, orgId, passwordHash);
    await this.audit(identity, 'USER_PASSWORD_RESET', id);
  }

  async setRoles(identity: RequestIdentity, id: string, dto: SetUserRolesDto): Promise<UserWithRolesRecord> {
    const orgId = identity.activeOrganizationId;
    await this.requireUser(id, orgId);
    await this.assertRolesInOrg(orgId, dto.roleIds);
    await this.usersRepository.replaceMembershipRoles(id, orgId, dto.roleIds, identity.userId);
    await this.audit(identity, 'USER_ROLES_CHANGED', id, { roleIds: dto.roleIds });
    return this.findByIdWithRoles(id, orgId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireUser(id: string, orgId: string): Promise<UserEntity> {
    const user = await this.usersRepository.findById(id, orgId);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  private async assertRolesInOrg(orgId: string, roleIds: string[]): Promise<void> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) return;
    const found = await this.usersRepository.countRolesInOrg(orgId, unique);
    if (found !== unique.length) {
      throw new BadRequestException('One or more roleIds are invalid for this organization');
    }
  }

  private async audit(
    identity: RequestIdentity,
    action: string,
    resourceId: string,
    after?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLogs.log({
        userId: identity.userId,
        orgId: identity.activeOrganizationId,
        action,
        resource: 'user',
        resourceId,
        ...(after ? { after } : {}),
      });
    } catch {
      // Audit is best-effort; never fail the operation on a logging error.
    }
  }
}
