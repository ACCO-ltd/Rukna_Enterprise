import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import type { BoqVersioningService } from '../application/boq-versioning.service.js';
import {
  BoqWorkspaceService,
  classifyChange,
} from '../application/boq-workspace.service.js';

/**
 * ADR-029 R-1..R-3 — the R10 workspace read model, compare-to-signed and timeline.
 *
 * DB-FREE: every collaborator (tenancy, repo, versioning) is stubbed, so these assert the
 * server-side shaping in isolation — life-stage, the tier-gated money band, the money-neutral
 * vs value-changing classifier, and the newest-first timeline with tier-gated amounts. The
 * DB-backed invariants live in the sibling `boq-commit` / `boq-contingency-draw` specs.
 */

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const ORG = 'org-r10';
const PROJECT = 'proj-r10';
const BOQ_ID = 'boq-1';

type NodeRole = 'WORK' | 'CONTINGENCY';
type CommercialTreatment = 'IN_CONTRACT' | 'SEPARATE_CHARGE' | 'ABSORBED';

interface NodeFixture {
  id: string;
  versionId: string;
  code: string;
  description: string;
  isLeaf: boolean;
  parentId: string | null;
  depth: number;
  totalAmount: string | null;
  quantity: string | null;
  unitRate: string | null;
  nodeRole: NodeRole;
  commercialTreatment: CommercialTreatment;
  originNodeId: string | null;
  sourceType: 'BASELINE' | 'VARIATION';
}

function leaf(
  versionId: string,
  id: string,
  code: string,
  totalAmount: string | null,
  opts: Partial<NodeFixture> = {},
): NodeFixture {
  return {
    id,
    versionId,
    code,
    description: opts.description ?? code,
    isLeaf: true,
    parentId: opts.parentId ?? null,
    depth: opts.depth ?? 1,
    totalAmount,
    quantity: opts.quantity ?? '1.000',
    unitRate: opts.unitRate ?? totalAmount,
    nodeRole: opts.nodeRole ?? 'WORK',
    commercialTreatment: opts.commercialTreatment ?? 'IN_CONTRACT',
    originNodeId: opts.originNodeId ?? null,
    sourceType: opts.sourceType ?? 'BASELINE',
  };
}

interface VersionFixture {
  id: string;
  boqId: string;
  versionNumber: number;
  status: 'DRAFT' | 'COMMITTED' | 'SNAPSHOT' | 'SUPERSEDED' | 'CANCELLED';
  notes: string | null;
  derivedFromVersionId: string | null;
  preparedBy: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  baselinedAt: Date | null;
  baselinedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function version(
  id: string,
  versionNumber: number,
  status: VersionFixture['status'],
  opts: Partial<VersionFixture> = {},
): VersionFixture {
  const at = opts.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    boqId: BOQ_ID,
    versionNumber,
    status,
    notes: opts.notes ?? null,
    derivedFromVersionId: opts.derivedFromVersionId ?? null,
    preparedBy: opts.preparedBy ?? 'u1',
    submittedBy: opts.submittedBy ?? null,
    submittedAt: opts.submittedAt ?? null,
    baselinedAt: opts.baselinedAt ?? null,
    baselinedBy: opts.baselinedBy ?? null,
    createdBy: opts.createdBy ?? 'u1',
    createdAt: at,
    updatedAt: at,
  };
}

interface BoqFixture {
  id: string;
  projectId: string;
  organizationId: string;
  currency: string;
  originalBaselineVersionId: string | null;
  currentApprovedVersionId: string | null;
  currentDraftVersionId: string | null;
  currentVersionId: string | null;
  committedSnapshotVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  versions: VersionFixture[];
}

/**
 * Builds the workspace service over stubbed collaborators. `nodesByVersion` maps a version id to
 * its nodes; `contract` (optional) is the row `prisma.contract.findFirst` returns.
 */
function buildService(config: {
  boq: BoqFixture | null;
  nodesByVersion: Record<string, NodeFixture[]>;
  contract?: { boqVersionId: string; contractValue: string; baseContractValue: string | null } | null;
  history?: Array<{
    id: string;
    versionId: string;
    nodeId: string | null;
    code: string | null;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE' | 'IMPORT';
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    detail: string | null;
    actorUserId: string;
    createdAt: Date;
  }>;
  actorNames?: Record<string, string>;
}): BoqWorkspaceService {
  const allNodes = Object.values(config.nodesByVersion).flat();

  const prisma = {
    boqNode: {
      findMany: async ({ where }: { where: { versionId: { in: string[] } } }) =>
        allNodes.filter((node) => where.versionId.in.includes(node.versionId)),
    },
    contract: {
      findFirst: async () => config.contract ?? null,
    },
  };

  const tenancy = { getClient: () => prisma } as unknown as TenancyService;

  const repo = {
    findByProject: async () => config.boq,
    findNodesByVersion: async (_p: unknown, versionId: string) =>
      config.nodesByVersion[versionId] ?? [],
    findHistory: async () => config.history ?? [],
    findActorNames: async (_p: unknown, ids: string[]) =>
      new Map(ids.map((id) => [id, config.actorNames?.[id] ?? ''] as const)),
  } as unknown as BoqPrismaRepository;

  const versioning = {
    getBoq: async () => config.boq,
  } as unknown as BoqVersioningService;

  return new BoqWorkspaceService(tenancy, repo, versioning);
}

const marginIdentity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: ORG,
  tenantSlug: 'r10',
  roles: ['admin'],
  permissions: [PERMISSIONS.boqView, PERMISSIONS.boqViewMargin],
};
const costIdentity: RequestIdentity = {
  ...marginIdentity,
  permissions: [PERMISSIONS.boqView, PERMISSIONS.boqViewCost],
};
const operationalIdentity: RequestIdentity = {
  ...marginIdentity,
  permissions: [PERMISSIONS.boqView],
};

// A committed BOQ: operational COMMITTED version v1 (work 1000 + contingency 200 = 1200 in-contract,
// plus a 300 separate charge), plus a frozen snapshot v2 (the as-committed copy, contingency 200).
function committedBoq(): BoqFixture {
  return {
    id: BOQ_ID,
    projectId: PROJECT,
    organizationId: ORG,
    currency: 'USD',
    originalBaselineVersionId: 'v1',
    currentApprovedVersionId: 'v1',
    currentDraftVersionId: null,
    currentVersionId: 'v1',
    committedSnapshotVersionId: 'v2',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    versions: [
      version('v2', 2, 'SNAPSHOT', {
        notes: 'As-committed snapshot of version 1',
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
      }),
      version('v1', 1, 'COMMITTED', {
        baselinedAt: new Date('2026-02-01T10:00:00.000Z'),
        baselinedBy: 'u1',
      }),
    ],
  };
}

function committedNodes(): Record<string, NodeFixture[]> {
  return {
    v1: [
      leaf('v1', 'n-work', '01.001', '1000.00'),
      leaf('v1', 'n-cont', '01.002', '200.00', { nodeRole: 'CONTINGENCY' }),
      leaf('v1', 'n-sep', '01.003', '300.00', { commercialTreatment: 'SEPARATE_CHARGE' }),
    ],
    v2: [
      leaf('v2', 'n-work-s', '01.001', '1000.00', { originNodeId: 'n-work' }),
      leaf('v2', 'n-cont-s', '01.002', '200.00', {
        nodeRole: 'CONTINGENCY',
        originNodeId: 'n-cont',
      }),
      leaf('v2', 'n-sep-s', '01.003', '300.00', {
        commercialTreatment: 'SEPARATE_CHARGE',
        originNodeId: 'n-sep',
      }),
    ],
  };
}

// ─── R-1: life-stage ───────────────────────────────────────────────────────────

describe('R-1 life-stage', () => {
  it('reads WORKING while the operational version is a pre-commit DRAFT', async () => {
    const boq: BoqFixture = {
      ...committedBoq(),
      currentVersionId: 'v1',
      committedSnapshotVersionId: null,
      versions: [version('v1', 1, 'DRAFT')],
    };
    const svc = buildService({
      boq,
      nodesByVersion: { v1: [leaf('v1', 'n1', '01.001', '1000.00')] },
    });

    const result = await svc.getWorkspace(marginIdentity, PROJECT);

    expect(result.moneyBand?.lifeStage).toBe('WORKING');
    expect(result.compareToSignedAvailable).toBe(false);
  });

  it('reads COMMITTED once the operational version is committed', async () => {
    const svc = buildService({ boq: committedBoq(), nodesByVersion: committedNodes() });

    const result = await svc.getWorkspace(marginIdentity, PROJECT);

    expect(result.moneyBand?.lifeStage).toBe('COMMITTED');
    expect(result.compareToSignedAvailable).toBe(true);
  });
});

// ─── R-1: money band tiers ───────────────────────────────────────────────────────

describe('R-1 money band tier gating', () => {
  const contract = { boqVersionId: 'v1', contractValue: '1200.00', baseContractValue: '1200.00' };

  it('withholds every money figure from an operational-tier caller (view:boq only)', async () => {
    const svc = buildService({ boq: committedBoq(), nodesByVersion: committedNodes(), contract });

    const band = (await svc.getWorkspace(operationalIdentity, PROJECT)).moneyBand!;

    // Life-stage + currency are structural, never gated.
    expect(band.lifeStage).toBe('COMMITTED');
    expect(band.currency).toBe('USD');
    // Every figure omitted.
    expect(band.inContractTotal).toBeNull();
    expect(band.separateChargeTotal).toBeNull();
    expect(band.baseContractValue).toBeNull();
    expect(band.contractValue).toBeNull();
    expect(band.contingencyReserve).toBeNull();
    expect(band.contingencyRemaining).toBeNull();
    expect(band.totalClientRevenue).toBeNull();
  });

  it('shows cost figures but not margin figures to a cost-tier caller', async () => {
    const svc = buildService({ boq: committedBoq(), nodesByVersion: committedNodes(), contract });

    const band = (await svc.getWorkspace(costIdentity, PROJECT)).moneyBand!;

    // Cost tier: the BOQ tie-out figures are present…
    expect(band.inContractTotal).toBe('1200.00'); // 1000 work + 200 contingency
    expect(band.separateChargeTotal).toBe('300.00');
    // …but the margin figures (contract value, contingency, revenue) stay withheld.
    expect(band.baseContractValue).toBeNull();
    expect(band.contractValue).toBeNull();
    expect(band.contingencyReserve).toBeNull();
    expect(band.contingencyRemaining).toBeNull();
    expect(band.totalClientRevenue).toBeNull();
  });

  it('shows every figure to a margin-tier caller', async () => {
    const svc = buildService({ boq: committedBoq(), nodesByVersion: committedNodes(), contract });

    const band = (await svc.getWorkspace(marginIdentity, PROJECT)).moneyBand!;

    expect(band.inContractTotal).toBe('1200.00');
    expect(band.separateChargeTotal).toBe('300.00');
    expect(band.baseContractValue).toBe('1200.00');
    expect(band.contractValue).toBe('1200.00');
    expect(band.contingencyReserve).toBe('200.00');
    expect(band.contingencyRemaining).toBe('200.00');
    // total client revenue = current contract value 1200 + separate charge 300
    expect(band.totalClientRevenue).toBe('1500.00');
  });

  it('reflects a drawn-down contingency: reserve (frozen snapshot) stays, remaining ticks down', async () => {
    // Live v1 has had 50 drawn from contingency onto work (total held at 1200); the snapshot is frozen.
    const nodes = committedNodes();
    nodes.v1 = [
      leaf('v1', 'n-work', '01.001', '1050.00'),
      leaf('v1', 'n-cont', '01.002', '150.00', { nodeRole: 'CONTINGENCY' }),
      leaf('v1', 'n-sep', '01.003', '300.00', { commercialTreatment: 'SEPARATE_CHARGE' }),
    ];
    const svc = buildService({ boq: committedBoq(), nodesByVersion: nodes, contract });

    const band = (await svc.getWorkspace(marginIdentity, PROJECT)).moneyBand!;

    expect(band.contingencyReserve).toBe('200.00'); // frozen snapshot allowance
    expect(band.contingencyRemaining).toBe('150.00'); // live, after the draw
    expect(band.inContractTotal).toBe('1200.00'); // held constant by the reallocation
  });

  it('leaves contract-sourced figures null when there is no contract yet (WORKING)', async () => {
    const boq: BoqFixture = {
      ...committedBoq(),
      committedSnapshotVersionId: null,
      versions: [version('v1', 1, 'DRAFT')],
    };
    const svc = buildService({
      boq,
      nodesByVersion: { v1: [leaf('v1', 'n1', '01.001', '1000.00')] },
      contract: null,
    });

    const band = (await svc.getWorkspace(marginIdentity, PROJECT)).moneyBand!;

    expect(band.inContractTotal).toBe('1000.00'); // BOQ figure exists pre-commit
    expect(band.baseContractValue).toBeNull();
    expect(band.contractValue).toBeNull();
    expect(band.totalClientRevenue).toBeNull(); // no current value to add separate charges to
  });
});

// ─── R-2: classifier (pure) ──────────────────────────────────────────────────────

describe('R-2 classifyChange', () => {
  const base = {
    leftNodeId: 'l',
    rightNodeId: 'r',
    code: '01.001',
    description: 'x',
    isLeaf: true,
    oldQuantity: null,
    newQuantity: null,
    oldUnitRate: null,
    newUnitRate: null,
    oldAmount: null,
    newAmount: null,
    amountDelta: null,
    amountDeltaPercent: null,
  };

  it('classes added / removed scope as value-changing', () => {
    expect(classifyChange({ ...base, kinds: ['ADDED'] }, true)).toBe('VALUE_CHANGING');
    expect(classifyChange({ ...base, kinds: ['REMOVED'] }, false)).toBe('VALUE_CHANGING');
  });

  it('classes a pure description / reorder edit as money-neutral', () => {
    expect(classifyChange({ ...base, kinds: ['DESCRIPTION_CHANGED'] }, true)).toBe('MONEY_NEUTRAL');
    expect(classifyChange({ ...base, kinds: ['MOVED'] }, true)).toBe('MONEY_NEUTRAL');
  });

  it('classes an amount move as value-changing only when the net in-contract total moved', () => {
    // rate change that moved the total → value-changing
    expect(classifyChange({ ...base, kinds: ['RATE_CHANGED', 'AMOUNT_CHANGED'] }, true)).toBe(
      'VALUE_CHANGING',
    );
    // reallocation: each line's amount moved but the net total held → money-neutral
    expect(classifyChange({ ...base, kinds: ['AMOUNT_CHANGED'] }, false)).toBe('MONEY_NEUTRAL');
  });
});

// ─── R-2: compare-to-signed ──────────────────────────────────────────────────────

describe('R-2 compare-to-signed', () => {
  it('returns an empty, non-error result when nothing is committed yet', async () => {
    const boq: BoqFixture = {
      ...committedBoq(),
      committedSnapshotVersionId: null,
      versions: [version('v1', 1, 'DRAFT')],
    };
    const svc = buildService({ boq, nodesByVersion: { v1: [] } });

    const result = await svc.compareToSigned(marginIdentity, PROJECT);

    expect(result.available).toBe(false);
    expect(result.changes).toHaveLength(0);
    expect(result.signedVersionId).toBeNull();
  });

  it('classifies a rate change that moved the total as value-changing', async () => {
    const nodes = committedNodes();
    // live work rate rose 1000 → 1100 (in-contract total 1200 → 1300)
    nodes.v1 = [
      leaf('v1', 'n-work', '01.001', '1100.00', { originNodeId: 'n-work' }),
      leaf('v1', 'n-cont', '01.002', '200.00', { nodeRole: 'CONTINGENCY', originNodeId: 'n-cont' }),
      leaf('v1', 'n-sep', '01.003', '300.00', {
        commercialTreatment: 'SEPARATE_CHARGE',
        originNodeId: 'n-sep',
      }),
    ];
    const svc = buildService({ boq: committedBoq(), nodesByVersion: nodes });

    const result = await svc.compareToSigned(marginIdentity, PROJECT);

    expect(result.available).toBe(true);
    expect(result.valueChangingCount).toBe(1);
    expect(result.moneyNeutralCount).toBe(0);
    expect(result.inContractDelta).toBe('100.00');
    expect(result.changes[0]!.changeClass).toBe('VALUE_CHANGING');
  });

  it('classifies a description-only edit as money-neutral', async () => {
    const nodes = committedNodes();
    nodes.v1 = [
      leaf('v1', 'n-work', '01.001', '1000.00', {
        originNodeId: 'n-work',
        description: 'Concrete (renamed)',
      }),
      leaf('v1', 'n-cont', '01.002', '200.00', { nodeRole: 'CONTINGENCY', originNodeId: 'n-cont' }),
      leaf('v1', 'n-sep', '01.003', '300.00', {
        commercialTreatment: 'SEPARATE_CHARGE',
        originNodeId: 'n-sep',
      }),
    ];
    const svc = buildService({ boq: committedBoq(), nodesByVersion: nodes });

    const result = await svc.compareToSigned(marginIdentity, PROJECT);

    expect(result.valueChangingCount).toBe(0);
    expect(result.moneyNeutralCount).toBe(1);
    expect(result.changes[0]!.changeClass).toBe('MONEY_NEUTRAL');
  });

  it('classifies a contingency reallocation (net-zero total) as money-neutral', async () => {
    const nodes = committedNodes();
    // 50 drawn from contingency onto work: both lines' amounts move, total held at 1200.
    nodes.v1 = [
      leaf('v1', 'n-work', '01.001', '1050.00', { originNodeId: 'n-work' }),
      leaf('v1', 'n-cont', '01.002', '150.00', { nodeRole: 'CONTINGENCY', originNodeId: 'n-cont' }),
      leaf('v1', 'n-sep', '01.003', '300.00', {
        commercialTreatment: 'SEPARATE_CHARGE',
        originNodeId: 'n-sep',
      }),
    ];
    const svc = buildService({ boq: committedBoq(), nodesByVersion: nodes });

    const result = await svc.compareToSigned(marginIdentity, PROJECT);

    expect(result.inContractDelta).toBe('0.00');
    expect(result.valueChangingCount).toBe(0);
    expect(result.moneyNeutralCount).toBe(2); // both moved lines
  });

  it('withholds the money fields on changes from a cost-restricted caller', async () => {
    const nodes = committedNodes();
    nodes.v1 = [
      leaf('v1', 'n-work', '01.001', '1100.00', { originNodeId: 'n-work' }),
      leaf('v1', 'n-cont', '01.002', '200.00', { nodeRole: 'CONTINGENCY', originNodeId: 'n-cont' }),
      leaf('v1', 'n-sep', '01.003', '300.00', {
        commercialTreatment: 'SEPARATE_CHARGE',
        originNodeId: 'n-sep',
      }),
    ];
    const svc = buildService({ boq: committedBoq(), nodesByVersion: nodes });

    const result = await svc.compareToSigned(operationalIdentity, PROJECT);

    expect(result.liveInContractTotal).toBeNull();
    expect(result.inContractDelta).toBeNull();
    // The structural class survives redaction; the money on the change does not.
    expect(result.changes[0]!.changeClass).toBe('VALUE_CHANGING');
    expect(result.changes[0]!.newAmount).toBeNull();
    expect(result.changes[0]!.amountDelta).toBeNull();
  });
});

// ─── R-3: timeline ───────────────────────────────────────────────────────────────

describe('R-3 timeline', () => {
  it('lists commit + variation snapshot + change events, newest-first, with names resolved', async () => {
    const boq = committedBoq();
    // Add a variation-adopt snapshot v3, newer than the commit.
    boq.versions = [
      version('v3', 3, 'SNAPSHOT', {
        notes: 'As-committed snapshot after variation VO-003',
        createdBy: 'u2',
        createdAt: new Date('2026-03-01T09:00:00.000Z'),
      }),
      ...boq.versions,
    ];
    boq.committedSnapshotVersionId = 'v3';

    const svc = buildService({
      boq,
      nodesByVersion: committedNodes(),
      history: [
        {
          id: 'e1',
          versionId: 'v1',
          nodeId: 'n-work',
          code: '01.001',
          action: 'UPDATE',
          field: 'totalAmount',
          oldValue: '1000.00',
          newValue: '1100.00',
          detail: null,
          actorUserId: 'u1',
          createdAt: new Date('2026-04-01T12:00:00.000Z'),
        },
      ],
      actorNames: { u1: 'Alice A', u2: 'Bob B' },
    });

    const result = await svc.timeline(marginIdentity, PROJECT);

    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds).toContain('COMMITTED');
    expect(kinds).toContain('VARIATION_SNAPSHOT');
    expect(kinds).toContain('CHANGE_EVENT');

    // Newest first: the Apr change event leads, then the Mar variation, then the Feb commit.
    expect(result.entries[0]!.kind).toBe('CHANGE_EVENT');
    expect(result.entries[0]!.occurredAt).toBe('2026-04-01T12:00:00.000Z');
    expect(result.entries[result.entries.length - 1]!.kind).toBe('COMMITTED');

    const variation = result.entries.find((e) => e.kind === 'VARIATION_SNAPSHOT')!;
    expect(variation.label).toContain('VO-003');
    expect(variation.actorName).toBe('Bob B');

    // The change event's amount is the line delta, visible at the cost/margin tier.
    const change = result.entries.find((e) => e.kind === 'CHANGE_EVENT')!;
    expect(change.amount).toBe('100.00');
    expect(change.actorName).toBe('Alice A');
  });

  it('withholds change-event amounts from an operational-tier caller', async () => {
    const svc = buildService({
      boq: committedBoq(),
      nodesByVersion: committedNodes(),
      history: [
        {
          id: 'e1',
          versionId: 'v1',
          nodeId: 'n-work',
          code: '01.001',
          action: 'UPDATE',
          field: 'totalAmount',
          oldValue: '1000.00',
          newValue: '1100.00',
          detail: null,
          actorUserId: 'u1',
          createdAt: new Date('2026-04-01T12:00:00.000Z'),
        },
      ],
      actorNames: { u1: 'Alice A' },
    });

    const result = await svc.timeline(operationalIdentity, PROJECT);

    const change = result.entries.find((e) => e.kind === 'CHANGE_EVENT')!;
    expect(change.amount).toBeNull();
  });
});
