import type {
  ProgressCurveResponse,
  ProgrammeBaselineResponse,
  ProgrammeMilestoneResponse,
  ProjectRollupResponse,
} from '@erp/types';

/**
 * `@react-pdf/renderer` ships native ESM whose deep dependency tree (fontkit / pdfkit / yoga-layout …)
 * cannot be parsed by this repo's CommonJS ts-jest transform. A factory mock keeps that ESM tree out
 * of jest entirely: it supplies the primitive component tags the renderer imports and a
 * `renderToBuffer` that returns a real `%PDF` buffer and records the element it was handed. The REAL
 * render is proven empirically by the committed smoke script `scripts/master-schedule-pdf-smoke.mjs`
 * (run in verify), which loads the actual react-pdf renderer via Node.
 */
const renderToBufferMock = jest.fn(
  async (_element: unknown) => Buffer.from('%PDF-1.7\n[mocked render]\n%%EOF\n'),
);
jest.mock('@react-pdf/renderer', () => {
  const tag = (name: string) => name; // react-pdf primitives are string type tags
  return {
    __esModule: true,
    Document: tag('DOCUMENT'),
    Page: tag('PAGE'),
    View: tag('VIEW'),
    Text: tag('TEXT'),
    Image: tag('IMAGE'),
    Svg: tag('SVG'),
    Polyline: tag('POLYLINE'),
    Line: tag('LINE'),
    Rect: tag('RECT'),
    StyleSheet: { create: (styles: unknown) => styles },
    renderToBuffer: renderToBufferMock,
  };
});

import { MasterSchedulePdfService } from './master-schedule-pdf.service.js';

/**
 * Master Schedule P4 (ADR-029) — the PDF service. It composes the model from the injected read models
 * and renders a PDF Buffer in-process (react-pdf, no browser). These tests prove:
 *  - it fans out to each read model (rollup / curve / baseline / milestones + project header),
 *  - it degrades when there is no governing baseline (getGoverning → null; no throw),
 *  - the render pipes react-pdf's Buffer straight through (first bytes are the `%PDF` magic number),
 *  - it hands the renderer a real React element tree,
 *  - the filename is projectCode + asOf, sanitized.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

const rollup: ProjectRollupResponse = {
  projectId: 'p1',
  physicalPercent: 42.5,
  weightsTotal: '1',
  weightsComplete: true,
  packages: [
    {
      id: 'wp2',
      code: 'WP-02',
      name: 'Structure',
      responsibleOwner: 'Eng A',
      weight: '0.6',
      percentComplete: 70,
      leafCount: 5,
      plannedStart: '2026-06-16',
      plannedEnd: '2026-09-30',
      durationDays: 106,
      forecastEnd: null,
      scheduleOnly: false,
      actualStart: '2026-06-20',
      actualFinish: null,
      scheduleStatus: 'BEHIND',
    },
  ],
};

const curve: ProgressCurveResponse = {
  projectId: 'p1',
  baseline: [
    { periodEndDate: '2026-06-30', plannedPercent: 15 },
    { periodEndDate: '2026-12-31', plannedPercent: 100 },
  ],
  actual: [
    { periodEndDate: '2026-06-30', physicalPercent: 10, verifiedPercent: 10, costPercent: 8 },
    { periodEndDate: '2026-08-31', physicalPercent: 42.5, verifiedPercent: 40, costPercent: 45 },
  ],
  scheduleVariancePercent: -5,
  status: 'ON_TRACK',
  baselineProvisional: false,
  baselineSource: 'baseline',
  baselineVersion: 1,
};

const baseline: ProgrammeBaselineResponse = {
  id: 'b1',
  projectId: 'p1',
  version: 1,
  status: 'APPROVED',
  approvedBy: 'u-pm',
  approvedAt: '2026-09-10T08:00:00.000Z',
  variationOrderId: null,
  note: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  points: [
    { targetDate: '2026-06-30', cumulativePercent: 15 },
    { targetDate: '2026-12-31', cumulativePercent: 100 },
  ],
};

const milestones: ProgrammeMilestoneResponse[] = [
  {
    id: 'm1',
    projectId: 'p1',
    code: 'MS-01',
    name: 'Structure Complete',
    status: 'PLANNED',
    baselineDate: '2026-09-30',
    forecastDate: null,
    actualDate: null,
    sortOrder: 0,
    contractDeliverableId: null,
    verifiedBy: null,
    verifiedAt: null,
    releases: [
      {
        installmentId: 'i1',
        name: '30% Partition & Plastering',
        percentage: '0.3000',
        triggerType: 'MILESTONE',
        amount: '150000.00',
        currency: 'USD',
        invoiced: false,
      },
    ],
  },
];

const projectHeaderRow = {
  code: 'ACCO-WBR-26-0062',
  name: 'Office Building',
  clientName: null,
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  expectedEndDate: new Date('2026-12-31T00:00:00.000Z'),
  client: { name: 'Banaadir Municipality' },
  organization: { name: 'ACCO', logoUrl: null as string | null },
};

function build(
  over: {
    baseline?: ProgrammeBaselineResponse | null;
    logoUrl?: string | null;
    clientRelation?: { name: string } | null;
    clientName?: string | null;
  } = {},
) {
  const assertMember = jest.fn().mockResolvedValue(undefined);
  const projectAccess = { assertMember } as never;

  const tenancy = { getClient: () => ({}) } as never;

  const header = {
    ...projectHeaderRow,
    clientName: over.clientName === undefined ? projectHeaderRow.clientName : over.clientName,
    client: over.clientRelation === undefined ? projectHeaderRow.client : over.clientRelation,
    organization: { name: 'ACCO', logoUrl: over.logoUrl ?? null },
  };
  const repo = {
    findProjectHeader: jest.fn().mockResolvedValue(header),
  } as never;

  const progress = {
    getRollup: jest.fn().mockResolvedValue(rollup),
    getCurve: jest.fn().mockResolvedValue(curve),
  } as never;
  const baselineService = {
    getGoverning: jest
      .fn()
      .mockResolvedValue(over.baseline === undefined ? baseline : over.baseline),
  } as never;
  const programme = {
    listMilestones: jest.fn().mockResolvedValue(milestones),
  } as never;

  const service = new MasterSchedulePdfService(
    tenancy,
    repo,
    projectAccess,
    progress,
    baselineService,
    programme,
  );
  return { service, assertMember, repo, progress, baselineService, programme };
}

describe('MasterSchedulePdfService', () => {
  describe('composeModel', () => {
    it('asserts membership and fans out to every read model', async () => {
      const { service, assertMember, progress, baselineService, programme } = build();
      const model = await service.composeModel(identity, 'p1', '2026-09-10');

      expect(assertMember).toHaveBeenCalledWith(identity, 'p1');
      expect((progress as { getRollup: jest.Mock }).getRollup).toHaveBeenCalledWith(
        identity,
        'p1',
        '2026-09-10',
      );
      expect((progress as { getCurve: jest.Mock }).getCurve).toHaveBeenCalledWith(identity, 'p1');
      expect((baselineService as { getGoverning: jest.Mock }).getGoverning).toHaveBeenCalledWith(
        identity,
        'p1',
      );
      expect((programme as { listMilestones: jest.Mock }).listMilestones).toHaveBeenCalledWith(
        identity,
        'p1',
      );

      expect(model.header.projectCode).toBe('ACCO-WBR-26-0062');
      expect(model.header.clientName).toBe('Banaadir Municipality'); // resolved from the linked client
      expect(model.phases).toHaveLength(1);
      expect(model.milestones).toHaveLength(1);
      expect(model.baselineStatus.label).toBe('Baseline v1, approved 2026-09-10');
    });

    it('prefers the free-text clientName when there is no linked client', async () => {
      const { service } = build({ clientRelation: null, clientName: 'Walk-in Client' });
      const model = await service.composeModel(identity, 'p1', '2026-09-10');
      expect(model.header.clientName).toBe('Walk-in Client');
    });

    it('degrades to a provisional label when getGoverning returns null (no throw)', async () => {
      const provisionalCurve: ProgressCurveResponse = {
        ...curve,
        baseline: [],
        baselineSource: 'provisional',
        baselineProvisional: true,
        baselineVersion: null,
      };
      const { service, progress } = build({ baseline: null });
      (progress as { getCurve: jest.Mock }).getCurve.mockResolvedValue(provisionalCurve);

      const model = await service.composeModel(identity, 'p1', '2026-09-10');
      expect(model.baselineStatus.source).toBe('provisional');
      expect(model.baselineStatus.label).toBe('Provisional / draft plan');
    });
  });

  describe('generate (render pipeline)', () => {
    beforeEach(() => renderToBufferMock.mockClear());

    it('returns a non-empty PDF Buffer starting with the %PDF magic bytes', async () => {
      const { service } = build();
      const { buffer } = await service.generate(identity, 'p1', '2026-09-10');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('hands the renderer a real React element tree (a Document element)', async () => {
      const { service } = build();
      await service.generate(identity, 'p1', '2026-09-10');
      expect(renderToBufferMock).toHaveBeenCalledTimes(1);
      const element = renderToBufferMock.mock.calls[0][0] as { type?: unknown; props?: unknown };
      expect(element).toBeDefined();
      // The top of the tree is the mocked Document primitive tag, with a project-scoped title prop.
      expect(element.type).toBe('DOCUMENT');
      expect(element.props).toBeTruthy();
    });

    it('renders without a frozen baseline (provisional) — still emits %PDF', async () => {
      const provisionalCurve: ProgressCurveResponse = {
        ...curve,
        baseline: [],
        actual: [],
        baselineSource: 'provisional',
        baselineProvisional: true,
        baselineVersion: null,
      };
      const { service, progress } = build({ baseline: null });
      (progress as { getCurve: jest.Mock }).getCurve.mockResolvedValue(provisionalCurve);

      const { buffer } = await service.generate(identity, 'p1');
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('names the file master-schedule-<code>-<asOf>.pdf (code sanitized)', async () => {
      const { service } = build();
      const { filename, projectCode, asOf } = await service.generate(identity, 'p1', '2026-09-10');
      expect(projectCode).toBe('ACCO-WBR-26-0062');
      expect(asOf).toBe('2026-09-10');
      expect(filename).toBe('master-schedule-ACCO-WBR-26-0062-2026-09-10.pdf');
    });
  });
});
