import type {
  ProgressCurveResponse,
  ProgrammeBaselineResponse,
  ProgrammeMilestoneResponse,
  ProjectRollupResponse,
  ProgressScheduleStatus,
} from '@erp/types';

/**
 * Master Schedule P4 (ADR-029) — the composed report model for the branded PDF.
 *
 * This is a *composition* of the existing read models, not a new aggregated DB query: the service
 * fetches `getRollup` (per-phase schedule table), `getGoverning` (frozen baseline — may be null),
 * `getCurve` (the plan-vs-actual S-curve point arrays + baselineSource) and `listMilestones`
 * (milestones + the payment stages each releases), plus the project/org header, and this pure
 * function shapes them into a single, render-ready model. Kept pure so it is unit-testable without a
 * database or a PDF renderer.
 *
 * Graceful degradation is the whole point of the "planned" section: a project with no APPROVED
 * `ProgrammeBaseline` yet still produces a valid report — the header reads "Provisional / draft plan"
 * and the curve is sourced from the live targets or the provisional ramp (`getCurve.baselineSource`),
 * exactly as the S-curve read model already reports.
 */

/** The org + project identity shown in the PDF header. */
export interface MasterScheduleHeader {
  /** The org logo asset URL, or null → the PDF falls back to `organizationName` as text. */
  organizationLogoUrl: string | null;
  organizationName: string;
  projectCode: string;
  projectName: string;
  /** Resolved client name (linked Client.name, else the free-text clientName), or null. */
  clientName: string | null;
  /** ISO calendar dates (YYYY-MM-DD) or null. */
  projectStartDate: string | null;
  projectExpectedEndDate: string | null;
  /** The date the report was generated (ISO calendar date). */
  asOf: string;
}

/**
 * How the planned curve was resolved, phrased for the header line:
 *  - `baseline` → "Baseline v{N}, approved {date}"
 *  - `targets`  → "Provisional plan (unfrozen targets)"
 *  - `provisional` → "Provisional / draft plan"
 */
export interface MasterScheduleBaselineStatus {
  source: ProgressCurveResponse['baselineSource'];
  /** The governing baseline version, or null when no frozen baseline exists. */
  version: number | null;
  /** ISO timestamp the baseline was approved, or null when none. */
  approvedAt: string | null;
  approvedBy: string | null;
  /** A ready-to-print single line, e.g. "Baseline v2, approved 2026-09-10" / "Provisional / draft plan". */
  label: string;
}

/** One phase row of the activity/schedule table (mirrors the getRollup package line). */
export interface MasterSchedulePhaseRow {
  code: string;
  name: string;
  durationDays: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  /** Value-weighted derived %, null for a schedule-only (non-measurable) phase. */
  percentComplete: number | null;
  scheduleStatus: ProgressScheduleStatus;
  scheduleOnly: boolean;
}

/** One (x,y) point of the S-curve, already in draw units: percent (0..100) at a day-grained date. */
export interface SCurvePoint {
  /** Epoch milliseconds of the point's date — the x scale is linear over the project date range. */
  timeMs: number;
  /** Cumulative percent 0..100 — the y scale. */
  percent: number;
}

/** The two polylines of the S-curve plus the x-domain used to scale them. */
export interface MasterScheduleSCurve {
  planned: SCurvePoint[];
  actual: SCurvePoint[];
  /** The x-axis domain (epoch ms) spanning both series; null when there is nothing to draw. */
  domain: { minMs: number; maxMs: number } | null;
  /** Human labels for the x-axis endpoints (ISO calendar dates), null when no domain. */
  domainLabels: { min: string; max: string } | null;
}

/** One payment stage a milestone releases (from ProgrammeMilestoneResponse.releases). */
export interface MasterScheduleReleaseLine {
  name: string;
  /** Percentage as a display string, e.g. "40%". */
  percentLabel: string;
  /** Money amount + currency, e.g. "USD 100,000.00". */
  amountLabel: string;
  invoiced: boolean;
}

/** One milestone row + the payment stage(s) it releases. */
export interface MasterScheduleMilestoneRow {
  code: string;
  name: string;
  status: ProgrammeMilestoneResponse['status'];
  baselineDate: string;
  forecastDate: string | null;
  actualDate: string | null;
  releases: MasterScheduleReleaseLine[];
}

/** The full render-ready report model. */
export interface MasterScheduleReportModel {
  header: MasterScheduleHeader;
  baselineStatus: MasterScheduleBaselineStatus;
  phases: MasterSchedulePhaseRow[];
  /** Weighted project physical % (0..100). */
  physicalPercent: number;
  /** True when the phase weights total 100% — surfaced so an incomplete plan is not read as fact. */
  weightsComplete: boolean;
  sCurve: MasterScheduleSCurve;
  milestones: MasterScheduleMilestoneRow[];
}

/** The project/org identity the composer needs — read once by the service (Prisma stays in the repo). */
export interface ProjectHeaderInput {
  projectCode: string;
  projectName: string;
  clientName: string | null;
  projectStartDate: string | null;
  projectExpectedEndDate: string | null;
  organizationName: string;
  organizationLogoUrl: string | null;
}

export interface ComposeMasterScheduleInput {
  header: ProjectHeaderInput;
  rollup: ProjectRollupResponse;
  curve: ProgressCurveResponse;
  /** The governing frozen baseline, or null when none is approved yet (degrade to provisional). */
  baseline: ProgrammeBaselineResponse | null;
  milestones: ProgrammeMilestoneResponse[];
  /** The generation date (ISO calendar date), injected so the output is deterministic in tests. */
  asOf: string;
}

/** A `percentage` fraction string ("0.4000") → a display "40%". Falls back to the raw string. */
function toPercentLabel(fraction: string): string {
  const n = Number(fraction);
  if (Number.isNaN(n)) return fraction;
  // 0.4 → "40%", 0.075 → "7.5%". Trim trailing zeros.
  const pct = n * 100;
  return `${Number(pct.toFixed(2))}%`;
}

/** "100000.00" + "USD" → "USD 100,000.00" (thousands-grouped, 2dp). */
function toAmountLabel(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${currency} ${amount}`;
  const grouped = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${grouped}`;
}

/** Compose the baseline status line from the frozen baseline (if any) and the curve's source. */
function composeBaselineStatus(
  baseline: ProgrammeBaselineResponse | null,
  curve: ProgressCurveResponse,
): MasterScheduleBaselineStatus {
  // The frozen baseline is authoritative when the curve resolved from it. Otherwise the curve's
  // source (targets / provisional) tells the honest story — never claim a baseline that is not frozen.
  if (baseline && curve.baselineSource === 'baseline') {
    const approvedDay = baseline.approvedAt.slice(0, 10);
    return {
      source: 'baseline',
      version: baseline.version,
      approvedAt: baseline.approvedAt,
      approvedBy: baseline.approvedBy,
      label: `Baseline v${baseline.version}, approved ${approvedDay}`,
    };
  }
  if (curve.baselineSource === 'targets') {
    return {
      source: 'targets',
      version: null,
      approvedAt: null,
      approvedBy: null,
      label: 'Provisional plan (unfrozen targets)',
    };
  }
  return {
    source: 'provisional',
    version: null,
    approvedAt: null,
    approvedBy: null,
    label: 'Provisional / draft plan',
  };
}

/** Map a curve point (ISO date + percent) to an S-curve draw point; drops points with an unparseable date. */
function toCurvePoints(
  points: { periodEndDate: string; value: number }[],
): SCurvePoint[] {
  const out: SCurvePoint[] = [];
  for (const p of points) {
    const ms = new Date(p.periodEndDate).getTime();
    if (Number.isNaN(ms)) continue;
    out.push({ timeMs: ms, percent: p.value });
  }
  // Sort by time so the polyline draws left→right regardless of source ordering.
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Build the S-curve draw model from the curve read model's point arrays. Planned = `baseline`
 * (plannedPercent per date); actual = `actual` (physicalPercent per period). Both are mapped straight
 * from the already-computed arrays — no re-interpolation (the ticket's rule). The x-domain spans both
 * series so the two lines share one horizontal scale; null when nothing is drawable.
 */
function composeSCurve(curve: ProgressCurveResponse): MasterScheduleSCurve {
  const planned = toCurvePoints(
    curve.baseline.map((p) => ({ periodEndDate: p.periodEndDate, value: p.plannedPercent })),
  );
  const actual = toCurvePoints(
    curve.actual.map((p) => ({ periodEndDate: p.periodEndDate, value: p.physicalPercent })),
  );

  const allMs = [...planned, ...actual].map((p) => p.timeMs);
  if (allMs.length === 0) {
    return { planned, actual, domain: null, domainLabels: null };
  }
  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  return {
    planned,
    actual,
    domain: { minMs, maxMs },
    domainLabels: {
      min: new Date(minMs).toISOString().slice(0, 10),
      max: new Date(maxMs).toISOString().slice(0, 10),
    },
  };
}

/**
 * Compose the render-ready Master Schedule report model from the existing read models. Pure — no I/O.
 * `baseline === null` (no frozen baseline yet) degrades gracefully: the status line reads provisional
 * and every other section still renders from the live rollup/curve/milestones.
 */
export function composeMasterScheduleReportModel(
  input: ComposeMasterScheduleInput,
): MasterScheduleReportModel {
  const { header, rollup, curve, baseline, milestones, asOf } = input;

  const phases: MasterSchedulePhaseRow[] = rollup.packages.map((wp) => ({
    code: wp.code,
    name: wp.name,
    durationDays: wp.durationDays,
    plannedStart: wp.plannedStart,
    plannedEnd: wp.plannedEnd,
    actualStart: wp.actualStart,
    actualFinish: wp.actualFinish,
    percentComplete: wp.percentComplete,
    scheduleStatus: wp.scheduleStatus,
    scheduleOnly: wp.scheduleOnly,
  }));

  const milestoneRows: MasterScheduleMilestoneRow[] = milestones.map((m) => ({
    code: m.code,
    name: m.name,
    status: m.status,
    baselineDate: m.baselineDate,
    forecastDate: m.forecastDate,
    actualDate: m.actualDate,
    releases: m.releases.map((r) => ({
      name: r.name,
      percentLabel: toPercentLabel(r.percentage),
      amountLabel: toAmountLabel(r.amount, r.currency),
      invoiced: r.invoiced,
    })),
  }));

  return {
    header: {
      organizationLogoUrl: header.organizationLogoUrl,
      organizationName: header.organizationName,
      projectCode: header.projectCode,
      projectName: header.projectName,
      clientName: header.clientName,
      projectStartDate: header.projectStartDate,
      projectExpectedEndDate: header.projectExpectedEndDate,
      asOf,
    },
    baselineStatus: composeBaselineStatus(baseline, curve),
    phases,
    physicalPercent: rollup.physicalPercent,
    weightsComplete: rollup.weightsComplete,
    sCurve: composeSCurve(curve),
    milestones: milestoneRows,
  };
}
