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
    const purpose = dto.purpose?.trim();
    let permissionIds = [...new Set(dto.permissionIds ?? [])];

    if (!purpose) throw new BadRequestException('A business purpose is required for a custom role');

    if (await this.rolesRepository.nameExists(orgId, name)) {
      throw new ConflictException(`A role named '${name}' already exists`);
    }
    if (dto.templateRoleId) {
      const template = await this.rolesRepository.findWithPermissions(dto.templateRoleId, orgId);
      if (!template) throw new NotFoundException('Role template not found');
      permissionIds = template.permissions.map((permission) => permission.id);
    }
    await this.assertPermissionsExist(permissionIds);

    const created = await this.rolesRepository.createWithPermissions({
      name,
      description: dto.description?.trim(),
      purpose,
      ownerUserId: identity.userId,
      templateRoleId: dto.templateRoleId,
      organizationId: orgId,
      permissionIds,
    });
    await this.audit(identity, dto.templateRoleId ? 'ROLE_TEMPLATE_CLONED' : 'ROLE_CREATED', created.id, { permissionIds, templateRoleId: dto.templateRoleId });
    return this.toResponse(created);
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateRoleDto): Promise<RoleWithPermissionsResponse> {
    const orgId = identity.activeOrganizationId;
    const role = await this.requireRole(id, orgId);
    this.assertRoleIsEditable(role);

    const name = dto.name?.trim();
    if (name !== undefined && (await this.rolesRepository.nameExists(orgId, name, id))) {
      throw new ConflictException(`A role named '${name}' already exists`);
    }

    await this.rolesRepository.update(id, orgId, {
      ...(name !== undefined ? { name } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.purpose !== undefined ? { purpose: dto.purpose.trim() } : {}),
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
    const role = await this.requireRole(id, orgId);
    this.assertRoleIsEditable(role);
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

  async impact(orgId: string, id: string) {
    const impact = await this.rolesRepository.findImpact(id, orgId);
    if (!impact) throw new NotFoundException(`Role ${id} not found`);
    const warnings = impact.permissions.filter((p) => p.riskClass === 'HIGH' || p.riskClass === 'CRITICAL').map((p) => ({ code: 'ELEVATED_PERMISSION', permissionId: p.id, riskClass: p.riskClass, message: `${p.action}:${p.resource} is ${p.riskClass.toLowerCase()} risk` }));
    return { ...impact, warnings };
  }

  async reassignOwner(identity: RequestIdentity, id: string, ownerUserId: string): Promise<void> {
    const role = await this.requireRole(id, identity.activeOrganizationId);
    this.assertRoleIsEditable(role);
    if (!(await this.rolesRepository.reassignOwner(id, identity.activeOrganizationId, ownerUserId))) throw new BadRequestException('Owner must be an active user in this organization');
    await this.audit(identity, 'ROLE_OWNER_REASSIGNED', id, { ownerUserId });
  }

  async review(identity: RequestIdentity, id: string, dto: { decision: 'CONFIRMED' | 'CHANGES_REQUIRED'; notes?: string }): Promise<void> {
    await this.requireRole(id, identity.activeOrganizationId);
    await this.rolesRepository.addAccessReview({ orgId: identity.activeOrganizationId, roleId: id, reviewerUserId: identity.userId, decision: dto.decision, notes: dto.notes?.trim() });
    await this.audit(identity, 'ROLE_ACCESS_REVIEWED', id, { decision: dto.decision });
  }

  async reviewHistory(orgId: string, id: string) {
    await this.requireRole(id, orgId);
    return this.rolesRepository.listAccessReviews(id, orgId);
  }

  /** The seeded administrator role is a protected baseline, not an ad-hoc custom role. */
  private assertRoleIsEditable(role: RoleEntity): void {
    if (role.name === ADMIN_ROLE_NAME) {
      throw new ConflictException('The ADMIN system role cannot be edited');
    }
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
      kind: record.kind,
      purpose: record.purpose,
      ownerUserId: record.ownerUserId,
      templateRoleId: record.templateRoleId,
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
