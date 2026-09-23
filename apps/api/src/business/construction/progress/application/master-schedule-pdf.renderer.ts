import { createElement as h } from 'react';

import type {
  MasterScheduleReportModel,
  MasterSchedulePhaseRow,
  MasterScheduleMilestoneRow,
  MasterScheduleSCurve,
} from './master-schedule-report.model.js';

/**
 * Master Schedule P4 (ADR-029) — the react-pdf renderer for the branded Master Schedule report.
 *
 * In-process server React→PDF (no headless browser, so no Chromium in the node:22-slim API image).
 * Built-in Helvetica (no font registration/asset) for v1 — a branded font is a follow-up. The S-curve
 * is a hand-mapped SVG (`<Svg><Polyline>/<Line>`) rendered from the already-computed curve point
 * arrays with a simple linear scale — no chart library, no re-interpolation.
 *
 * IMPORTANT (module hygiene): `@react-pdf/renderer` ships native ESM whose deep dependency tree
 * (fontkit / pdfkit / yoga-layout …) the repo's CommonJS ts-jest transform cannot parse. So it is
 * loaded LAZILY — a dynamic `import()` inside `renderMasterSchedulePdf`, not a top-level import.
 * Merely importing this module (or the service/controller/Nest module that owns it) therefore does
 * NOT pull the ESM tree into jest; only an actual render does — and the render is mocked in the unit
 * tests and proven for real by the committed smoke script.
 *
 * The tree is built with `React.createElement` (aliased `h`) rather than JSX so this file compiles
 * under the API's existing `tsc`/ts-jest config without adding a `jsx` compiler option.
 */

// The subset of react-pdf primitives + helpers this renderer uses, loaded lazily.
interface ReactPdf {
  Document: unknown;
  Page: unknown;
  View: unknown;
  Text: unknown;
  Image: unknown;
  Svg: unknown;
  Polyline: unknown;
  Line: unknown;
  StyleSheet: { create: (styles: Record<string, unknown>) => Record<string, unknown> };
  renderToBuffer: (element: unknown) => Promise<Buffer>;
}

// Sequential chart colours (hardcoded hex in the PDF, per the ticket) — the planned line reads as the
// primary series, the actual as a distinct second sequential step.
const COLOR_PLANNED = '#2563eb'; // blue-600
const COLOR_ACTUAL = '#16a34a'; // green-600
const COLOR_AXIS = '#94a3b8'; // slate-400
const COLOR_GRID = '#e2e8f0'; // slate-200
const COLOR_TEXT = '#0f172a'; // slate-900
const COLOR_MUTED = '#64748b'; // slate-500
const COLOR_BORDER = '#cbd5e1'; // slate-300
const COLOR_HEADER_BG = '#f1f5f9'; // slate-100

/** Build the stylesheet (needs react-pdf's StyleSheet, so it is created after the lazy load). */
function buildStyles(pdf: ReactPdf) {
  return pdf.StyleSheet.create({
    page: {
      paddingTop: 36,
      paddingBottom: 40,
      paddingHorizontal: 40,
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: COLOR_TEXT,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      borderBottomWidth: 1,
      borderBottomColor: COLOR_BORDER,
      paddingBottom: 10,
      marginBottom: 12,
    },
    headerLeft: { flexDirection: 'column', maxWidth: 340 },
    logo: { height: 40, maxWidth: 160, objectFit: 'contain', marginBottom: 4 },
    orgName: { fontFamily: 'Helvetica-Bold', fontSize: 16, color: COLOR_TEXT },
    docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 6, color: COLOR_TEXT },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end' },
    metaLabel: { fontSize: 7, color: COLOR_MUTED, textTransform: 'uppercase' },
    metaValue: { fontSize: 9, color: COLOR_TEXT, marginBottom: 4 },
    projectCode: { fontFamily: 'Helvetica-Bold', fontSize: 12, color: COLOR_TEXT },
    baselineBadge: { fontSize: 8, color: COLOR_MUTED, marginTop: 4 },

    sectionTitle: {
      fontFamily: 'Helvetica-Bold',
      fontSize: 10,
      color: COLOR_TEXT,
      marginTop: 14,
      marginBottom: 6,
    },
    sectionNote: { fontSize: 8, color: COLOR_MUTED, marginBottom: 6 },

    table: { borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 2 },
    tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLOR_GRID },
    trLast: { flexDirection: 'row' },
    th: {
      backgroundColor: COLOR_HEADER_BG,
      fontFamily: 'Helvetica-Bold',
      fontSize: 7.5,
      color: COLOR_MUTED,
      paddingVertical: 4,
      paddingHorizontal: 4,
    },
    td: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 4, color: COLOR_TEXT },
    tdMuted: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 4, color: COLOR_MUTED },

    chartLegend: { flexDirection: 'row', marginTop: 6, marginBottom: 2 },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
    legendSwatch: { width: 10, height: 3, marginRight: 4 },
    legendText: { fontSize: 8, color: COLOR_MUTED },

    empty: { fontSize: 8, color: COLOR_MUTED, fontStyle: 'italic', paddingVertical: 6 },
    footer: {
      position: 'absolute',
      bottom: 20,
      left: 40,
      right: 40,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: COLOR_BORDER,
      paddingTop: 6,
      fontSize: 7,
      color: COLOR_MUTED,
    },
  });
}

type Styles = ReturnType<typeof buildStyles>;

function dash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : '—';
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function statusLabel(status: MasterSchedulePhaseRow['scheduleStatus']): string {
  switch (status) {
    case 'AHEAD':
      return 'Ahead';
    case 'ON_TRACK':
      return 'On track';
    case 'BEHIND':
      return 'Behind';
    default:
      return 'N/A';
  }
}

// ── Header ───────────────────────────────────────────────────────────────────────

function renderHeader(pdf: ReactPdf, s: Styles, model: MasterScheduleReportModel) {
  const { Image, Text, View } = pdf;
  const { header, baselineStatus } = model;
  // Brand mark: the logo when the org has one, else the org name as text (the documented fallback).
  const brand = header.organizationLogoUrl
    ? h(Image as never, { key: 'logo', style: s.logo, src: header.organizationLogoUrl })
    : h(Text as never, { key: 'orgname', style: s.orgName }, header.organizationName);

  return h(
    View as never,
    { style: s.header },
    h(
      View as never,
      { style: s.headerLeft },
      brand,
      h(Text as never, { style: s.docTitle }, 'Project Master Schedule'),
      h(Text as never, { style: s.baselineBadge }, baselineStatus.label),
    ),
    h(
      View as never,
      { style: s.headerRight },
      h(Text as never, { style: s.projectCode }, header.projectCode),
      h(Text as never, { style: s.metaValue }, header.projectName),
      h(Text as never, { style: s.metaLabel }, 'Client'),
      h(Text as never, { style: s.metaValue }, dash(header.clientName)),
      h(Text as never, { style: s.metaLabel }, 'Start / Expected end'),
      h(
        Text as never,
        { style: s.metaValue },
        `${dash(header.projectStartDate)}  →  ${dash(header.projectExpectedEndDate)}`,
      ),
      h(Text as never, { style: s.metaLabel }, 'Report as of'),
      h(Text as never, { style: s.metaValue }, header.asOf),
    ),
  );
}

// ── Phase / activity schedule table ────────────────────────────────────────────────

const PHASE_COLS = [
  { key: 'no', label: 'No', width: '5%' },
  { key: 'phase', label: 'Phase', width: '27%' },
  { key: 'dur', label: 'Dur (d)', width: '8%' },
  { key: 'ps', label: 'Plan Start', width: '12%' },
  { key: 'pe', label: 'Plan End', width: '12%' },
  { key: 'as', label: 'Act Start', width: '12%' },
  { key: 'af', label: 'Act End', width: '11%' },
  { key: 'pc', label: '%', width: '6%' },
  { key: 'st', label: 'Status', width: '7%' },
] as const;

function renderPhaseTable(pdf: ReactPdf, s: Styles, phases: MasterSchedulePhaseRow[]) {
  const { Text, View } = pdf;
  const headerRow = h(
    View as never,
    { style: s.tr, key: 'phase-head' },
    ...PHASE_COLS.map((c) =>
      h(Text as never, { key: c.key, style: [s.th, { width: c.width }] }, c.label),
    ),
  );

  if (phases.length === 0) {
    return h(
      View as never,
      { style: s.table },
      headerRow,
      h(View as never, { style: s.trLast }, h(Text as never, { style: s.empty }, 'No phases defined yet.')),
    );
  }

  const rows = phases.map((p, i) => {
    const last = i === phases.length - 1;
    return h(
      View as never,
      { style: last ? s.trLast : s.tr, key: `phase-${p.code}-${i}` },
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[0].width }] }, String(i + 1)),
      h(
        Text as never,
        { style: [s.td, { width: PHASE_COLS[1].width }] },
        p.scheduleOnly ? `${p.name} (schedule-only)` : p.name,
      ),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[2].width }] }, p.durationDays === null ? '—' : String(p.durationDays)),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[3].width }] }, dash(p.plannedStart)),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[4].width }] }, dash(p.plannedEnd)),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[5].width }] }, dash(p.actualStart)),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[6].width }] }, dash(p.actualFinish)),
      h(Text as never, { style: [s.td, { width: PHASE_COLS[7].width }] }, pct(p.percentComplete)),
      h(Text as never, { style: [s.tdMuted, { width: PHASE_COLS[8].width }] }, statusLabel(p.scheduleStatus)),
    );
  });

  return h(View as never, { style: s.table }, headerRow, ...rows);
}

// ── S-curve SVG ─────────────────────────────────────────────────────────────────────

const CHART_W = 515; // fits A4 content width (595 - 2*40)
const CHART_H = 200;
const PAD_LEFT = 30; // room for the y-axis % labels
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 22; // room for the x-axis date labels
const PLOT_W = CHART_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_H - PAD_TOP - PAD_BOTTOM;

/**
 * Hand-mapped linear scale from the curve model into the SVG plot box. x maps the point's epoch-ms
 * across the shared date domain; y maps percent 0..100 with 0 at the bottom of the plot and 100 at the
 * top (SVG y grows downward, so we invert). Reuses the already-computed point arrays — no re-interp.
 */
function renderSCurve(pdf: ReactPdf, s: Styles, sCurve: MasterScheduleSCurve) {
  const { Text, View, Svg, Polyline, Line } = pdf;
  if (!sCurve.domain || (sCurve.planned.length === 0 && sCurve.actual.length === 0)) {
    return h(Text as never, { style: s.empty }, 'Not enough data to draw the S-curve yet.');
  }
  const { minMs, maxMs } = sCurve.domain;
  const spanMs = maxMs - minMs;

  const scaleX = (timeMs: number): number => {
    // A single-point domain (span 0) pins x to the left edge rather than dividing by zero.
    const frac = spanMs > 0 ? (timeMs - minMs) / spanMs : 0;
    return PAD_LEFT + frac * PLOT_W;
  };
  const scaleY = (percent: number): number => {
    const clamped = Math.max(0, Math.min(100, percent));
    return PAD_TOP + (1 - clamped / 100) * PLOT_H;
  };

  const toPolyPoints = (pts: { timeMs: number; percent: number }[]): string =>
    pts.map((p) => `${scaleX(p.timeMs).toFixed(1)},${scaleY(p.percent).toFixed(1)}`).join(' ');

  const yTicks = [0, 25, 50, 75, 100];
  const children: unknown[] = [];

  // Horizontal grid lines at each y tick.
  for (const t of yTicks) {
    children.push(
      h(Line as never, {
        key: `grid-${t}`,
        x1: PAD_LEFT,
        y1: scaleY(t),
        x2: PAD_LEFT + PLOT_W,
        y2: scaleY(t),
        stroke: COLOR_GRID,
        strokeWidth: 0.5,
      }),
    );
  }

  // Axes.
  children.push(
    h(Line as never, {
      key: 'y-axis',
      x1: PAD_LEFT,
      y1: PAD_TOP,
      x2: PAD_LEFT,
      y2: PAD_TOP + PLOT_H,
      stroke: COLOR_AXIS,
      strokeWidth: 0.75,
    }),
    h(Line as never, {
      key: 'x-axis',
      x1: PAD_LEFT,
      y1: PAD_TOP + PLOT_H,
      x2: PAD_LEFT + PLOT_W,
      y2: PAD_TOP + PLOT_H,
      stroke: COLOR_AXIS,
      strokeWidth: 0.75,
    }),
  );

  // Planned line (blue) — a polyline needs ≥2 points.
  if (sCurve.planned.length >= 2) {
    children.push(
      h(Polyline as never, {
        key: 'planned-line',
        points: toPolyPoints(sCurve.planned),
        stroke: COLOR_PLANNED,
        strokeWidth: 1.5,
        fill: 'none',
      }),
    );
  }
  // Actual line (green).
  if (sCurve.actual.length >= 2) {
    children.push(
      h(Polyline as never, {
        key: 'actual-line',
        points: toPolyPoints(sCurve.actual),
        stroke: COLOR_ACTUAL,
        strokeWidth: 1.5,
        fill: 'none',
      }),
    );
  }

  // y-axis % labels.
  for (const t of yTicks) {
    children.push(
      h(
        Text as never,
        {
          key: `ylab-${t}`,
          x: PAD_LEFT - 4,
          y: scaleY(t) + 2,
          style: { fontSize: 6, fill: COLOR_MUTED, textAnchor: 'end' },
        },
        `${t}%`,
      ),
    );
  }

  // x-axis endpoint date labels.
  if (sCurve.domainLabels) {
    children.push(
      h(
        Text as never,
        {
          key: 'xlab-min',
          x: PAD_LEFT,
          y: PAD_TOP + PLOT_H + 12,
          style: { fontSize: 6, fill: COLOR_MUTED, textAnchor: 'start' },
        },
        sCurve.domainLabels.min,
      ),
      h(
        Text as never,
        {
          key: 'xlab-max',
          x: PAD_LEFT + PLOT_W,
          y: PAD_TOP + PLOT_H + 12,
          style: { fontSize: 6, fill: COLOR_MUTED, textAnchor: 'end' },
        },
        sCurve.domainLabels.max,
      ),
    );
  }

  const legend = h(
    View as never,
    { style: s.chartLegend },
    h(
      View as never,
      { style: s.legendItem },
      h(View as never, { style: [s.legendSwatch, { backgroundColor: COLOR_PLANNED }] }),
      h(Text as never, { style: s.legendText }, 'Planned'),
    ),
    h(
      View as never,
      { style: s.legendItem },
      h(View as never, { style: [s.legendSwatch, { backgroundColor: COLOR_ACTUAL }] }),
      h(Text as never, { style: s.legendText }, 'Actual'),
    ),
  );

  return h(
    View as never,
    null,
    h(
      Svg as never,
      { width: CHART_W, height: CHART_H, viewBox: `0 0 ${CHART_W} ${CHART_H}` },
      ...children,
    ),
    legend,
  );
}

// ── Milestones + releases table ─────────────────────────────────────────────────────

const MS_COLS = [
  { key: 'name', label: 'Milestone', width: '26%' },
  { key: 'status', label: 'Status', width: '10%' },
  { key: 'base', label: 'Baseline', width: '11%' },
  { key: 'fore', label: 'Forecast', width: '11%' },
  { key: 'act', label: 'Actual', width: '11%' },
  { key: 'rel', label: 'Releases (payment stage · % · amount)', width: '31%' },
] as const;

function renderMilestoneTable(pdf: ReactPdf, s: Styles, milestones: MasterScheduleMilestoneRow[]) {
  const { Text, View } = pdf;
  const headerRow = h(
    View as never,
    { style: s.tr, key: 'ms-head' },
    ...MS_COLS.map((c) => h(Text as never, { key: c.key, style: [s.th, { width: c.width }] }, c.label)),
  );

  if (milestones.length === 0) {
    return h(
      View as never,
      { style: s.table },
      headerRow,
      h(
        View as never,
        { style: s.trLast },
        h(Text as never, { style: s.empty }, 'No milestones defined yet.'),
      ),
    );
  }

  const rows = milestones.map((m, i) => {
    const last = i === milestones.length - 1;
    const releaseText =
      m.releases.length === 0
        ? '—'
        : m.releases
            .map(
              (r) =>
                `${r.name} · ${r.percentLabel} · ${r.amountLabel}${r.invoiced ? ' (invoiced)' : ''}`,
            )
            .join('\n');
    return h(
      View as never,
      { style: last ? s.trLast : s.tr, key: `ms-${m.code}-${i}` },
      h(Text as never, { style: [s.td, { width: MS_COLS[0].width }] }, m.name),
      h(Text as never, { style: [s.td, { width: MS_COLS[1].width }] }, m.status),
      h(Text as never, { style: [s.tdMuted, { width: MS_COLS[2].width }] }, dash(m.baselineDate)),
      h(Text as never, { style: [s.tdMuted, { width: MS_COLS[3].width }] }, dash(m.forecastDate)),
      h(Text as never, { style: [s.tdMuted, { width: MS_COLS[4].width }] }, dash(m.actualDate)),
      h(Text as never, { style: [s.tdMuted, { width: MS_COLS[5].width }] }, releaseText),
    );
  });

  return h(View as never, { style: s.table }, headerRow, ...rows);
}

// ── Document ─────────────────────────────────────────────────────────────────────

function renderDocument(pdf: ReactPdf, model: MasterScheduleReportModel) {
  const { Document, Page, View, Text } = pdf;
  const s = buildStyles(pdf);
  const overall = `Overall physical progress: ${model.physicalPercent}%${
    model.weightsComplete ? '' : ' (weights incomplete — understated)'
  }`;

  return h(
    Document as never,
    {
      title: `Master Schedule — ${model.header.projectCode}`,
      author: model.header.organizationName,
      subject: 'Project Master Schedule',
    },
    h(
      Page as never,
      { size: 'A4', style: s.page },
      renderHeader(pdf, s, model),

      h(Text as never, { style: s.sectionTitle }, 'Activity schedule'),
      h(Text as never, { style: s.sectionNote }, overall),
      renderPhaseTable(pdf, s, model.phases),

      h(Text as never, { style: s.sectionTitle }, 'Plan vs actual (S-curve)'),
      renderSCurve(pdf, s, model.sCurve),

      h(Text as never, { style: s.sectionTitle }, 'Milestones & payment releases'),
      renderMilestoneTable(pdf, s, model.milestones),

      h(
        View as never,
        { style: s.footer, fixed: true },
        h(Text as never, null, `${model.header.organizationName} · ${model.header.projectCode}`),
        h(
          Text as never,
          {
            render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `Generated ${model.header.asOf} · Page ${pageNumber} of ${totalPages}`,
          },
          '',
        ),
      ),
    ),
  );
}

/**
 * Render the composed report model to a PDF Buffer. react-pdf is imported LAZILY here (see the module
 * note above) so the ESM tree is pulled in only when a render actually happens. `renderToBuffer` is
 * react-pdf's in-process (no-browser) renderer; the returned buffer begins with the `%PDF` magic bytes.
 */
export async function renderMasterSchedulePdf(model: MasterScheduleReportModel): Promise<Buffer> {
  const pdf = (await import('@react-pdf/renderer')) as unknown as ReactPdf;
  return pdf.renderToBuffer(renderDocument(pdf, model));
}
