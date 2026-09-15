import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProjectAccessService } from './project-access.service.js';

const identity = (roles: string[] = []): RequestIdentity => ({
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles,
  permissions: [],
});

describe('ProjectAccessService authorization policy', () => {
  const projectFindFirst = jest.fn();
  const memberFindFirst = jest.fn();
  const tenancy = {
    getClient: () => ({
      project: { findFirst: projectFindFirst },
      projectMember: { findFirst: memberFindFirst },
    }),
  };
  const service = new ProjectAccessService(tenancy as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects a project outside the active organization as not found', async () => {
    projectFindFirst.mockResolvedValue(null);
    await expect(service.assertMember(identity(), 'project-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a non-member', async () => {
    projectFindFirst.mockResolvedValue({ id: 'project-1' });
    memberFindFirst.mockResolvedValue(null);
    await expect(service.assertMember(identity(), 'project-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an active project member', async () => {
    projectFindFirst.mockResolvedValue({ id: 'project-1' });
    memberFindFirst.mockResolvedValue({ id: 'member-1' });
    await expect(service.assertMember(identity(), 'project-1')).resolves.toBeUndefined();
  });

  it('allows the explicit organization administrator bypass', async () => {
    projectFindFirst.mockResolvedValue({ id: 'project-1' });
    await expect(service.assertMember(identity(['ADMIN']), 'project-1')).resolves.toBeUndefined();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  describe('scopedUserId', () => {
    it('returns undefined for org-wide bypass roles (leadership + finance/procurement)', () => {
      expect(service.scopedUserId(identity(['ADMIN']))).toBeUndefined();
      expect(service.scopedUserId(identity(['Finance Officer']))).toBeUndefined();
      expect(service.scopedUserId(identity(['Construction Director']))).toBeUndefined();
      expect(service.scopedUserId(identity(['Procurement Manager']))).toBeUndefined();
    });

    it('returns the userId for assigned-only roles (Project Manager, Site Engineer)', () => {
      expect(service.scopedUserId(identity())).toBe('user-1');
      expect(service.scopedUserId(identity(['Project Manager']))).toBe('user-1');
      expect(service.scopedUserId(identity(['Site Engineer']))).toBe('user-1');
    });
  });
});
