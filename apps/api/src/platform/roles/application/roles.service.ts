import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  RequestIdentity,
  RoleWithPermissionsResponse,
  RoleSummary,
} from '@erp/types';

import { AuditLogsService } from '../../audit-logs/application/audit-logs.service.js';
import type {
  IRolesRepository,
  RoleWithPermissionsRecord,
} from '../domain/interfaces/roles-repository.interface.js';
import type { RoleEntity } from '../domain/entities/role.entity.js';
import type { CreateRoleDto } from '../presentation/dto/create-role.dto.js';
import type { UpdateRoleDto } from '../presentation/dto/update-role.dto.js';
import type { SetRolePermissionsDto } from '../presentation/dto/set-role-permissions.dto.js';

// The seeded system administrator role (tenant-provision.ts). Never deletable.
const ADMIN_ROLE_NAME = 'ADMIN';

@Injectable()
export class RolesService {
  constructor(
    @Inject('IRolesRepository')
    private readonly rolesRepository: IRolesRepository,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(orgId: string): Promise<RoleSummary[]> {
    return this.rolesRepository.listSummaries(orgId);
  }

  async findOne(orgId: string, id: string): Promise<RoleWithPermissionsResponse> {
    const record = await this.rolesRepository.findWithPermissions(id, orgId);
    if (!record) throw new NotFoundException(`Role ${id} not found`);
    return this.toResponse(record);
  }

  async create(identity: RequestIdentity, dto: CreateRoleDto): Promise<RoleWithPermissionsResponse> {
    const orgId = identity.activeOrganizationId;
    const name = dto.name.trim();
    const permissionIds = [...new Set(dto.permissionIds ?? [])];

    if (await this.rolesRepository.nameExists(orgId, name)) {
      throw new ConflictException(`A role named '${name}' already exists`);
    }
    await this.assertPermissionsExist(permissionIds);

    const created = await this.rolesRepository.createWithPermissions({
      name,
      description: dto.description?.trim(),
      organizationId: orgId,
      permissionIds,
    });
    await this.audit(identity, 'ROLE_CREATED', created.id, { permissionIds });
    return this.toResponse(created);
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateRoleDto): Promise<RoleWithPermissionsResponse> {
    const orgId = identity.activeOrganizationId;
    await this.requireRole(id, orgId);

    const name = dto.name?.trim();
    if (name !== undefined && (await this.rolesRepository.nameExists(orgId, name, id))) {
      throw new ConflictException(`A role named '${name}' already exists`);
    }

    await this.rolesRepository.update(id, orgId, {
      ...(name !== undefined ? { name } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
    });
    await this.audit(identity, 'ROLE_UPDATED', id);
    return this.findOne(orgId, id);
  }

  async setPermissions(
    identity: RequestIdentity,
    id: string,
    dto: SetRolePermissionsDto,
  ): Promise<RoleWithPermissionsResponse> {
    const orgId = identity.activeOrganizationId;
    await this.requireRole(id, orgId);
    const permissionIds = [...new Set(dto.permissionIds)];
    await this.assertPermissionsExist(permissionIds);
    await this.rolesRepository.replacePermissions(id, orgId, permissionIds);
    await this.audit(identity, 'ROLE_PERMISSIONS_CHANGED', id, { permissionIds });
    return this.findOne(orgId, id);
  }

  async remove(identity: RequestIdentity, id: string): Promise<void> {
    const orgId = identity.activeOrganizationId;
    const role = await this.requireRole(id, orgId);

    if (role.name === ADMIN_ROLE_NAME) {
      throw new ConflictException('The ADMIN role cannot be deleted');
    }
    const activeAssignments = await this.rolesRepository.countActiveAssignments(id);
    if (activeAssignments > 0) {
      throw new ConflictException(
        `Role is assigned to ${activeAssignments} member(s) and cannot be deleted`,
      );
    }
    await this.rolesRepository.delete(id, orgId);
    await this.audit(identity, 'ROLE_DELETED', id);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireRole(id: string, orgId: string): Promise<RoleEntity> {
    const role = await this.rolesRepository.findByIdInOrg(id, orgId);
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  private async assertPermissionsExist(permissionIds: string[]): Promise<void> {
    if (permissionIds.length === 0) return;
    const found = await this.rolesRepository.countPermissionsInCatalogue(permissionIds);
    if (found !== permissionIds.length) {
      throw new BadRequestException('One or more permissionIds are not in the catalogue');
    }
  }

  private toResponse(record: RoleWithPermissionsRecord): RoleWithPermissionsResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      permissions: record.permissions.map((p) => ({
        id: p.id,
        action: p.action,
        resource: p.resource,
        key: `${p.action}:${p.resource}`,
      })),
    };
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
        resource: 'role',
        resourceId,
        ...(after ? { after } : {}),
      });
    } catch {
      // Audit is best-effort; never fail the operation on a logging error.
    }
  }
}
