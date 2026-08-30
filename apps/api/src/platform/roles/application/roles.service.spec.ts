import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { RolesService } from './roles.service.js';
import type {
  RoleWithPermissionsRecord,
  RoleSummaryRecord,
} from '../domain/interfaces/roles-repository.interface.js';

const identity: RequestIdentity = {
  userId: 'actor-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: ['ADMIN'],
  permissions: [],
};

const roleRecord: RoleWithPermissionsRecord = {
  id: 'role-1',
  name: 'QS',
  description: null,
  permissions: [{ id: 'p-1', action: 'view', resource: 'boq' }],
};

const summary: RoleSummaryRecord = {
  id: 'role-1',
  name: 'QS',
  description: null,
  permissionCount: 1,
  memberCount: 0,
};

function build(
  over: Partial<{
    nameExists: boolean;
    roleInOrg: unknown;
    permsInCatalogue: number;
    activeAssignments: number;
    roleName: string;
  }> = {},
) {
  const roleInOrg =
    'roleInOrg' in over
      ? over.roleInOrg
      : { id: 'role-1', name: over.roleName ?? 'QS' };
  const repo = {
    listSummaries: jest.fn().mockResolvedValue([summary]),
    findWithPermissions: jest.fn().mockResolvedValue(roleRecord),
    findByIdInOrg: jest.fn().mockResolvedValue(roleInOrg),
    nameExists: jest.fn().mockResolvedValue(over.nameExists ?? false),
    countPermissionsInCatalogue: jest.fn().mockResolvedValue(over.permsInCatalogue ?? 1),
    createWithPermissions: jest.fn().mockResolvedValue(roleRecord),
    update: jest.fn().mockResolvedValue(undefined),
    replacePermissions: jest.fn().mockResolvedValue(undefined),
    countActiveAssignments: jest.fn().mockResolvedValue(over.activeAssignments ?? 0),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new RolesService(repo as never, audit as never);
  return { repo, audit, service };
}

describe('RolesService', () => {
  it('create: creates a role with its permission set', async () => {
    const { repo, service } = build({ permsInCatalogue: 1 });
    const result = await service.create(identity, { name: '  QS ', permissionIds: ['p-1'] });
    const arg = repo.createWithPermissions.mock.calls[0][0];
    expect(arg.name).toBe('QS'); // trimmed
    expect(arg.organizationId).toBe('org-1');
    expect(arg.permissionIds).toEqual(['p-1']);
    // Response carries the action:resource key.
    expect(result.permissions[0].key).toBe('view:boq');
  });

  it('create: rejects a duplicate role name with 409', async () => {
    const { service } = build({ nameExists: true });
    await expect(service.create(identity, { name: 'QS' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('create: rejects permissionIds not in the catalogue with 400', async () => {
    const { service } = build({ permsInCatalogue: 0 });
    await expect(
      service.create(identity, { name: 'QS', permissionIds: ['not-a-perm'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setPermissions: replaces the permission set via the repository', async () => {
    const { repo, service } = build({ permsInCatalogue: 2 });
    await service.setPermissions(identity, 'role-1', { permissionIds: ['p-1', 'p-2'] });
    expect(repo.replacePermissions).toHaveBeenCalledWith('role-1', 'org-1', ['p-1', 'p-2']);
  });

  it('setPermissions: rejects an unknown permissionId with 400', async () => {
    const { repo, service } = build({ permsInCatalogue: 1 });
    await expect(
      service.setPermissions(identity, 'role-1', { permissionIds: ['p-1', 'bogus'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.replacePermissions).not.toHaveBeenCalled();
  });

  it('findOne: rejects an unknown role with 404', async () => {
    const { repo, service } = build();
    repo.findWithPermissions.mockResolvedValueOnce(null);
    await expect(service.findOne('org-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove: rejects deleting a role that is still assigned (409)', async () => {
    const { repo, service } = build({ activeAssignments: 3 });
    await expect(service.remove(identity, 'role-1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('remove: rejects deleting the ADMIN role (409)', async () => {
    const { repo, service } = build({ roleName: 'ADMIN', activeAssignments: 0 });
    await expect(service.remove(identity, 'role-1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('remove: deletes a free, non-admin role', async () => {
    const { repo, service } = build({ roleName: 'QS', activeAssignments: 0 });
    await service.remove(identity, 'role-1');
    expect(repo.delete).toHaveBeenCalledWith('role-1', 'org-1');
  });

  it('update: rejects a rename that collides with an existing role (409)', async () => {
    const { service } = build({ nameExists: true });
    await expect(
      service.update(identity, 'role-1', { name: 'Existing' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update: rejects an unknown role with 404', async () => {
    const { service } = build({ roleInOrg: null });
    await expect(
      service.update(identity, 'nope', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
