import { BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProgressService } from './progress.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
  lang: 'en',
};

type Over = {
  dpr?: Record<string, unknown>;
  node?: unknown;
  prior?: unknown;
  file?: unknown;
  workPackages?: unknown[];
  measurements?: unknown[];
  fp?: unknown;
};

function build(over: Over = {}) {
  const repo = {
    createDpr: jest.fn().mockResolvedValue({ id: 'dpr-1', status: 'DRAFT' }),
    findDpr: jest.fn().mockResolvedValue(
      over.dpr ?? { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [], attachments: [] },
    ),
    findDprsByProject: jest.fn().mockResolvedValue([]),
    updateDprStatus: jest.fn().mockResolvedValue({ id: 'dpr-1' }),
    addMeasurement: jest.fn().mockResolvedValue({ id: 'm-1' }),
    createAttachment: jest.fn().mockResolvedValue({ id: 'att-1' }),
    findBoqNodeForProject: jest.fn().mockResolvedValue(over.node ?? { id: 'n1', quantity: 1000, isLeaf: true }),
    sumVerifiedForNode: jest.fn().mockResolvedValue(over.prior ?? { _sum: { quantity: '0' } }),
    approvedMeasurementsForProject: jest.fn().mockResolvedValue(over.measurements ?? []),
    findFileStatus: jest.fn().mockResolvedValue(over.file ?? { id: 'f-1', status: 'READY' }),
    createWorkPackage: jest.fn().mockResolvedValue({ id: 'wp-1' }),
    findWorkPackageById: jest.fn().mockResolvedValue({ id: 'wp-1', projectId: 'p-1' }),
    findWorkPackages: jest.fn().mockResolvedValue(over.workPackages ?? []),
    allocateBoqNode: jest.fn().mockResolvedValue({ id: 'wpn-1' }),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
  const financialPosition = {
    getForProject: jest.fn().mockResolvedValue(over.fp ?? { actualCost: '0', forecastCost: '0' }),
  };
  const service = new ProgressService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    financialPosition as never,
  );
  return { repo, service };
}

describe('ProgressService (ADR-021 MVP)', () => {
  it('createDpr: creates a DRAFT report for the project', async () => {
    const { repo, service } = build();
    await service.createDpr(identity, 'p-1', { reportDate: '2026-08-18', weather: 'Clear' });
    expect(repo.createDpr).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-1', preparedBy: 'user-1', reportDate: expect.any(Date) }),
    );
  });

  it('addMeasurement: records a quantity against a BOQ leaf on a DRAFT report', async () => {
    const { repo, service } = build();
    await service.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 120 });
    expect(repo.addMeasurement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boqNodeId: 'n1', quantity: 120 }),
    );
  });

  it('addMeasurement: rejects measuring against a non-leaf (section) node', async () => {
    const { repo, service } = build({ node: { id: 'n1', quantity: 1000, isLeaf: false } });
    await expect(service.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 10 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.addMeasurement).not.toHaveBeenCalled();
  });

  it('addMeasurement: rejects once the report is no longer DRAFT', async () => {
    const { repo, service } = build({ dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] } });
    await expect(service.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 10 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.addMeasurement).not.toHaveBeenCalled();
  });

  it('approve: verifies progress when cumulative stays within BOQ scope', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 500 }], attachments: [] },
      node: { id: 'n1', quantity: 1000, isLeaf: true },
      prior: { _sum: { quantity: '200' } }, // 200 + 500 = 700 <= 1000
    });
    await service.approve(identity, 'dpr-1');
    expect(repo.updateDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });

  it('approve: rejects when cumulative would exceed BOQ scope (CONST-PROG-002/009)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 500 }], attachments: [] },
      node: { id: 'n1', quantity: 1000, isLeaf: true },
      prior: { _sum: { quantity: '600' } }, // 600 + 500 = 1100 > 1000
    });
    await expect(service.approve(identity, 'dpr-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateDprStatus).not.toHaveBeenCalled();
  });

  it('attachEvidence: rejects a file that is not READY', async () => {
    const { repo, service } = build({ file: { id: 'f-1', status: 'PENDING' } });
    await expect(service.attachEvidence(identity, 'dpr-1', 'f-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createAttachment).not.toHaveBeenCalled();
  });

  it('getRollup: weighted project physical % from work packages (CONST-PROG-007)', async () => {
    const { service } = build({
      workPackages: [
        { id: 'a', code: 'WP-A', name: 'Sub', responsibleOwner: null, progressWeight: '0.6', boqLinks: [{ boqNodeId: 'n1' }] },
        { id: 'b', code: 'WP-B', name: 'Super', responsibleOwner: null, progressWeight: '0.4', boqLinks: [{ boqNodeId: 'n2' }] },
      ],
      measurements: [
        { boqNodeId: 'n1', quantity: 500, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }, // 50%
        { boqNodeId: 'n2', quantity: 200, boqNode: { id: 'n2', code: '2', description: 'y', quantity: 1000 } }, // 20%
      ],
    });
    const res = await service.getRollup(identity, 'p-1');
    // 0.6*50 + 0.4*20 = 38
    expect(res.physicalPercent).toBe(38);
    expect(res.weightsComplete).toBe(true);
    expect(res.packages).toHaveLength(2);
  });

  it('getRollup: flags an incomplete weight plan (weights ≠ 100%)', async () => {
    const { service } = build({
      workPackages: [
        { id: 'a', code: 'WP-A', name: 'Sub', responsibleOwner: null, progressWeight: '0.5', boqLinks: [] },
      ],
      measurements: [],
    });
    const res = await service.getRollup(identity, 'p-1');
    expect(res.weightsComplete).toBe(false);
    expect(res.weightsTotal).toBe('0.5');
  });

  it('signal: COST_AHEAD when cost consumed outpaces physical progress', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20% built
      fp: { actualCost: '510', forecastCost: '1000' }, // 51% cost consumed
    });
    const res = await service.getPhysicalFinancialSignal(identity, 'p-1');
    expect(res.physicalPercent).toBe(20);
    expect(res.costConsumedPercent).toBe(51);
    expect(res.divergence).toBe(-31);
    expect(res.status).toBe('COST_AHEAD');
  });

  it('signal: ALIGNED when physical and cost are within the threshold', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20%
      fp: { actualCost: '250', forecastCost: '1000' }, // 25%
    });
    const res = await service.getPhysicalFinancialSignal(identity, 'p-1');
    expect(res.status).toBe('ALIGNED');
  });
});
