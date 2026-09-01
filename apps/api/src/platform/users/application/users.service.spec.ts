import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserStatus, MembershipStatus, type RequestIdentity } from '@erp/types';

import { UsersService } from './users.service.js';
import type { UserWithRolesRecord } from '../domain/interfaces/users-repository.interface.js';

const identity: RequestIdentity = {
  userId: 'actor-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: ['ADMIN'],
  permissions: [],
};

const sampleRecord: UserWithRolesRecord = {
  id: 'u-new',
  email: 'jane.doe@acco.com',
  firstName: 'Jane',
  lastName: 'Doe',
  status: UserStatus.ACTIVE,
  membershipStatus: MembershipStatus.ACTIVE,
  roles: [{ id: 'r-1', name: 'QS' }],
};

function build(
  over: Partial<{
    existingByEmail: unknown;
    existingById: unknown;
    rolesInOrg: number;
  }> = {},
) {
  const repo = {
    findByEmail: jest.fn().mockResolvedValue('existingByEmail' in over ? over.existingByEmail : null),
    findById: jest.fn().mockResolvedValue('existingById' in over ? over.existingById : { id: 'u-1' }),
    findByIdWithRoles: jest.fn().mockResolvedValue(sampleRecord),
    findByOrganizationWithRoles: jest.fn().mockResolvedValue([sampleRecord]),
    countRolesInOrg: jest.fn().mockResolvedValue(over.rolesInOrg ?? 1),
    createWithMembership: jest.fn().mockResolvedValue(sampleRecord),
    update: jest.fn().mockResolvedValue(undefined),
    updatePassword: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn().mockResolvedValue(undefined),
    reactivate: jest.fn().mockResolvedValue(undefined),
    replaceMembershipRoles: jest.fn().mockResolvedValue(undefined),
    completeTemporaryPasswordChange: jest.fn().mockResolvedValue(undefined),
    regenerateTemporaryPassword: jest.fn().mockResolvedValue(true),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(repo as never, audit as never);
  return { repo, audit, service };
}

describe('UsersService', () => {
  it('create: hashes the password (bcrypt) and provisions an ACTIVE membership with roles', async () => {
    const { repo, service } = build({ rolesInOrg: 1 });
    await service.create(identity, {
      email: 'jane.doe@acco.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'super-secret-1',
      roleIds: ['r-1'],
    });

    expect(repo.createWithMembership).toHaveBeenCalledTimes(1);
    const arg = repo.createWithMembership.mock.calls[0][0];
    expect(arg.organizationId).toBe('org-1');
    expect(arg.roleIds).toEqual(['r-1']);
    expect(arg.actorUserId).toBe('actor-1');
    // Password is hashed, not stored plaintext.
    expect(arg.passwordHash).not.toBe('super-secret-1');
    expect(await bcrypt.compare('super-secret-1', arg.passwordHash)).toBe(true);
  });

  it('create: rejects a duplicate email with 409', async () => {
    const { service } = build({ existingByEmail: { id: 'u-9' } });
    await expect(
      service.create(identity, {
        email: 'dupe@acco.com',
        firstName: 'A',
        lastName: 'B',
        password: 'super-secret-1',
        roleIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('create: rejects a password shorter than 12 chars with 400', async () => {
    const { service } = build();
    await expect(
      service.create(identity, {
        email: 'short@acco.com',
        firstName: 'A',
        lastName: 'B',
        password: 'too-short',
        roleIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create: rejects roleIds not in the org (cross-org isolation) with 400', async () => {
    const { service } = build({ rolesInOrg: 0 });
    await expect(
      service.create(identity, {
        email: 'x@acco.com',
        firstName: 'A',
        lastName: 'B',
        password: 'super-secret-1',
        roleIds: ['role-from-other-org'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivate: blocks deactivating your own account with 400', async () => {
    const { repo, service } = build();
    await expect(
      service.deactivate(identity, identity.userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  it('deactivate: suspends another user in the org', async () => {
    const { repo, service } = build();
    await service.deactivate(identity, 'u-2');
    expect(repo.deactivate).toHaveBeenCalledWith('u-2', 'org-1', 'actor-1');
  });

  it('deactivate: rejects an unknown user with 404', async () => {
    const { service } = build({ existingById: null });
    await expect(service.deactivate(identity, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setRoles: replaces the role set via the repository (soft-remove + add)', async () => {
    const { repo, service } = build({ rolesInOrg: 2 });
    await service.setRoles(identity, 'u-2', { roleIds: ['r-1', 'r-2'] });
    expect(repo.replaceMembershipRoles).toHaveBeenCalledWith('u-2', 'org-1', ['r-1', 'r-2'], 'actor-1');
  });

  it('setRoles: rejects a roleId from another org with 400', async () => {
    const { repo, service } = build({ rolesInOrg: 1 });
    await expect(
      service.setRoles(identity, 'u-2', { roleIds: ['r-1', 'foreign'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.replaceMembershipRoles).not.toHaveBeenCalled();
  });

  it('setPassword: rejects short passwords and hashes valid ones', async () => {
    const { repo, service } = build();
    await expect(
      service.setPassword(identity, 'u-2', { password: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.setPassword(identity, 'u-2', { password: 'another-secret-1' });
    const [id, orgId, hash] = repo.updatePassword.mock.calls[0];
    expect(id).toBe('u-2');
    expect(orgId).toBe('org-1');
    expect(await bcrypt.compare('another-secret-1', hash)).toBe(true);
  });

  it('provisionTemporary: generates a password stored only as a hash and requires a change', async () => {
    const { repo, service } = build();
    const result = await service.provisionTemporary(identity, {
      email: 'new@acco.com', firstName: 'New', lastName: 'User', roleIds: ['r-1'],
    });
    const arg = repo.createWithMembership.mock.calls[0][0];
    expect(arg.mustChangePassword).toBe(true);
    expect(arg.temporaryPasswordExpiresAt).toEqual(result.expiresAt);
    expect(await bcrypt.compare(result.temporaryPassword, arg.passwordHash)).toBe(true);
  });

  it('changeTemporaryPassword: clears the temporary-password requirement', async () => {
    const { repo, service } = build();
    await service.changeTemporaryPassword({ ...identity, mustChangePassword: true }, { password: 'replacement-secret-1' });
    const [id, orgId, hash] = repo.completeTemporaryPasswordChange.mock.calls[0];
    expect([id, orgId]).toEqual(['actor-1', 'org-1']);
    expect(await bcrypt.compare('replacement-secret-1', hash)).toBe(true);
  });

  it('regenerateTemporaryPassword: invalidates sessions and returns a new expiring credential', async () => {
    const { repo, service } = build();
    const result = await service.regenerateTemporaryPassword(identity, 'u-2');
    const [, , hash, expiresAt] = repo.regenerateTemporaryPassword.mock.calls[0];
    expect(await bcrypt.compare(result.temporaryPassword, hash)).toBe(true);
    expect(expiresAt).toEqual(result.expiresAt);
  });
});
