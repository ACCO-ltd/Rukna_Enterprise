import { BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { IpcService } from './ipc.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

describe('IpcService.findAll', () => {
  const prisma = {};
  const repository = { findAll: jest.fn() };
  const projectAccess = {
    assertApplication: jest.fn(),
    assertMember: jest.fn(),
    scopedUserId: jest.fn(() => 'user-1'),
  };
  const service = new IpcService(
    { getClient: () => prisma } as never,
    repository as never,
    projectAccess as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('enforces project membership before returning project certificates', async () => {
    repository.findAll.mockResolvedValue([]);

    await service.findAll(identity, undefined, 'project-1');

    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'project-1');
    expect(repository.findAll).toHaveBeenCalledWith(
      prisma,
      'org-1',
      undefined,
      'project-1',
      undefined,
    );
  });

  it('rejects ambiguous application and project filters', async () => {
    await expect(service.findAll(identity, 'application-1', 'project-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findAll).not.toHaveBeenCalled();
  });
});
