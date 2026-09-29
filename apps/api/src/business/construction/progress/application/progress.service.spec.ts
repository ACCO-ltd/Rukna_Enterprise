import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgressService } from './progress.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

type Over = {
  dpr?: Record<string, unknown>;
  node?: unknown;
  prior?: unknown;
  file?: unknown;
  workPackages?: unknown[];
  measurements?: unknown[];
  fp?: unknown;
  leafValues?: unknown[];
  leafAllocation?: unknown;
  dprs?: unknown[];
  users?: unknown[];
  workPackageForUpdate?: unknown;
  reportDates?: { boqNodeId: string; reportDate: Date }[];
  dprWorkPackages?: unknown[];
};

/** The file lifecycle seam: attaching evidence binds it, approving the report freezes it. */
function files() {
  return {
    bind: jest.fn().mockResolvedValue(undefined),
    markImmutable: jest.fn().mockResolvedValue(undefined),
    markManyImmutable: jest.fn().mockResolvedValue(0),
  };
}

function build(over: Over = {}) {
  const repo = {
    createDpr: jest.fn().mockResolvedValue({ id: 'dpr-1', status: 'DRAFT' }),
    findDpr: jest.fn().mockResolvedValue(
      over.dpr ?? { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [], attachments: [] },
    ),
    findDprsByProject: jest.fn().mockResolvedValue(over.dprs ?? []),
    findUserNamesByIds: jest.fn().mockResolvedValue(over.users ?? []),
    // Conditional transitions: 1 row changed = the report was still in the expected status.
    transitionDprStatus: jest.fn().mockResolvedValue(1),
    findDprRow: jest.fn().mockResolvedValue({ id: 'dpr-1' }),
    lockDpr: jest.fn().mockResolvedValue(true),
    findAttachmentFileIds: jest.fn().mockResolvedValue([]),
    addMeasurement: jest.fn().mockResolvedValue({ id: 'm-1' }),
    createAttachment: jest.fn().mockResolvedValue({ id: 'att-1' }),
    findBoqNodeForProject: jest.fn().mockResolvedValue(over.node ?? { id: 'n1', quantity: 1000, isLeaf: true }),
    sumVerifiedForNode: jest.fn().mockResolvedValue(over.prior ?? { _sum: { quantity: '0' } }),
    approvedMeasurementsForProject: jest.fn().mockResolvedValue(over.measurements ?? []),
    findFileStatus: jest.fn().mockResolvedValue(over.file ?? { id: 'f-1', status: 'READY' }),
    createWorkPackage: jest.fn().mockResolvedValue({ id: 'wp-1' }),
    findWorkPackageById: jest.fn().mockResolvedValue({ id: 'wp-1', projectId: 'p-1' }),
    findWorkPackageForUpdate: jest.fn().mockResolvedValue(
      over.workPackageForUpdate ?? { id: 'wp-1', projectId: 'p-1', _count: { boqLinks: 0 } },
    ),
    updateWorkPackage: jest.fn().mockResolvedValue({ id: 'wp-1' }),
    findWorkPackages: jest.fn().mockResolvedValue(over.workPackages ?? []),
    findLeafValues: jest.fn().mockResolvedValue(over.leafValues ?? []),
    approvedReportDatesForLeaves: jest.fn().mockResolvedValue(over.reportDates ?? []),
    findLeafAllocation: jest.fn().mockResolvedValue(over.leafAllocation ?? null),
    allocateBoqNode: jest.fn().mockResolvedValue({ id: 'wpn-1' }),
    lockBoqNodes: jest.fn().mockResolvedValue(undefined),
    deleteMeasurement: jest.fn().mockResolvedValue({ id: 'm-1' }),
    findLabourRow: jest.fn().mockResolvedValue({ id: 'row-1', dprId: 'dpr-1' }),
    deleteLabourRow: jest.fn().mockResolvedValue({ id: 'row-1' }),
    addLabourRow: jest.fn().mockResolvedValue({ id: 'row-1' }),
    addEquipmentRow: jest.fn().mockResolvedValue({ id: 'eq-1' }),
    addObservation: jest.fn().mockResolvedValue({ id: 'obs-1' }),
    patchDprContext: jest.fn().mockResolvedValue({ id: 'dpr-1' }),
    findWorkPackagesForDprs: jest.fn().mockResolvedValue(over.dprWorkPackages ?? []),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  // The approve path runs its locked re-check + status flip inside a transaction.
  const client = { $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
  const tenancy = { getClient: () => client };
  const financialPosition = {
    getForProject: jest.fn().mockResolvedValue(over.fp ?? { actualCost: '0', budgetTotal: null }),
  };
  // ADR-022 DPR governance seam: with no active binding the gate returns null (approval proceeds).
  const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(null) };
  const fileService = files();
  // Master Schedule P3 (ADR-029): no governing baseline in these MVP paths ⇒ live curve behaviour.
  const baselineRepo = { findApproved: jest.fn().mockResolvedValue(null) };
  const service = new ProgressService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    financialPosition as never,
    commandGovernance as never,
    fileService as never,
    baselineRepo as never,
  );
  return { repo, service, commandGovernance, fileService, baselineRepo };
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
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.any(String),
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });

  /**
   * CONST-PROG-008 makes approval the point at which measurements become verified, so from here
   * the evidence behind them is part of the record. Before Phase 7 Step 2 nothing ever marked a
   * file immutable, so approved evidence stayed deletable by anyone in the organisation.
   */
  it('approve: freezes the evidence that supported the approval', async () => {
    const { repo, service, fileService } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    repo.findAttachmentFileIds.mockResolvedValue(['file-a', 'file-b']);

    await service.approve(identity, 'dpr-1');

    expect(fileService.markManyImmutable).toHaveBeenCalledWith(
      ['file-a', 'file-b'],
      expect.stringContaining('dpr-1'),
      expect.anything(), // the approve transaction's client
    );
  });

  it('approve: locks the measured BOQ lines (sorted) and re-checks before flipping the status', async () => {
    const { repo, service } = build({
      dpr: {
        id: 'dpr-1',
        status: 'SUBMITTED',
        projectId: 'p-1',
        measurements: [
          { boqNodeId: 'n2', quantity: 1 },
          { boqNodeId: 'n1', quantity: 1 },
          { boqNodeId: 'n2', quantity: 1 },
        ],
        attachments: [],
      },
    });
    await service.approve(identity, 'dpr-1');
    expect(repo.lockBoqNodes).toHaveBeenCalledWith(expect.anything(), ['n1', 'n2']);
    const lockOrder = repo.lockBoqNodes.mock.invocationCallOrder[0]!;
    // The re-check's reads come after the lock, and the status write after those.
    const lastSumRead = Math.max(...repo.sumVerifiedForNode.mock.invocationCallOrder);
    expect(lastSumRead).toBeGreaterThan(lockOrder);
    expect(repo.transitionDprStatus.mock.invocationCallOrder[0]!).toBeGreaterThan(lastSumRead);
  });

  it('approve: a concurrent approval that lands first makes the locked re-check refuse (no status flip)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 500 }], attachments: [] },
      node: { id: 'n1', quantity: 1000, isLeaf: true },
    });
    // Unlocked pre-check sees 400 prior; by the time the lock is held another report added 300.
    repo.sumVerifiedForNode
      .mockResolvedValueOnce({ _sum: { quantity: '400' } })
      .mockResolvedValueOnce({ _sum: { quantity: '700' } });
    const err = await service.approve(identity, 'dpr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      errorCode: 'DPR_EXCEEDS_BOQ_QUANTITY',
    });
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('approve: locks the DPR row before the BOQ lines and re-reads the report inside the transaction', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', preparedBy: 'se', measurements: [{ boqNodeId: 'n1', quantity: 1 }], attachments: [] },
    });
    await service.approve(identity, 'dpr-1');
    expect(repo.lockDpr.mock.invocationCallOrder[0]!).toBeLessThan(
      repo.lockBoqNodes.mock.invocationCallOrder[0]!,
    );
    expect(repo.findDpr).toHaveBeenCalledTimes(2); // pre-check read + fresh read under the lock
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      'SUBMITTED',
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });

  it('approve: 409 when the report is no longer SUBMITTED under the lock (a return landed first)', async () => {
    const { repo, service, fileService } = build();
    const submitted = { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', preparedBy: 'se', measurements: [], attachments: [] };
    repo.findDpr
      .mockResolvedValueOnce(submitted)
      .mockResolvedValueOnce({ ...submitted, status: 'RETURNED' });
    const err = await service.approve(identity, 'dpr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ errorCode: 'DPR_CHANGED' });
    expect(fileService.markManyImmutable).not.toHaveBeenCalled();
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('approve: 409 when the conditional status flip changes no row', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', preparedBy: 'se', measurements: [], attachments: [] },
    });
    repo.transitionDprStatus.mockResolvedValue(0);
    await expect(service.approve(identity, 'dpr-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve: freezes evidence inside the transaction (passes the tx client)', async () => {
    const { repo, service, fileService } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', preparedBy: 'se', measurements: [], attachments: [] },
    });
    repo.findAttachmentFileIds.mockResolvedValue(['file-a']);
    await service.approve(identity, 'dpr-1');
    expect(fileService.markManyImmutable).toHaveBeenCalledWith(['file-a'], expect.any(String), expect.anything());
    expect(fileService.markManyImmutable.mock.invocationCallOrder[0]!).toBeLessThan(
      repo.transitionDprStatus.mock.invocationCallOrder[0]!,
    );
  });

  it('returnForRevision: 409 when the report moved first (conditional on SUBMITTED)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    repo.transitionDprStatus.mockResolvedValue(0);
    await expect(service.returnForRevision(identity, 'dpr-1', 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(expect.anything(), 'dpr-1', 'SUBMITTED', expect.anything());
  });

  it('approve: gates (409) and does not verify when governance resolves a binding (ADR-022 CONST-DOA-008)', async () => {
    const { repo, service, commandGovernance } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 500 }], attachments: [] },
      node: { id: 'n1', quantity: 1000, isLeaf: true },
      prior: { _sum: { quantity: '0' } },
    });
    commandGovernance.gateStateTransition.mockResolvedValue({ gated: true, approvalInstanceId: 'ai-dpr' });

    await expect(service.approve(identity, 'dpr-1')).rejects.toBeInstanceOf(ConflictException);
    expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'DailyProgressReport',
      'SUBMITTED',
      'APPROVED',
      'dpr-1',
    );
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('approve: rejects when cumulative would exceed BOQ scope (CONST-PROG-002/009)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 500 }], attachments: [] },
      node: { id: 'n1', quantity: 1000, isLeaf: true },
      prior: { _sum: { quantity: '600' } }, // 600 + 500 = 1100 > 1000
    });
    const err = await service.approve(identity, 'dpr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      errorCode: 'DPR_EXCEEDS_BOQ_QUANTITY',
      details: { lines: [expect.objectContaining({ boqNodeId: 'n1', maxForThisReport: '400' })] },
    });
    // The "prior" figure excludes this report itself — only OTHER approved reports count.
    expect(repo.sumVerifiedForNode).toHaveBeenCalledWith(expect.anything(), 'org-1', 'n1', 'dpr-1');
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('submit: rejects an over-quantity report with a structured DPR_EXCEEDS_BOQ_QUANTITY error naming the line', async () => {
    const { repo, service } = build({
      dpr: {
        id: 'dpr-1',
        status: 'DRAFT',
        projectId: 'p-1',
        measurements: [
          { boqNodeId: 'n1', quantity: 5 },
          { boqNodeId: 'n1', quantity: 7 },
        ],
        attachments: [],
      },
      node: { id: 'n1', quantity: '60', isLeaf: true, code: '2.2', description: 'RC C30 slab', unit: 'm³' },
      prior: { _sum: { quantity: '58' } },
    });

    const err = await service.submit(identity, 'dpr-1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      message:
        '2.2 RC C30 slab: this report brings the total to 70 m³ but the BOQ has 60 m³. Enter 2 or less, or raise a variation.',
      errorCode: 'DPR_EXCEEDS_BOQ_QUANTITY',
      details: {
        lines: [
          {
            boqNodeId: 'n1',
            boqCode: '2.2',
            description: 'RC C30 slab',
            unit: 'm³',
            boqQuantity: '60',
            verifiedToDate: '58',
            thisReport: '12',
            maxForThisReport: '2',
          },
        ],
      },
    });
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('submit: submits a report that stays within every BOQ line', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [{ boqNodeId: 'n1', quantity: 2 }], attachments: [] },
      node: { id: 'n1', quantity: '60', isLeaf: true, code: '2.2', description: 'RC C30 slab', unit: 'm³' },
      prior: { _sum: { quantity: '58' } },
    });
    await service.submit(identity, 'dpr-1');
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.any(String),
      expect.objectContaining({ status: 'SUBMITTED' }),
    );
  });

  it('returnForRevision: records the reason, who returned it and when', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.returnForRevision(identity, 'dpr-1', 'Photos missing for grid 5');
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.any(String),
      expect.objectContaining({
        status: 'RETURNED',
        returnReason: 'Photos missing for grid 5',
        returnedBy: 'user-1',
        returnedAt: expect.any(Date),
      }),
    );
  });

  it('submit: a resubmit keeps the last return record (same as returnReason)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'RETURNED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.submit(identity, 'dpr-1');
    const data = repo.transitionDprStatus.mock.calls[0]![3] as Record<string, unknown>;
    expect(data).not.toHaveProperty('returnedBy');
    expect(data).not.toHaveProperty('returnedAt');
    expect(data).not.toHaveProperty('returnReason');
  });

  it('reopen: moves an APPROVED report to REOPENED with the reopen audit trail (CONST-PROG-010)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.reopen(identity, 'dpr-1', 'Grid 5 double-counted — reopening to correct');
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.any(String),
      expect.objectContaining({
        status: 'REOPENED',
        reopenedBy: 'user-1',
        reopenReason: 'Grid 5 double-counted — reopening to correct',
        reopenedAt: expect.any(Date),
      }),
    );
  });

  it('reopen: rejects a report that is not APPROVED', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await expect(service.reopen(identity, 'dpr-1', 'nope')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('reopen: gates (409) and does not reopen when governance resolves a binding (ADR-022 CONST-DOA-008)', async () => {
    const { repo, service, commandGovernance } = build({
      dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    commandGovernance.gateStateTransition.mockResolvedValue({ gated: true, approvalInstanceId: 'ai-reopen' });

    await expect(service.reopen(identity, 'dpr-1', 'correct grid 5')).rejects.toBeInstanceOf(ConflictException);
    expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'DailyProgressReport',
      'APPROVED',
      'REOPENED',
      'dpr-1',
    );
    expect(repo.transitionDprStatus).not.toHaveBeenCalled();
  });

  it('addMeasurement: allows editing a REOPENED report (correction path)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'REOPENED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 50 });
    expect(repo.addMeasurement).toHaveBeenCalled();
  });

  it('submit: re-submits a REOPENED report after correction (back to SUBMITTED)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'REOPENED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.submit(identity, 'dpr-1');
    expect(repo.transitionDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.any(String),
      expect.objectContaining({ status: 'SUBMITTED' }),
    );
  });

  it.each(['DRAFT', 'RETURNED', 'REOPENED'])(
    'removeMeasurement: deletes a work entry on a %s report',
    async (status) => {
      const { repo, service } = build({
        dpr: { id: 'dpr-1', status, projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1', quantity: 5 }], attachments: [] },
      });
      await service.removeMeasurement(identity, 'dpr-1', 'm-1');
      expect(repo.deleteMeasurement).toHaveBeenCalledWith(expect.anything(), 'm-1');
    },
  );

  it.each(['SUBMITTED', 'APPROVED'])(
    'removeMeasurement: 409 on a %s report, nothing deleted',
    async (status) => {
      const { repo, service } = build({
        dpr: { id: 'dpr-1', status, projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1', quantity: 5 }], attachments: [] },
      });
      await expect(service.removeMeasurement(identity, 'dpr-1', 'm-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.deleteMeasurement).not.toHaveBeenCalled();
    },
  );

  it('removeMeasurement: in a REOPENED report, an entry from before the reopen is protected (409)', async () => {
    const reopenedAt = new Date('2026-09-20T10:00:00Z');
    const { repo, service } = build({
      dpr: {
        id: 'dpr-1',
        status: 'REOPENED',
        projectId: 'p-1',
        reopenedAt,
        measurements: [
          { id: 'old', boqNodeId: 'n1', quantity: 5, createdAt: new Date('2026-09-18T08:00:00Z') },
          { id: 'new', boqNodeId: 'n1', quantity: 1, createdAt: new Date('2026-09-20T11:00:00Z') },
        ],
        attachments: [],
      },
    });

    await expect(service.removeMeasurement(identity, 'dpr-1', 'old')).rejects.toThrow(
      /part of the approved report/,
    );
    expect(repo.deleteMeasurement).not.toHaveBeenCalled();

    await service.removeMeasurement(identity, 'dpr-1', 'new');
    expect(repo.deleteMeasurement).toHaveBeenCalledWith(expect.anything(), 'new');
  });

  it('removeMeasurement: re-checks the status under the DPR lock (a submit that landed first wins)', async () => {
    const { repo, service } = build();
    const draft = { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1', quantity: 5 }], attachments: [] };
    repo.findDpr
      .mockResolvedValueOnce(draft) // unlocked read
      .mockResolvedValueOnce({ ...draft, status: 'SUBMITTED' }); // fresh read under the lock
    await expect(service.removeMeasurement(identity, 'dpr-1', 'm-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.lockDpr).toHaveBeenCalledWith(expect.anything(), 'org-1', 'dpr-1');
    expect(repo.deleteMeasurement).not.toHaveBeenCalled();
  });

  it('removeMeasurement: 404 for an entry that is not on this report', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1', quantity: 5 }], attachments: [] },
    });
    await expect(service.removeMeasurement(identity, 'dpr-1', 'm-OTHER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.deleteMeasurement).not.toHaveBeenCalled();
  });

  it('attachEvidence: refused on an APPROVED report (409) — approval froze the evidence set', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await expect(service.attachEvidence(identity, 'dpr-1', 'f-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.createAttachment).not.toHaveBeenCalled();
  });

  it('attachEvidence: allowed while SUBMITTED (the UI lets reviewers add photos) and done under the DPR lock', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.attachEvidence(identity, 'dpr-1', 'f-1');
    expect(repo.lockDpr).toHaveBeenCalledWith(expect.anything(), 'org-1', 'dpr-1');
    expect(repo.createAttachment).toHaveBeenCalled();
  });

  it('attachEvidence: an approval that lands first under the lock wins (409, nothing attached)', async () => {
    const { repo, service } = build();
    const submitted = { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', measurements: [], attachments: [] };
    repo.findDpr.mockResolvedValueOnce(submitted).mockResolvedValueOnce({ ...submitted, status: 'APPROVED' });
    await expect(service.attachEvidence(identity, 'dpr-1', 'f-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.createAttachment).not.toHaveBeenCalled();
  });

  it.each([
    ['addMeasurement', (svc: ProgressService) => svc.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 1 }), 'addMeasurement'],
    ['addLabourRow', (svc: ProgressService) => svc.addLabourRow(identity, 'dpr-1', { trade: 'Mason', headcount: 2 }), 'addLabourRow'],
    ['addEquipmentRow', (svc: ProgressService) => svc.addEquipmentRow(identity, 'dpr-1', { equipmentType: 'Mixer', count: 1 }), 'addEquipmentRow'],
    ['addObservation', (svc: ProgressService) => svc.addObservation(identity, 'dpr-1', { category: 'ISSUE', description: 'x' }), 'addObservation'],
    ['patchDprContext', (svc: ProgressService) => svc.patchDprContext(identity, 'dpr-1', { shift: 'Day' }), 'patchDprContext'],
  ] as const)(
    '%s: a submit that lands first under the DPR lock wins — nothing is written',
    async (_label, call, repoMethod) => {
      const { repo, service } = build();
      const draft = { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [], attachments: [] };
      repo.findDpr.mockResolvedValueOnce(draft).mockResolvedValueOnce({ ...draft, status: 'SUBMITTED' });
      await expect(call(service)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.lockDpr).toHaveBeenCalledWith(expect.anything(), 'org-1', 'dpr-1');
      expect((repo as Record<string, jest.Mock>)[repoMethod]).not.toHaveBeenCalled();
    },
  );

  it('approve: a lock timeout (P2028) or deadlock (40P01) is a retryable 409 DPR_CHANGED, not a 500', async () => {
    for (const error of [
      new Prisma.PrismaClientKnownRequestError('Transaction already closed', { code: 'P2028', clientVersion: 'x' }),
      new Prisma.PrismaClientKnownRequestError('Raw query failed', {
        code: 'P2010',
        clientVersion: 'x',
        meta: { code: '40P01', message: 'deadlock detected' },
      }),
    ]) {
      const { repo, service } = build({
        dpr: { id: 'dpr-1', status: 'SUBMITTED', projectId: 'p-1', preparedBy: 'se', measurements: [], attachments: [] },
      });
      repo.lockDpr.mockRejectedValue(error);
      const err = await service.approve(identity, 'dpr-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        errorCode: 'DPR_CHANGED',
        message: expect.stringContaining('busy'),
      });
    }
  });

  it('approve: not SUBMITTED at the pre-check is 409 DPR_CHANGED (same as the in-transaction check)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    const err = await service.approve(identity, 'dpr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ errorCode: 'DPR_CHANGED' });
    expect(repo.lockDpr).not.toHaveBeenCalled();
  });

  it('removeLabourRow: a row deleted concurrently (P2025) is a 404, not a 500', async () => {
    const { repo, service } = build();
    repo.deleteLabourRow.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to delete does not exist.', { code: 'P2025', clientVersion: 'x' }),
    );
    await expect(service.removeLabourRow(identity, 'dpr-1', 'row-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('attachEvidence: rejects a file that is not READY', async () => {
    const { repo, service } = build({ file: { id: 'f-1', status: 'PENDING' } });
    await expect(service.attachEvidence(identity, 'dpr-1', 'f-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createAttachment).not.toHaveBeenCalled();
  });

  it('addMeasurement: threads an optional location through to the record', async () => {
    const { repo, service } = build();
    await service.addMeasurement(identity, 'dpr-1', { boqNodeId: 'n1', quantity: 120, locationArea: 'Units 301-308' });
    expect(repo.addMeasurement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationArea: 'Units 301-308' }),
    );
  });

  it('attachEvidence: tags a specific work entry when its measurementId belongs to the report', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1' }], attachments: [] },
    });
    await service.attachEvidence(identity, 'dpr-1', 'f-1', 'm-1');
    expect(repo.createAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ measurementId: 'm-1' }),
    );
  });

  it('attachEvidence: rejects a measurementId that does not belong to this report', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', measurements: [{ id: 'm-1', boqNodeId: 'n1' }], attachments: [] },
    });
    await expect(
      service.attachEvidence(identity, 'dpr-1', 'f-1', 'm-from-another-report'),
    ).rejects.toBeInstanceOf(BadRequestException);
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
      leafValues: [
        { id: 'n1', totalAmount: '100000.00' },
        { id: 'n2', totalAmount: '100000.00' },
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

  /**
   * The memo's worked example (`ceo-memo-work-package-progress-weighting.md`). A day of
   * setting-out and a fortnight of concrete used to read as "half built" because every leaf
   * counted equally, while 9,500 m³ was still in the ground.
   */
  it('getRollup: weights a package by leaf value, not by counting leaves equally', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Substructure',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'setting-out' }, { boqNodeId: 'concrete' }],
        },
      ],
      measurements: [
        // 1 lot of 1 → 100%
        { boqNodeId: 'setting-out', quantity: 1, boqNode: { id: 'setting-out', code: '1', description: 'Setting out', quantity: 1 } },
        // 500 m³ of 10,000 → 5%
        { boqNodeId: 'concrete', quantity: 500, boqNode: { id: 'concrete', code: '2', description: 'RC', quantity: 10000 } },
      ],
      leafValues: [
        { id: 'setting-out', totalAmount: '2000.00' },
        { id: 'concrete', totalAmount: '998000.00' },
      ],
    });

    const res = await service.getRollup(identity, 'p-1');

    // (2,000×100 + 998,000×5) ÷ 1,000,000 = 5.19 — not the old plain average of 52.5.
    expect(res.packages[0]!.percentComplete).toBe(5);
    expect(res.physicalPercent).toBeCloseTo(5.19, 2);
  });

  /**
   * ADR-029 CONST-BOQ-028 / spec P-1: a CONTINGENCY leaf is money held in reserve, not physical
   * work, so it must carry zero progress weight. A large contingency line must not drag the
   * physical % up or down — the number must equal the one you'd get without any contingency line.
   */
  it('getRollup (P-1): a CONTINGENCY leaf contributes zero weight — % matches a project without it', async () => {
    // Baseline: one real work leaf at 40% and nothing else.
    const withoutContingency = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Structure',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'work' }],
        },
      ],
      measurements: [
        { boqNodeId: 'work', quantity: 400, boqNode: { id: 'work', code: '1', description: 'RC', quantity: 1000 } }, // 40%
      ],
      leafValues: [{ id: 'work', totalAmount: '500000.00', nodeRole: 'WORK' }],
    });

    // Same package, plus a large CONTINGENCY leaf allocated to it (0% measured, big value).
    const withContingency = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Structure',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'work' }, { boqNodeId: 'contingency' }],
        },
      ],
      measurements: [
        { boqNodeId: 'work', quantity: 400, boqNode: { id: 'work', code: '1', description: 'RC', quantity: 1000 } }, // 40%
      ],
      leafValues: [
        { id: 'work', totalAmount: '500000.00', nodeRole: 'WORK' },
        // A huge reserve; if it counted, at 0% it would crush the package % toward zero.
        { id: 'contingency', totalAmount: '5000000.00', nodeRole: 'CONTINGENCY' },
      ],
    });

    const base = await withoutContingency.service.getRollup(identity, 'p-1');
    const withC = await withContingency.service.getRollup(identity, 'p-1');

    expect(base.packages[0]!.percentComplete).toBe(40);
    // Identical — the 5M contingency line added zero weight (P-1), not dragged it toward 3.6%.
    expect(withC.packages[0]!.percentComplete).toBe(40);
    expect(withC.physicalPercent).toBe(base.physicalPercent);
  });

  /**
   * Spec P-2: SEPARATE_CHARGE and ABSORBED leaves are real work (`nodeRole = WORK`), so they must
   * still be value-weighted into the roll-up exactly like any in-contract work line.
   */
  it('getRollup (P-2): SEPARATE_CHARGE and ABSORBED leaves are real work and still roll up', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Mixed',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'separate' }, { boqNodeId: 'absorbed' }],
        },
      ],
      measurements: [
        { boqNodeId: 'separate', quantity: 1000, boqNode: { id: 'separate', code: '1', description: 'Pay-now extra', quantity: 1000 } }, // 100%
        { boqNodeId: 'absorbed', quantity: 0, boqNode: { id: 'absorbed', code: '2', description: 'Absorbed extra', quantity: 1000 } }, // 0%
      ],
      // Both classified as extra work but are `nodeRole = WORK` (only the treatment differs).
      leafValues: [
        { id: 'separate', totalAmount: '30000.00', nodeRole: 'WORK' },
        { id: 'absorbed', totalAmount: '10000.00', nodeRole: 'WORK' },
      ],
    });

    const res = await service.getRollup(identity, 'p-1');
    // (30,000×100 + 10,000×0) ÷ 40,000 = 75 — both leaves counted, not dropped.
    expect(res.packages[0]!.percentComplete).toBe(75);
  });

  /**
   * A leaf with no rate is worth nothing, so a package where nothing is priced has no values to
   * weight by. Falling back to the plain average beats reporting 0% for work that happened.
   */
  it('getRollup: falls back to a plain average when no leaf in the package is priced', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Unpriced',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'n1' }, { boqNodeId: 'n2' }],
        },
      ],
      measurements: [
        { boqNodeId: 'n1', quantity: 1000, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }, // 100%
        { boqNodeId: 'n2', quantity: 0, boqNode: { id: 'n2', code: '2', description: 'y', quantity: 1000 } }, // 0%
      ],
      leafValues: [
        { id: 'n1', totalAmount: null },
        { id: 'n2', totalAmount: null },
      ],
    });

    const res = await service.getRollup(identity, 'p-1');
    expect(res.packages[0]!.percentComplete).toBe(50);
  });

  /**
   * An allocated leaf that has never been measured still carries value. Leaving it out of the
   * denominator would let a package read 100% as soon as its first item finished.
   */
  it('getRollup: counts an allocated leaf with no progress yet', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Mixed',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'done' }, { boqNodeId: 'untouched' }],
        },
      ],
      measurements: [
        { boqNodeId: 'done', quantity: 100, boqNode: { id: 'done', code: '1', description: 'x', quantity: 100 } }, // 100%
      ],
      leafValues: [
        { id: 'done', totalAmount: '50000.00' },
        { id: 'untouched', totalAmount: '50000.00' },
      ],
    });

    const res = await service.getRollup(identity, 'p-1');
    expect(res.packages[0]!.percentComplete).toBe(50);
  });

  it('allocateBoqNode: allocates a free BOQ leaf to a work package', async () => {
    const { repo, service } = build();
    await service.allocateBoqNode(identity, 'wp-1', 'n1');
    expect(repo.allocateBoqNode).toHaveBeenCalledWith(expect.anything(), 'wp-1', 'n1');
  });

  it('allocateBoqNode: rejects a leaf already allocated to another package (CONST-PROG-012) with 409 BOQ_ITEM_ALREADY_ALLOCATED', async () => {
    const { repo, service } = build({ leafAllocation: { workPackageId: 'wp-OTHER' } });
    const err = await service.allocateBoqNode(identity, 'wp-1', 'n1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      errorCode: 'BOQ_ITEM_ALREADY_ALLOCATED',
    });
    expect(repo.allocateBoqNode).not.toHaveBeenCalled();
  });

  it('allocateBoqNode: maps a racing unique-leaf violation (P2002) to 409 BOQ_ITEM_ALREADY_ALLOCATED, not a 500', async () => {
    const { repo, service } = build();
    repo.allocateBoqNode.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['boq_node_id'] },
      }),
    );
    const err = await service.allocateBoqNode(identity, 'wp-1', 'n1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      errorCode: 'BOQ_ITEM_ALREADY_ALLOCATED',
      message: expect.stringContaining('already allocated'),
    });
  });

  it.each([
    ['meta.modelName', { modelName: 'WorkPackageBoqNode', target: undefined }],
    ['a column-array target', { target: ['boq_node_id'] }],
    ['a constraint-name string target', { target: 'work_package_boq_nodes_boq_node_id_key' }],
  ])('allocateBoqNode: maps P2002 identified by %s to 409', async (_label, meta) => {
    const { repo, service } = build();
    repo.allocateBoqNode.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'x',
        meta,
      }),
    );
    const err = await service.allocateBoqNode(identity, 'wp-1', 'n1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      errorCode: 'BOQ_ITEM_ALREADY_ALLOCATED',
    });
  });

  it('allocateBoqNode: a P2002 on another model (WorkPackage code) is not remapped', async () => {
    const { repo, service } = build();
    const codeClash = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { modelName: 'WorkPackage', target: 'work_packages_project_id_code_key' },
    });
    repo.allocateBoqNode.mockRejectedValue(codeClash);
    await expect(service.allocateBoqNode(identity, 'wp-1', 'n1')).rejects.toBe(codeClash);
  });

  it('allocateBoqNode: lets an unrelated database error propagate unchanged', async () => {
    const { repo, service } = build();
    const boom = new Error('connection reset');
    repo.allocateBoqNode.mockRejectedValue(boom);
    await expect(service.allocateBoqNode(identity, 'wp-1', 'n1')).rejects.toBe(boom);
  });

  // ── Master Schedule P1-a (ADR-029): WorkPackage schedule window + update guards ──

  it('updateWorkPackage: persists the schedule window (planned dates / duration / forecast)', async () => {
    const { repo, service } = build();
    await service.updateWorkPackage(identity, 'wp-1', {
      name: 'Excavation & Foundation',
      plannedStart: '2026-06-01',
      plannedEnd: '2026-06-21',
      durationDays: 21,
      forecastEnd: '2026-06-25',
    });
    expect(repo.updateWorkPackage).toHaveBeenCalledWith(
      expect.anything(),
      'wp-1',
      expect.objectContaining({
        name: 'Excavation & Foundation',
        plannedStart: new Date('2026-06-01'),
        plannedEnd: new Date('2026-06-21'),
        durationDays: 21,
        forecastEnd: new Date('2026-06-25'),
      }),
    );
  });

  it('updateWorkPackage: rejects plannedEnd before plannedStart', async () => {
    const { repo, service } = build();
    await expect(
      service.updateWorkPackage(identity, 'wp-1', { plannedStart: '2026-06-21', plannedEnd: '2026-06-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateWorkPackage).not.toHaveBeenCalled();
  });

  it('updateWorkPackage: rejects a negative durationDays', async () => {
    const { repo, service } = build();
    await expect(
      service.updateWorkPackage(identity, 'wp-1', { durationDays: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateWorkPackage).not.toHaveBeenCalled();
  });

  it('updateWorkPackage: rejects scheduleOnly=true on a package that has BOQ links (§8.5)', async () => {
    const { repo, service } = build({
      workPackageForUpdate: { id: 'wp-1', projectId: 'p-1', _count: { boqLinks: 2 } },
    });
    await expect(
      service.updateWorkPackage(identity, 'wp-1', { scheduleOnly: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateWorkPackage).not.toHaveBeenCalled();
  });

  it('updateWorkPackage: allows scheduleOnly=true when the package has no BOQ links', async () => {
    const { repo, service } = build({
      workPackageForUpdate: { id: 'wp-1', projectId: 'p-1', _count: { boqLinks: 0 } },
    });
    await service.updateWorkPackage(identity, 'wp-1', { scheduleOnly: true });
    expect(repo.updateWorkPackage).toHaveBeenCalledWith(
      expect.anything(),
      'wp-1',
      expect.objectContaining({ scheduleOnly: true }),
    );
  });

  it('getRollup: surfaces the planned schedule window + percentComplete per package (P1-a read model)', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Excavation & Foundation',
          responsibleOwner: 'Ahmed',
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'n1' }],
          plannedStart: new Date('2026-06-01'),
          plannedEnd: new Date('2026-06-21'),
          durationDays: 21,
          forecastEnd: new Date('2026-06-25'),
          scheduleOnly: false,
        },
      ],
      measurements: [
        { boqNodeId: 'n1', quantity: 300, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }, // 30%
      ],
      leafValues: [{ id: 'n1', totalAmount: '100000.00' }],
    });
    const res = await service.getRollup(identity, 'p-1');
    const line = res.packages[0]!;
    expect(line.percentComplete).toBe(30);
    expect(line.plannedStart).toBe('2026-06-01');
    expect(line.plannedEnd).toBe('2026-06-21');
    expect(line.durationDays).toBe(21);
    expect(line.forecastEnd).toBe('2026-06-25');
    expect(line.scheduleOnly).toBe(false);
  });

  it('getRollup: a scheduleOnly phase reports null percentComplete and is excluded from the weighting (§8.5)', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'mob',
          code: 'WP-00',
          name: 'Mobilization',
          responsibleOwner: null,
          progressWeight: '0',
          boqLinks: [],
          plannedStart: new Date('2026-06-01'),
          plannedEnd: new Date('2026-06-08'),
          durationDays: 7,
          forecastEnd: null,
          scheduleOnly: true,
        },
        {
          id: 'exc',
          code: 'WP-01',
          name: 'Excavation',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'n1' }],
          plannedStart: null,
          plannedEnd: null,
          durationDays: null,
          forecastEnd: null,
          scheduleOnly: false,
        },
      ],
      measurements: [
        { boqNodeId: 'n1', quantity: 500, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }, // 50%
      ],
      leafValues: [{ id: 'n1', totalAmount: '100000.00' }],
    });
    const res = await service.getRollup(identity, 'p-1');
    const mob = res.packages.find((p) => p.id === 'mob')!;
    expect(mob.percentComplete).toBeNull();
    // The schedule-only phase's zero weight is excluded, so weights still total 100% → complete.
    expect(res.weightsTotal).toBe('1');
    expect(res.weightsComplete).toBe(true);
    // Project physical % is driven by the measurable package alone: 1 × 50% = 50.
    expect(res.physicalPercent).toBe(50);
  });

  /**
   * Regression guard for the value-weighting the getRollup docstring now documents correctly.
   * The master-schedule build spec's worked example: 1 lot @100% + 10,000 m³ @5% ≈ 5%, not 52.5%.
   */
  it('getRollup: percentComplete is value-weighted, not a plain average (master-schedule regression)', async () => {
    const { service } = build({
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Structure',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'lot' }, { boqNodeId: 'concrete' }],
          plannedStart: null,
          plannedEnd: null,
          durationDays: null,
          forecastEnd: null,
          scheduleOnly: false,
        },
      ],
      measurements: [
        { boqNodeId: 'lot', quantity: 1, boqNode: { id: 'lot', code: '1', description: 'Lot', quantity: 1 } }, // 100%
        { boqNodeId: 'concrete', quantity: 500, boqNode: { id: 'concrete', code: '2', description: 'RC', quantity: 10000 } }, // 5%
      ],
      leafValues: [
        { id: 'lot', totalAmount: '2000.00' },
        { id: 'concrete', totalAmount: '998000.00' },
      ],
    });
    const res = await service.getRollup(identity, 'p-1');
    // (2,000×100 + 998,000×5) ÷ 1,000,000 = 5.19 → rounded 5, NOT the plain average 52.5.
    expect(res.packages[0]!.percentComplete).toBe(5);
    expect(res.physicalPercent).toBeCloseTo(5.19, 2);
  });

  // ── Master Schedule P1-b (ADR-029): DERIVED actualStart / actualFinish / scheduleStatus ──

  /** A package with a partly-verified leaf: actualStart = the earliest approved date; no finish yet. */
  function partialProgressWP(over: {
    plannedStart?: Date | null;
    plannedEnd?: Date | null;
    reportDates?: { boqNodeId: string; reportDate: Date }[];
    verifiedQty?: number;
  } = {}) {
    return {
      workPackages: [
        {
          id: 'a',
          code: 'WP-A',
          name: 'Excavation',
          responsibleOwner: null,
          progressWeight: '1',
          boqLinks: [{ boqNodeId: 'n1' }],
          plannedStart: over.plannedStart ?? null,
          plannedEnd: over.plannedEnd ?? null,
          durationDays: null,
          forecastEnd: null,
          scheduleOnly: false,
        },
      ],
      measurements: [
        {
          boqNodeId: 'n1',
          quantity: over.verifiedQty ?? 300,
          boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 },
        },
      ],
      leafValues: [{ id: 'n1', totalAmount: '100000.00' }],
      reportDates: over.reportDates ?? [],
    };
  }

  it('getRollup: actualStart is the earliest approved-DPR date on the package leaves', async () => {
    const { service } = build(
      partialProgressWP({
        reportDates: [
          { boqNodeId: 'n1', reportDate: new Date('2026-06-10') },
          { boqNodeId: 'n1', reportDate: new Date('2026-06-03') }, // earliest
          { boqNodeId: 'n1', reportDate: new Date('2026-06-18') },
        ],
      }),
    );
    const line = (await service.getRollup(identity, 'p-1')).packages[0]!;
    expect(line.actualStart).toBe('2026-06-03');
  });

  it('getRollup: actualStart is null when the package has no approved measurements', async () => {
    const { service } = build(partialProgressWP({ reportDates: [] }));
    const line = (await service.getRollup(identity, 'p-1')).packages[0]!;
    expect(line.actualStart).toBeNull();
    expect(line.actualFinish).toBeNull();
  });

  it('getRollup: actualFinish stays null until the package is 100% complete', async () => {
    const { service } = build(
      partialProgressWP({
        verifiedQty: 300, // 30% — not complete
        reportDates: [
          { boqNodeId: 'n1', reportDate: new Date('2026-06-03') },
          { boqNodeId: 'n1', reportDate: new Date('2026-06-18') },
        ],
      }),
    );
    const line = (await service.getRollup(identity, 'p-1')).packages[0]!;
    expect(line.percentComplete).toBe(30);
    expect(line.actualStart).toBe('2026-06-03');
    expect(line.actualFinish).toBeNull();
  });

  it('getRollup: actualFinish = the latest approved-DPR date once the package reaches 100%', async () => {
    const { service } = build(
      partialProgressWP({
        verifiedQty: 1000, // 1000/1000 = 100%
        reportDates: [
          { boqNodeId: 'n1', reportDate: new Date('2026-06-03') },
          { boqNodeId: 'n1', reportDate: new Date('2026-06-25') }, // latest
        ],
      }),
    );
    const line = (await service.getRollup(identity, 'p-1')).packages[0]!;
    expect(line.percentComplete).toBe(100);
    expect(line.actualStart).toBe('2026-06-03');
    expect(line.actualFinish).toBe('2026-06-25');
  });

  it('getRollup: scheduleStatus AHEAD when actual % leads the planned window at asOf', async () => {
    // Planned 01→21 Jun; asOf 08 Jun ≈ 35% expected; verified 700/1000 = 70% → +35 pts → AHEAD.
    const { service } = build(
      partialProgressWP({
        plannedStart: new Date('2026-06-01'),
        plannedEnd: new Date('2026-06-21'),
        verifiedQty: 700,
      }),
    );
    const line = (await service.getRollup(identity, 'p-1', '2026-06-08')).packages[0]!;
    expect(line.percentComplete).toBe(70);
    expect(line.scheduleStatus).toBe('AHEAD');
  });

  it('getRollup: scheduleStatus ON_TRACK when actual % sits within the band of expected', async () => {
    // Planned 01→21 Jun (20-day span); asOf 11 Jun = 50% expected; verified 500/1000 = 50% → 0 → ON_TRACK.
    const { service } = build(
      partialProgressWP({
        plannedStart: new Date('2026-06-01'),
        plannedEnd: new Date('2026-06-21'),
        verifiedQty: 500,
      }),
    );
    const line = (await service.getRollup(identity, 'p-1', '2026-06-11')).packages[0]!;
    expect(line.percentComplete).toBe(50);
    expect(line.scheduleStatus).toBe('ON_TRACK');
  });

  it('getRollup: scheduleStatus BEHIND when actual % trails the planned window at asOf', async () => {
    // Planned 01→21 Jun; asOf 16 Jun = 75% expected; verified 100/1000 = 10% → −65 pts → BEHIND.
    const { service } = build(
      partialProgressWP({
        plannedStart: new Date('2026-06-01'),
        plannedEnd: new Date('2026-06-21'),
        verifiedQty: 100,
      }),
    );
    const line = (await service.getRollup(identity, 'p-1', '2026-06-16')).packages[0]!;
    expect(line.percentComplete).toBe(10);
    expect(line.scheduleStatus).toBe('BEHIND');
  });

  it('getRollup: scheduleStatus INSUFFICIENT_DATA when the planned window is unset', async () => {
    const { service } = build(
      partialProgressWP({ plannedStart: null, plannedEnd: null, verifiedQty: 500 }),
    );
    const line = (await service.getRollup(identity, 'p-1', '2026-06-16')).packages[0]!;
    expect(line.scheduleStatus).toBe('INSUFFICIENT_DATA');
  });

  it('getRollup: a scheduleOnly phase derives status from dates only, no % and no actual dates', async () => {
    const base = {
      id: 'mob',
      code: 'WP-00',
      name: 'Mobilization',
      responsibleOwner: null,
      progressWeight: '0',
      boqLinks: [],
      plannedStart: new Date('2026-06-01'),
      plannedEnd: new Date('2026-06-08'),
      durationDays: 7,
      forecastEnd: null,
      scheduleOnly: true,
    };
    // asOf within the window → ON_TRACK; percentComplete null; no actual dates (no measurable scope).
    const onTrack = build({ workPackages: [base], measurements: [], leafValues: [] });
    const within = (await onTrack.service.getRollup(identity, 'p-1', '2026-06-05')).packages[0]!;
    expect(within.percentComplete).toBeNull();
    expect(within.actualStart).toBeNull();
    expect(within.actualFinish).toBeNull();
    expect(within.scheduleStatus).toBe('ON_TRACK');

    // asOf past plannedEnd with nothing to mark it done → BEHIND.
    const late = build({ workPackages: [base], measurements: [], leafValues: [] });
    const overdue = (await late.service.getRollup(identity, 'p-1', '2026-06-20')).packages[0]!;
    expect(overdue.scheduleStatus).toBe('BEHIND');
  });

  it('signal: COST_AHEAD when cost consumed outpaces physical progress', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20% built
      fp: { actualCost: '510', budgetTotal: '1000' }, // 51% cost consumed
    });
    const res = await service.getPhysicalFinancialSignal(financeIdentity, 'p-1');
    expect(res.physicalPercent).toBe(20);
    expect(res.costConsumedPercent).toBe(51);
    expect(res.divergence).toBe(-31);
    expect(res.status).toBe('COST_AHEAD');
  });

  it('signal: ALIGNED when physical and cost are within the threshold', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20%
      fp: { actualCost: '250', budgetTotal: '1000' }, // 25%
    });
    const res = await service.getPhysicalFinancialSignal(financeIdentity, 'p-1');
    expect(res.status).toBe('ALIGNED');
  });

  it('collection signal: CASH_AHEAD when collection outpaces physical progress', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20% built
      fp: { actualCost: '0', budgetTotal: null, contractValue: '1000', receivedRevenue: '700' }, // 70% collected
    });
    const res = await service.getCollectionProgressSignal(financeIdentity, 'p-1');
    expect(res.physicalPercent).toBe(20);
    expect(res.collectedPercent).toBe(70);
    expect(res.divergence).toBe(50);
    expect(res.status).toBe('CASH_AHEAD');
  });

  it('collection signal: WORK_AHEAD when building outpaces collection', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 800, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 80% built
      fp: { actualCost: '0', budgetTotal: null, contractValue: '1000', receivedRevenue: '100' }, // 10% collected
    });
    const res = await service.getCollectionProgressSignal(financeIdentity, 'p-1');
    expect(res.status).toBe('WORK_AHEAD');
    expect(res.divergence).toBe(-70);
  });

  it('collection signal: INSUFFICIENT_DATA without a contract value', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }],
      fp: { actualCost: '0', budgetTotal: null, contractValue: null, receivedRevenue: null },
    });
    const res = await service.getCollectionProgressSignal(financeIdentity, 'p-1');
    expect(res.collectedPercent).toBeNull();
    expect(res.status).toBe('INSUFFICIENT_DATA');
  });

  // ── Money visibility (Progress redesign): PM / Site Engineer are money-blind ──────────────

  const signalFixture = {
    workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
    measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20% built
    fp: { actualCost: '510', budgetTotal: '1000', contractValue: '1000', receivedRevenue: '700' },
  };
  /** A finance caller: the legacy commercial gate carries both money tiers. */
  const financeIdentity: RequestIdentity = {
    ...identity,
    permissions: [PERMISSIONS.projectsView, PERMISSIONS.financialPositionView],
  };
  /** A money-blind caller (PM / Site Engineer): view:project only, no cost or margin tier. */
  const moneyBlindIdentity: RequestIdentity = { ...identity, permissions: [PERMISSIONS.projectsView] };

  it('signal: shows cost amounts to a caller with the cost tier', async () => {
    const { service } = build(signalFixture);
    const res = await service.getPhysicalFinancialSignal(financeIdentity, 'p-1');
    expect(res).toMatchObject({ actualCost: '510', budgetTotal: '1000', moneyVisible: true, costConsumedPercent: 51 });
  });

  it('signal: a caller with the cost tier gets the ratio, divergence and status', async () => {
    const { service } = build(signalFixture);
    const res = await service.getPhysicalFinancialSignal(financeIdentity, 'p-1');
    expect(res).toMatchObject({ physicalPercent: 20, divergence: -31, status: 'COST_AHEAD' });
  });

  it('signal: a money-blind caller gets no amount, ratio, divergence or status — only physical %', async () => {
    const { service } = build(signalFixture);
    const res = await service.getPhysicalFinancialSignal(moneyBlindIdentity, 'p-1');
    expect(res).toEqual({
      projectId: 'p-1',
      physicalPercent: 20,
      actualCost: null,
      budgetTotal: null,
      moneyVisible: false,
      costConsumedPercent: null,
      divergence: null,
      status: 'HIDDEN',
      weightsComplete: true,
    });
  });

  it('signal: the cost tier alone (Construction Director) reveals the cost ratio', async () => {
    const { service } = build(signalFixture);
    const res = await service.getPhysicalFinancialSignal(
      { ...identity, permissions: [PERMISSIONS.projectsView, PERMISSIONS.boqViewCost] },
      'p-1',
    );
    expect(res.costConsumedPercent).toBe(51);
    expect(res.status).toBe('COST_AHEAD');
  });

  it('collection signal: shows contract value and revenue to a caller with the commercial tier', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(financeIdentity, 'p-1');
    expect(res).toMatchObject({ contractValue: '1000', receivedRevenue: '700', moneyVisible: true, collectedPercent: 70 });
  });

  it('collection signal: a caller with the commercial tier gets the ratio, divergence and status', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(financeIdentity, 'p-1');
    expect(res).toMatchObject({ physicalPercent: 20, divergence: 50, status: 'CASH_AHEAD' });
  });

  it('collection signal: a money-blind caller gets no amount, collected %, divergence or status', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(moneyBlindIdentity, 'p-1');
    expect(res).toEqual({
      projectId: 'p-1',
      physicalPercent: 20,
      contractValue: null,
      receivedRevenue: null,
      moneyVisible: false,
      collectedPercent: null,
      divergence: null,
      status: 'HIDDEN',
      weightsComplete: true,
    });
  });

  it('collection signal: the cost tier alone (no view:contract, no margin) does not reveal contract revenue', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(
      { ...identity, permissions: [PERMISSIONS.projectsView, PERMISSIONS.boqViewCost] },
      'p-1',
    );
    expect(res.contractValue).toBeNull();
    expect(res.receivedRevenue).toBeNull();
    expect(res.collectedPercent).toBeNull();
    expect(res.status).toBe('HIDDEN');
  });

  it('collection signal: Construction Director-like (view:contract, no margin) sees the contract figures', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(
      {
        ...identity,
        permissions: [PERMISSIONS.projectsView, PERMISSIONS.boqViewCost, PERMISSIONS.contractsView],
      },
      'p-1',
    );
    expect(res).toMatchObject({
      contractValue: '1000',
      receivedRevenue: '700',
      moneyVisible: true,
      collectedPercent: 70,
      divergence: 50,
      status: 'CASH_AHEAD',
    });
  });

  it('collection signal: Project Manager-like (view:procurement, no view:contract) stays hidden', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(
      { ...identity, permissions: [PERMISSIONS.projectsView, PERMISSIONS.procurementView] },
      'p-1',
    );
    expect(res).toMatchObject({ contractValue: null, collectedPercent: null, divergence: null, status: 'HIDDEN' });
  });

  it('collection signal: the margin tier alone sees the contract figures', async () => {
    const { service } = build(signalFixture);
    const res = await service.getCollectionProgressSignal(
      { ...identity, permissions: [PERMISSIONS.boqViewMargin] },
      'p-1',
    );
    expect(res).toMatchObject({ collectedPercent: 70, status: 'CASH_AHEAD' });
  });

  it('cost signal: view:contract alone does not reveal the cost ratio (stays on the cost tier)', async () => {
    const { service } = build(signalFixture);
    const res = await service.getPhysicalFinancialSignal(
      { ...identity, permissions: [PERMISSIONS.projectsView, PERMISSIONS.contractsView] },
      'p-1',
    );
    expect(res).toMatchObject({ costConsumedPercent: null, status: 'HIDDEN' });
  });

  it('listDprs: resolves preparedByName for a known preparer and leaves unknown ids undefined', async () => {
    const { repo, service } = build({
      dprs: [
        { id: 'dpr-1', projectId: 'p-1', status: 'DRAFT', preparedBy: 'user-1' },
        { id: 'dpr-2', projectId: 'p-1', status: 'DRAFT', preparedBy: 'ghost-user' },
      ],
      users: [{ id: 'user-1', firstName: 'Ahmed', lastName: 'Shirie' }],
    });
    const res = await service.listDprs(identity, 'p-1');
    expect(res[0].preparedByName).toBe('Ahmed Shirie');
    expect(res[1].preparedByName).toBeUndefined();
    // One users query for the whole list (batched), scoped to the tenant.
    expect(repo.findUserNamesByIds).toHaveBeenCalledTimes(1);
    expect(repo.findUserNamesByIds).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      expect.arrayContaining(['user-1', 'ghost-user']),
    );
  });

  it('listDprs: resolves returnedByName in the same batched users query', async () => {
    const { repo, service } = build({
      dprs: [{ id: 'dpr-1', projectId: 'p-1', status: 'RETURNED', preparedBy: 'user-2', returnedBy: 'user-1' }],
      users: [
        { id: 'user-1', firstName: 'Ahmed', lastName: 'Shirie' },
        { id: 'user-2', firstName: 'Site', lastName: 'Engineer' },
      ],
    });
    const res = await service.listDprs(identity, 'p-1');
    expect(res[0]).toMatchObject({ preparedByName: 'Site Engineer', returnedByName: 'Ahmed Shirie' });
    expect(repo.findUserNamesByIds).toHaveBeenCalledTimes(1);
  });

  it('listDprs: adds the distinct work packages each report touches, from one batched query', async () => {
    const wp = (id: string, code: string) => ({ workPackage: { id, code, name: `Package ${code}` } });
    const { repo, service } = build({
      dprs: [
        { id: 'dpr-1', projectId: 'p-1', status: 'DRAFT', preparedBy: 'user-1' },
        { id: 'dpr-2', projectId: 'p-1', status: 'DRAFT', preparedBy: 'user-1' },
      ],
      dprWorkPackages: [
        { dprId: 'dpr-1', boqNode: { workPackageLinks: [wp('wp-b', 'WP-02')] } },
        { dprId: 'dpr-1', boqNode: { workPackageLinks: [wp('wp-a', 'WP-01')] } },
        { dprId: 'dpr-1', boqNode: { workPackageLinks: [wp('wp-b', 'WP-02')] } }, // same package again
        { dprId: 'dpr-1', boqNode: { workPackageLinks: [] } }, // an unallocated leaf
      ],
    });

    const res = await service.listDprs(identity, 'p-1');

    expect(res[0]!.workPackages).toEqual([
      { id: 'wp-a', code: 'WP-01', name: 'Package WP-01' },
      { id: 'wp-b', code: 'WP-02', name: 'Package WP-02' },
    ]);
    expect(res[1]!.workPackages).toEqual([]);
    expect(repo.findWorkPackagesForDprs).toHaveBeenCalledTimes(1);
    expect(repo.findWorkPackagesForDprs).toHaveBeenCalledWith(expect.anything(), 'org-1', ['dpr-1', 'dpr-2']);
  });

  it('listDprs: approvedByName, and reviewedByName = approver (APPROVED), reopener (REOPENED) or returner (RETURNED)', async () => {
    const { repo, service } = build({
      dprs: [
        { id: 'a', projectId: 'p-1', status: 'APPROVED', preparedBy: 'se', approvedBy: 'pm', returnedBy: null },
        { id: 'r', projectId: 'p-1', status: 'RETURNED', preparedBy: 'se', approvedBy: null, returnedBy: 'pm2' },
        { id: 'o', projectId: 'p-1', status: 'REOPENED', preparedBy: 'se', approvedBy: 'pm', returnedBy: null, reopenedBy: 'pm2' },
        { id: 's', projectId: 'p-1', status: 'SUBMITTED', preparedBy: 'se', approvedBy: null, returnedBy: 'pm2' },
      ],
      users: [
        { id: 'se', firstName: 'Site', lastName: 'Eng' },
        { id: 'pm', firstName: 'Project', lastName: 'Manager' },
        { id: 'pm2', firstName: 'Other', lastName: 'PM' },
      ],
    });

    const res = await service.listDprs(identity, 'p-1');

    expect(res.map((d) => [d.approvedByName, d.reviewedByName])).toEqual([
      ['Project Manager', 'Project Manager'],
      [undefined, 'Other PM'],
      ['Project Manager', 'Other PM'], // REOPENED: the reopener is the latest reviewer
      [undefined, undefined], // resubmitted after a return: not reviewed yet
    ]);
    // Still one users query for every name on the list.
    expect(repo.findUserNamesByIds).toHaveBeenCalledTimes(1);
  });

  it('getDpr: resolves the single report preparedByName', async () => {
    const { service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', preparedBy: 'user-1', measurements: [], attachments: [] },
      users: [{ id: 'user-1', firstName: 'Ahmed', lastName: 'Shirie' }],
    });
    const res = await service.getDpr(identity, 'dpr-1');
    expect(res.preparedByName).toBe('Ahmed Shirie');
  });

  it('getDpr: a REOPENED report exposes reopenedAt, reopenedByName and each entry createdAt', async () => {
    const reopenedAt = new Date('2026-09-20T10:00:00.000Z');
    const before = new Date('2026-09-18T08:00:00.000Z');
    const after = new Date('2026-09-21T08:00:00.000Z');
    const { service } = build({
      dpr: {
        id: 'dpr-1',
        status: 'REOPENED',
        projectId: 'p-1',
        preparedBy: 'user-1',
        approvedBy: 'pm',
        reopenedBy: 'pm',
        reopenedAt,
        measurements: [
          { id: 'm-old', boqNodeId: 'n1', quantity: 5, createdAt: before },
          { id: 'm-new', boqNodeId: 'n1', quantity: 2, createdAt: after },
        ],
        attachments: [],
      },
      users: [
        { id: 'user-1', firstName: 'Site', lastName: 'Eng' },
        { id: 'pm', firstName: 'Project', lastName: 'Manager' },
      ],
    });

    const res = (await service.getDpr(identity, 'dpr-1')) as unknown as {
      reopenedAt: Date;
      reopenedByName: string;
      measurements: Array<{ id: string; createdAt: Date }>;
    };

    expect(res.reopenedAt).toEqual(reopenedAt);
    expect(res.reopenedByName).toBe('Project Manager');
    // Serialised as ISO strings on the wire; the editor compares each entry against the reopen.
    expect(JSON.parse(JSON.stringify(res.measurements))).toEqual([
      expect.objectContaining({ id: 'm-old', createdAt: before.toISOString() }),
      expect.objectContaining({ id: 'm-new', createdAt: after.toISOString() }),
    ]);
    expect(JSON.parse(JSON.stringify(res)).reopenedAt).toBe(reopenedAt.toISOString());
  });
});
