import type {
  ProgressCurveResponse,
  ProgrammeBaselineResponse,
  ProgrammeMilestoneResponse,
  ProjectRollupResponse,
} from '@erp/types';

import {
  composeMasterScheduleReportModel,
  type ComposeMasterScheduleInput,
  type ProjectHeaderInput,
} from './master-schedule-report.model.js';

/**
 * Master Schedule P4 (ADR-029) — the report-model composition. Pure: it projects the existing read
 * models (rollup / curve / baseline / milestones + header) into a render-ready model. The tests prove
 * it pulls from each source and degrades gracefully when there is no frozen baseline.
 */

const header: ProjectHeaderInput = {
  projectCode: 'ACCO-WBR-26-0062',
  projectName: 'Office Building',
  clientName: 'Banaadir Municipality',
  projectStartDate: '2026-06-01',
  projectExpectedEndDate: '2026-12-31',
  organizationName: 'ACCO',
  organizationLogoUrl: null,
};

const rollup: ProjectRollupResponse = {
  projectId: 'p1',
  physicalPercent: 42.5,
  weightsTotal: '1',
  weightsComplete: true,
  packages: [
    {
      id: 'wp1',
      code: 'WP-01',
      name: 'Mobilization',
      responsibleOwner: null,
      weight: '0',
      percentComplete: null,
      leafCount: 0,
      plannedStart: '2026-06-01',
      plannedEnd: '2026-06-15',
      durationDays: 14,
      forecastEnd: null,
      scheduleOnly: true,
      actualStart: null,
      actualFinish: null,
      scheduleStatus: 'ON_TRACK',
    },
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

const curveWithBaseline: ProgressCurveResponse = {
  projectId: 'p1',
  baseline: [
    { periodEndDate: '2026-06-30', plannedPercent: 15 },
    { periodEndDate: '2026-09-30', plannedPercent: 60 },
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
  baselineVersion: 2,
};

const baseline: ProgrammeBaselineResponse = {
  id: 'b1',
  projectId: 'p1',
  version: 2,
  status: 'APPROVED',
  approvedBy: 'u-pm',
  approvedAt: '2026-09-10T08:00:00.000Z',
  variationOrderId: 'vo1',
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
    name: 'Blockwork, Plaster & MEP First Fix',
    status: 'PLANNED',
    baselineDate: '2026-10-31',
    forecastDate: '2026-11-05',
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

function baseInput(over: Partial<ComposeMasterScheduleInput> = {}): ComposeMasterScheduleInput {
  return {
    header,
    rollup,
    curve: curveWithBaseline,
    baseline,
    milestones,
    asOf: '2026-09-10',
    ...over,
  };
}

describe('composeMasterScheduleReportModel', () => {
  it('pulls the header from the project/org read', () => {
    const model = composeMasterScheduleReportModel(baseInput());
    expect(model.header.projectCode).toBe('ACCO-WBR-26-0062');
    expect(model.header.projectName).toBe('Office Building');
    expect(model.header.clientName).toBe('Banaadir Municipality');
    expect(model.header.organizationName).toBe('ACCO');
    expect(model.header.organizationLogoUrl).toBeNull();
    expect(model.header.asOf).toBe('2026-09-10');
  });

  it('pulls the phase table + physical % from the rollup', () => {
    const model = composeMasterScheduleReportModel(baseInput());
    expect(model.physicalPercent).toBe(42.5);
    expect(model.weightsComplete).toBe(true);
    expect(model.phases).toHaveLength(2);
    expect(model.phases[0]).toMatchObject({ code: 'WP-01', scheduleOnly: true, percentComplete: null });
    expect(model.phases[1]).toMatchObject({
      code: 'WP-02',
      percentComplete: 70,
      scheduleStatus: 'BEHIND',
      actualStart: '2026-06-20',
    });
  });

  it('pulls milestones + releases and formats %/amount labels', () => {
    const model = composeMasterScheduleReportModel(baseInput());
    expect(model.milestones).toHaveLength(1);
    const ms = model.milestones[0];
    expect(ms.name).toBe('Blockwork, Plaster & MEP First Fix');
    expect(ms.status).toBe('PLANNED');
    expect(ms.releases).toHaveLength(1);
    expect(ms.releases[0]).toMatchObject({
      name: '30% Partition & Plastering',
      percentLabel: '30%',
      amountLabel: 'USD 150,000.00',
      invoiced: false,
    });
  });

  it('builds the S-curve from the curve point arrays (planned + actual), sorted, with a shared domain', () => {
    const model = composeMasterScheduleReportModel(baseInput());
    expect(model.sCurve.planned).toHaveLength(3);
    expect(model.sCurve.actual).toHaveLength(2);
    // Domain spans both series: earliest planned/actual (2026-06-30) to latest (2026-12-31).
    expect(model.sCurve.domainLabels).toEqual({ min: '2026-06-30', max: '2026-12-31' });
    // Points carry percent as the y value straight from the arrays (no re-interpolation).
    expect(model.sCurve.planned.map((p) => p.percent)).toEqual([15, 60, 100]);
    expect(model.sCurve.actual.map((p) => p.percent)).toEqual([10, 42.5]);
  });

  it('labels a frozen baseline "Baseline v{N}, approved {date}"', () => {
    const model = composeMasterScheduleReportModel(baseInput());
    expect(model.baselineStatus.source).toBe('baseline');
    expect(model.baselineStatus.version).toBe(2);
    expect(model.baselineStatus.label).toBe('Baseline v2, approved 2026-09-10');
    expect(model.baselineStatus.approvedBy).toBe('u-pm');
  });

  it('degrades gracefully when there is NO governing baseline (null) — provisional label, no throw', () => {
    const provisionalCurve: ProgressCurveResponse = {
      ...curveWithBaseline,
      baseline: [],
      baselineProvisional: true,
      baselineSource: 'provisional',
      baselineVersion: null,
    };
    const model = composeMasterScheduleReportModel(
      baseInput({ baseline: null, curve: provisionalCurve }),
    );
    expect(model.baselineStatus.source).toBe('provisional');
    expect(model.baselineStatus.version).toBeNull();
    expect(model.baselineStatus.label).toBe('Provisional / draft plan');
    // Everything else still renders.
    expect(model.phases).toHaveLength(2);
    expect(model.milestones).toHaveLength(1);
  });

  it('labels an unfrozen live-targets curve as provisional (targets), not a baseline', () => {
    const targetsCurve: ProgressCurveResponse = {
      ...curveWithBaseline,
      baselineSource: 'targets',
      baselineVersion: null,
      baselineProvisional: false,
    };
    const model = composeMasterScheduleReportModel(baseInput({ baseline: null, curve: targetsCurve }));
    expect(model.baselineStatus.source).toBe('targets');
    expect(model.baselineStatus.label).toBe('Provisional plan (unfrozen targets)');
  });

  it('never claims a baseline the curve did not resolve from (baseline present but curve source=targets)', () => {
    // Defensive: a stale/superseded baseline row must not override the curve's honest source.
    const targetsCurve: ProgressCurveResponse = {
      ...curveWithBaseline,
      baselineSource: 'targets',
      baselineVersion: null,
    };
    const model = composeMasterScheduleReportModel(baseInput({ curve: targetsCurve }));
    expect(model.baselineStatus.source).toBe('targets');
  });

  it('falls back to the org name (empty logo) and renders an empty-but-valid model with no packages/milestones', () => {
    const emptyRollup: ProjectRollupResponse = {
      ...rollup,
      physicalPercent: 0,
      weightsComplete: false,
      packages: [],
    };
    const emptyCurve: ProgressCurveResponse = {
      ...curveWithBaseline,
      baseline: [],
      actual: [],
      baselineSource: 'provisional',
      baselineProvisional: true,
      baselineVersion: null,
    };
    const model = composeMasterScheduleReportModel(
      baseInput({ rollup: emptyRollup, curve: emptyCurve, baseline: null, milestones: [] }),
    );
    expect(model.phases).toEqual([]);
    expect(model.milestones).toEqual([]);
    expect(model.sCurve.domain).toBeNull();
    expect(model.weightsComplete).toBe(false);
  });
});
