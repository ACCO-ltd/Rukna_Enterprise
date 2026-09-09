import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

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
    updateDprStatus: jest.fn().mockResolvedValue({ id: 'dpr-1' }),
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
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
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
    expect(repo.updateDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
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
    );
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
    expect(repo.updateDprStatus).not.toHaveBeenCalled();
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

  it('reopen: moves an APPROVED report to REOPENED with the reopen audit trail (CONST-PROG-010)', async () => {
    const { repo, service } = build({
      dpr: { id: 'dpr-1', status: 'APPROVED', projectId: 'p-1', measurements: [], attachments: [] },
    });
    await service.reopen(identity, 'dpr-1', 'Grid 5 double-counted — reopening to correct');
    expect(repo.updateDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
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
    expect(repo.updateDprStatus).not.toHaveBeenCalled();
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
    expect(repo.updateDprStatus).not.toHaveBeenCalled();
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
    expect(repo.updateDprStatus).toHaveBeenCalledWith(
      expect.anything(),
      'dpr-1',
      expect.objectContaining({ status: 'SUBMITTED' }),
    );
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

  it('allocateBoqNode: rejects a leaf already allocated to another package (CONST-PROG-012)', async () => {
    const { repo, service } = build({ leafAllocation: { workPackageId: 'wp-OTHER' } });
    await expect(service.allocateBoqNode(identity, 'wp-1', 'n1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.allocateBoqNode).not.toHaveBeenCalled();
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
      fp: { actualCost: '250', budgetTotal: '1000' }, // 25%
    });
    const res = await service.getPhysicalFinancialSignal(identity, 'p-1');
    expect(res.status).toBe('ALIGNED');
  });

  it('collection signal: CASH_AHEAD when collection outpaces physical progress', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }], // 20% built
      fp: { actualCost: '0', budgetTotal: null, contractValue: '1000', receivedRevenue: '700' }, // 70% collected
    });
    const res = await service.getCollectionProgressSignal(identity, 'p-1');
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
    const res = await service.getCollectionProgressSignal(identity, 'p-1');
    expect(res.status).toBe('WORK_AHEAD');
    expect(res.divergence).toBe(-70);
  });

  it('collection signal: INSUFFICIENT_DATA without a contract value', async () => {
    const { service } = build({
      workPackages: [{ id: 'a', code: 'WP', name: 'x', responsibleOwner: null, progressWeight: '1', boqLinks: [{ boqNodeId: 'n1' }] }],
      measurements: [{ boqNodeId: 'n1', quantity: 200, boqNode: { id: 'n1', code: '1', description: 'x', quantity: 1000 } }],
      fp: { actualCost: '0', budgetTotal: null, contractValue: null, receivedRevenue: null },
    });
    const res = await service.getCollectionProgressSignal(identity, 'p-1');
    expect(res.collectedPercent).toBeNull();
    expect(res.status).toBe('INSUFFICIENT_DATA');
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

  it('getDpr: resolves the single report preparedByName', async () => {
    const { service } = build({
      dpr: { id: 'dpr-1', status: 'DRAFT', projectId: 'p-1', preparedBy: 'user-1', measurements: [], attachments: [] },
      users: [{ id: 'user-1', firstName: 'Ahmed', lastName: 'Shirie' }],
    });
    const res = await service.getDpr(identity, 'dpr-1');
    expect(res.preparedByName).toBe('Ahmed Shirie');
  });
});
