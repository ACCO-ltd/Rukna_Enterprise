import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AdoptBaselineService } from './adopt-baseline.service.js';

const identity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

function build(opts: {
  contract?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
} = {}) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const contract =
    opts.contract === undefined
      ? { id: 'c-1', organizationId: 'org-1', projectId: 'p-1', status: 'ACTIVE', boqVersionId: 'v-1' }
      : opts.contract;
  const version =
    opts.version === undefined
      ? { id: 'v-2', status: 'BASELINED', versionNumber: 2, boq: { projectId: 'p-1' } }
      : opts.version;

  const repo = {
    findContract: jest.fn(async () => contract),
    findVersionWithProject: jest.fn(async () => version),
    updateContractBaseline: jest.fn(async () => undefined),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AdoptBaselineService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
  );
  return { service, repo, auditOutbox };
}

const dto = { boqVersionId: 'v-2', reason: 'Adopt VO-001 scope' };

describe('AdoptBaselineService (CONST-VAR-007 / OQ-2)', () => {
  it('repoints Contract.boqVersionId to a baselined version and audits old→new', async () => {
    const { service, repo, auditOutbox } = build();

    const res = await service.adopt(identity, 'c-1', dto);

    expect(repo.updateContractBaseline).toHaveBeenCalledWith(expect.anything(), 'c-1', 'v-2');
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'CONTRACT_BASELINE_REPOINTED',
        before: { boqVersionId: 'v-1' },
        after: { boqVersionId: 'v-2' },
      }),
    );
    expect(res).toMatchObject({ previousBoqVersionId: 'v-1', boqVersionId: 'v-2', boqVersionNumber: 2 });
  });

  it('rejects a version that is not BASELINED', async () => {
    const { service, repo } = build({
      version: { id: 'v-2', status: 'DRAFT', versionNumber: 2, boq: { projectId: 'p-1' } },
    });
    await expect(service.adopt(identity, 'c-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateContractBaseline).not.toHaveBeenCalled();
  });

  it('rejects a version from another project (404)', async () => {
    const { service } = build({
      version: { id: 'v-2', status: 'BASELINED', versionNumber: 2, boq: { projectId: 'OTHER' } },
    });
    await expect(service.adopt(identity, 'c-1', dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the contract is not live', async () => {
    const { service } = build({
      contract: { id: 'c-1', organizationId: 'org-1', projectId: 'p-1', status: 'CLOSED', boqVersionId: 'v-1' },
    });
    await expect(service.adopt(identity, 'c-1', dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a no-op repoint to the already-adopted version', async () => {
    const { service, repo } = build({
      contract: { id: 'c-1', organizationId: 'org-1', projectId: 'p-1', status: 'ACTIVE', boqVersionId: 'v-2' },
    });
    await expect(service.adopt(identity, 'c-1', dto)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateContractBaseline).not.toHaveBeenCalled();
  });

  it('is not auto-triggered — adopt is only invoked explicitly (no VO-approval coupling)', async () => {
    // Guard against regressions that wire this into a lifecycle transition: the service has no
    // dependency on the VO lifecycle and only acts when adopt() is called with an explicit target.
    const { service, repo } = build();
    expect(repo.updateContractBaseline).not.toHaveBeenCalled();
    await service.adopt(identity, 'c-1', dto);
    expect(repo.updateContractBaseline).toHaveBeenCalledTimes(1);
  });
});
