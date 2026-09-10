/**
 * Master Schedule P4 (ADR-029) — a runnable smoke proof that the REAL react-pdf renderer produces a
 * valid PDF from the ACTUAL composer + renderer code (not a jest mock).
 *
 * Why a standalone script: `@react-pdf/renderer` ships native ESM whose deep dependency tree
 * (fontkit / pdfkit / yoga-layout …) the repo's CommonJS ts-jest transform cannot parse — so the jest
 * suite mocks it. This script closes that gap: it loads the compiled CommonJS build (react-pdf loads
 * fine via Node's native require here) and renders a representative report model end-to-end, asserting
 * the output Buffer begins with the `%PDF` magic bytes.
 *
 * Run (from apps/api):
 *   pnpm build            # emits dist/ (nest build)
 *   node scripts/master-schedule-pdf-smoke.cjs
 */
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'business', 'construction', 'progress', 'application');

function load() {
  try {
    const { composeMasterScheduleReportModel } = require(path.join(DIST, 'master-schedule-report.model.js'));
    const { renderMasterSchedulePdf } = require(path.join(DIST, 'master-schedule-pdf.renderer.js'));
    return { composeMasterScheduleReportModel, renderMasterSchedulePdf };
  } catch (err) {
    console.error(
      'Could not load the compiled build. Run `pnpm build` in apps/api first.\n' + err.message,
    );
    process.exit(2);
  }
}

async function main() {
  const { composeMasterScheduleReportModel, renderMasterSchedulePdf } = load();

  const model = composeMasterScheduleReportModel({
    header: {
      projectCode: 'ACCO-WBR-26-0062',
      projectName: 'Office Building',
      clientName: 'Banaadir Municipality',
      projectStartDate: '2026-06-01',
      projectExpectedEndDate: '2026-12-31',
      organizationName: 'ACCO',
      organizationLogoUrl: null,
    },
    rollup: {
      projectId: 'p1',
      physicalPercent: 42.5,
      weightsTotal: '1',
      weightsComplete: true,
      packages: [
        {
          id: 'wp1', code: 'WP-01', name: 'Mobilization', responsibleOwner: null, weight: '0',
          percentComplete: null, leafCount: 0, plannedStart: '2026-06-01', plannedEnd: '2026-06-15',
          durationDays: 14, forecastEnd: null, scheduleOnly: true, actualStart: null,
          actualFinish: null, scheduleStatus: 'ON_TRACK',
        },
        {
          id: 'wp2', code: 'WP-02', name: 'Structure', responsibleOwner: 'Eng A', weight: '0.6',
          percentComplete: 70, leafCount: 5, plannedStart: '2026-06-16', plannedEnd: '2026-09-30',
          durationDays: 106, forecastEnd: null, scheduleOnly: false, actualStart: '2026-06-20',
          actualFinish: null, scheduleStatus: 'BEHIND',
        },
      ],
    },
    curve: {
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
      scheduleVariancePercent: -5, status: 'ON_TRACK', baselineProvisional: false,
      baselineSource: 'baseline', baselineVersion: 2,
    },
    baseline: {
      id: 'b1', projectId: 'p1', version: 2, status: 'APPROVED', approvedBy: 'u-pm',
      approvedAt: '2026-09-10T08:00:00.000Z', variationOrderId: 'vo1', note: null,
      createdAt: '2026-09-10T08:00:00.000Z',
      points: [
        { targetDate: '2026-06-30', cumulativePercent: 15 },
        { targetDate: '2026-12-31', cumulativePercent: 100 },
      ],
    },
    milestones: [
      {
        id: 'm1', projectId: 'p1', code: 'MS-01', name: 'Blockwork, Plaster & MEP First Fix',
        status: 'PLANNED', baselineDate: '2026-10-31', forecastDate: '2026-11-05', actualDate: null,
        sortOrder: 0, contractDeliverableId: null, verifiedBy: null, verifiedAt: null,
        releases: [
          {
            installmentId: 'i1', name: '30% Partition & Plastering', percentage: '0.3000',
            triggerType: 'MILESTONE', amount: '150000.00', currency: 'USD', invoiced: false,
          },
        ],
      },
    ],
    asOf: '2026-09-10',
  });

  const buffer = await renderMasterSchedulePdf(model);
  const magic = buffer.subarray(0, 5).toString('latin1');
  if (magic !== '%PDF-') {
    console.error(`FAIL: buffer did not start with %PDF (got ${JSON.stringify(magic)})`);
    process.exit(1);
  }
  console.log(`OK: real react-pdf render emitted ${buffer.length} bytes starting with "${magic}"`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
