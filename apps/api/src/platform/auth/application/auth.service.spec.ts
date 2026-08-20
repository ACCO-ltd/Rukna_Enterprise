import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js';

describe('AuthService organization membership claims', () => {
  const userFindUnique = jest.fn();
  const refreshCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findUnique: userFindUnique },
    refreshToken: { create: refreshCreate },
  };
  const jwt = { sign: jest.fn().mockReturnValue('signed-token') };
  const config = { get: jest.fn() };
  const tenancy = { getClient: () => prisma };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(jwt as never, config as never, tenancy as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects valid credentials when no active organization membership exists', async () => {
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@acco.test',
      passwordHash: await bcrypt.hash('valid-password', 4),
      status: 'ACTIVE',
      memberships: [],
    });

    await expect(
      tenancyStorage.run(
        { tenantId: 'tenant-1', tenantSlug: 'acco', client: prisma as never },
        () => service.login({ email: 'admin@acco.test', password: 'valid-password' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refreshCreate).not.toHaveBeenCalled();
  });

  it('issues claims only from active membership roles and permissions', async () => {
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@acco.test',
      passwordHash: await bcrypt.hash('valid-password', 4),
      status: 'ACTIVE',
      memberships: [
        {
          id: 'membership-1',
          organizationId: 'org-1',
          roles: [
            {
              role: {
                name: 'ADMIN',
                organizationId: 'org-1',
                rolePermissions: [
                  { permission: { action: 'view', resource: 'project' } },
                  { permission: { action: 'manage', resource: 'project' } },
                ],
              },
            },
            {
              role: {
                name: 'FOREIGN_ADMIN',
                organizationId: 'org-2',
                rolePermissions: [
                  { permission: { action: 'manage', resource: 'user' } },
                ],
              },
            },
          ],
        },
      ],
    });

    await tenancyStorage.run(
      { tenantId: 'tenant-1', tenantSlug: 'acco', client: prisma as never },
      () => service.login({ email: 'admin@acco.test', password: 'valid-password' }),
    );

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-1',
        orgId: 'org-1',
        tenantSlug: 'acco',
        roles: ['ADMIN'],
        permissions: ['view:project', 'manage:project'],
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN', orgId: 'org-1', userId: 'user-1' }),
    );
  });
});
