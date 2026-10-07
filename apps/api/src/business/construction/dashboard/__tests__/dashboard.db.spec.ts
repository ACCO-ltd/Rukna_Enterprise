/**
 * GET /dashboard — DashboardService live-DB tests.
 *
 * The dashboard has no formula of its own: its project rows are asserted EQUAL to the Finance
 * portfolio's rows for the same project, and its figures follow the shared receivable / aging
 * rules. Covers the money gate (a PM-like caller gets nulls, no figures, no amounts), the stage
 * (NEW / PREPARATION / RUNNING), overdue-invoice to-dos, aging buckets, stages to bill (the raise
 * blocker applies) and the Preparation next step.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type DashboardResponse, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { AccountingReadinessService } from '../../../accounting/accounting-core/application/accounting-readiness.service.js';
import { AccountingGuideService } from '../../../accounting/accounting-core/application/accounting-guide.service.js';
import { ProjectFinancialPositionRepository } from '../../../accounting/financial-position/infrastructure/project-financial-position.repository.js';
import { ProjectProcurementRepository } from '../../../procurement/project-procurement/infrastructure/project-procurement.repository.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import { FinancePortfolioService } from '../../finance-portfolio/application/finance-portfolio.service.js';
import { ProgrammeService } from '../../programme/application/programme.service.js';
import { ProgrammeRepository } from '../../programme/infrastructure/programme.repository.js';
import { ProgressService } from '../../progress/application/progress.service.js';
import { ProgressRepository } from '../../progress/infrastructure/progress.repository.js';
import { ProgrammeBaselineRepository } from '../../progress/infrastructure/programme-baseline.repository.js';
import { ProjectService } from '../../projects/application/project.service.js';
import { ProjectPrismaRepository } from '../../projects/infrastructure/project-prisma.repository.js';
import { DashboardService } from '../application/dashboard.service.js';

const DAY = 86_400_000;

describe('DashboardService — GET /dashboard', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 10);
  const runOrg = `dsh-run-${suffix}`;
  const prepOrg = `dsh-prep-${suffix}`;
  const newOrg = `dsh-new-${suffix}`;
  const orgIds = [runOrg, prepOrg, newOrg];
  const userId = `dsh-user-${suffix}`;
  const otherUser = `dsh-other-${suffix}`;

  let dashboard: DashboardService;
  let portfolio: FinancePortfolioService;
  let progress: ProgressService;
  let projA: string; // ACTIVE, contract 500,000 USD, three open invoices
  let projB: string; // ACTIVE, no contract
  let projP: string; // the Preparation org's DRAFT project
  let invLate70: string;
  let invB: string;
  let advanceStage: string;
  let draftStage: string;
  let reopenedStage: string;

  const finance = (orgId: string): RequestIdentity => ({
    userId,
    activeOrganizationId: orgId,
    tenantSlug: orgId,
    roles: ['Finance Officer'],
    permissions: [
      PERMISSIONS.financialPositionView,
      PERMISSIONS.boqViewMargin,
      PERMISSIONS.accountingView,
      PERMISSIONS.receivablesManage,
      PERMISSIONS.payablesManage,
      PERMISSIONS.contractsView,
      PERMISSIONS.projectsManage,
      PERMISSIONS.materialRequestsApprove,
      PERMISSIONS.procurementView,
      PERMISSIONS.clientsCreate,
    ],
  });
  // Member-scoped (projA only) with the payable / receivable work permissions but no money tier.
  const scopedClerk: RequestIdentity = {
    userId,
    activeOrganizationId: runOrg,
    tenantSlug: runOrg,
    roles: ['Project Manager'],
    permissions: [
      PERMISSIONS.payablesManage,
      PERMISSIONS.receivablesManage,
      PERMISSIONS.contractsView,
    ],
  };
  // Member-scoped (projA only) but money-visible — MINE-scope figures.
  const scopedFinance: RequestIdentity = {
    ...scopedClerk,
    permissions: [
      PERMISSIONS.financialPositionView,
      PERMISSIONS.boqViewMargin,
      PERMISSIONS.payablesManage,
      PERMISSIONS.receivablesManage,
    ],
  };
  // Money-blind, member-scoped (sees projA only) — the Project Manager shape.
  const pm: RequestIdentity = {
    userId,
    activeOrganizationId: runOrg,
    tenantSlug: runOrg,
    roles: ['Project Manager'],
    permissions: [
      PERMISSIONS.projectsManage,
      PERMISSIONS.progressApprove,
      PERMISSIONS.boqView,
      PERMISSIONS.materialRequestsApprove,
    ],
  };

  async function makeProject(
    orgId: string,
    code: string,
    status: 'DRAFT' | 'ACTIVE' | 'CANCELLED',
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const p = await prisma.project.create({
      data: {
        organizationId: orgId,
        code,
        name: `Project ${code}`,
        currency: 'USD',
        status,
        createdBy: userId,
        ...extra,
      },
    });
    return p.id;
  }

  async function makeInvoice(
    orgId: string,
    clientId: string,
    projectId: string | null,
    total: number,
    outstanding: number,
    dueDate: Date,
  ) {
    const inv = await prisma.clientInvoice.create({
      data: {
        organizationId: orgId,
        clientId,
        projectId,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        invoiceDate: new Date('2026-07-01'),
        dueDate,
        subtotal: new Decimal(total),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(total),
        outstandingAmount: new Decimal(outstanding),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
        createdBy: userId,
      },
    });
    return inv.id;
  }

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertMember: async () => undefined,
      accessibleProjectIds: async (identity: RequestIdentity) =>
        identity.roles.includes('Project Manager') ? [projA] : undefined,
    } as unknown as ProjectAccessService;
    const readiness = {
      getReadiness: async () => ({ ready: false, blockers: [{ code: 'NO_CHART_OF_ACCOUNTS' }] }),
    } as unknown as AccountingReadinessService;

    const commercialRepo = new CommercialPrismaRepository();
    portfolio = new FinancePortfolioService(
      tenancy,
      projectAccess,
      readiness,
      commercialRepo,
      new ProjectProcurementRepository(),
      new ProjectFinancialPositionRepository(),
    );
    const projects = new ProjectService(
      tenancy,
      {} as never,
      new ProjectPrismaRepository(),
      {} as never,
      projectAccess,
      {} as never,
    );
    progress = new ProgressService(
      tenancy,
      new ProgressRepository(),
      projectAccess,
      {} as never,
      {} as never,
      {} as never,
      new ProgrammeBaselineRepository(),
    );
    const programme = new ProgrammeService(tenancy, new ProgrammeRepository(), projectAccess);
    dashboard = new DashboardService(
      tenancy,
      projectAccess,
      portfolio,
      commercialRepo,
      projects,
      progress,
      programme,
      new AccountingGuideService(tenancy, readiness),
    );

    for (const [id, name] of [
      [runOrg, 'Running Co'],
      [prepOrg, 'Preparing Co'],
      [newOrg, 'New Co'],
    ] as const) {
      await prisma.organization.create({
        data: { id, name: `${name} ${suffix}`, slug: id, status: 'ACTIVE' },
      });
    }

    // ── RUNNING org ──────────────────────────────────────────────────────────────────
    const runClient = (
      await prisma.client.create({
        data: { organizationId: runOrg, code: `CL-${suffix}`, name: 'Hodan Trading' },
      })
    ).id;
    const supplierId = (
      await prisma.supplier.create({
        data: { organizationId: runOrg, code: `SP-${suffix}`, name: 'Cement Ltd' },
      })
    ).id;
    projA = await makeProject(runOrg, `DSH-A-${suffix}`, 'ACTIVE', { clientId: runClient });
    projB = await makeProject(runOrg, `DSH-B-${suffix}`, 'ACTIVE');
    await makeProject(runOrg, `DSH-C-${suffix}`, 'DRAFT');

    const boq = await prisma.boq.create({
      data: { organizationId: runOrg, projectId: projA, currency: 'USD' },
    });
    const ver = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: runOrg,
        projectId: projA,
        clientId: runClient,
        boqVersionId: ver.id,
        contractNumber: `CT-${suffix}`,
        contractValue: new Decimal(500_000),
        baseContractValue: new Decimal(500_000),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE' as never,
        createdBy: userId,
      },
    });
    // Stage 1: an advance on an ACTIVE contract, ready → billable (200,000).
    advanceStage = (
      await prisma.contractPaymentInstallment.create({
        data: {
          contractId: contract.id,
          name: 'Advance',
          sortOrder: 1,
          percentage: new Decimal('0.4'),
          triggerType: 'ADVANCE',
          readyToBillAt: new Date('2026-09-01'),
        },
      })
    ).id;
    // Stage 2: a work stage marked ready but with no milestone linked → the raise blocker refuses it.
    await prisma.contractPaymentInstallment.create({
      data: {
        contractId: contract.id,
        name: 'Structure',
        sortOrder: 2,
        percentage: new Decimal('0.6'),
        triggerType: 'MILESTONE',
        milestoneLabel: 'Structure',
        readyToBillAt: new Date('2026-09-01'),
      },
    });

    // Stage 3: a time-based stage with its draft invoice already prepared → still to bill (issue it).
    draftStage = (
      await prisma.contractPaymentInstallment.create({
        data: {
          contractId: contract.id,
          name: 'Handover',
          sortOrder: 3,
          percentage: new Decimal('0.1'),
          triggerType: 'TIME_BASED',
          readyToBillAt: new Date('2026-09-01'),
        },
      })
    ).id;
    await prisma.clientInvoice.create({
      data: {
        organizationId: runOrg,
        clientId: runClient,
        projectId: projA,
        contractId: contract.id,
        sourceInstallmentId: draftStage,
        invoiceDate: new Date('2026-09-02'),
        dueDate: new Date('2026-10-02'),
        subtotal: new Decimal(50_000),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(50_000),
        outstandingAmount: new Decimal(50_000),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'NOT_POSTED',
        documentStatus: 'DRAFT',
        createdBy: userId,
      },
    });

    // projB: a REOPENED main contract (ACTIVE → DRAFT) with a ready advance → never a to-bill row.
    const boqB = await prisma.boq.create({
      data: { organizationId: runOrg, projectId: projB, currency: 'USD' },
    });
    const verB = await prisma.boqVersion.create({
      data: { boqId: boqB.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });
    const contractB = await prisma.contract.create({
      data: {
        organizationId: runOrg,
        projectId: projB,
        clientId: runClient,
        boqVersionId: verB.id,
        contractNumber: `CT-B-${suffix}`,
        contractValue: new Decimal(100_000),
        baseContractValue: new Decimal(100_000),
        currency: 'USD',
        status: 'DRAFT',
        billingModel: 'MILESTONE' as never,
        createdBy: userId,
      },
    });
    reopenedStage = (
      await prisma.contractPaymentInstallment.create({
        data: {
          contractId: contractB.id,
          name: 'Advance B',
          sortOrder: 1,
          percentage: new Decimal('0.4'),
          triggerType: 'ADVANCE',
          readyToBillAt: new Date('2026-09-01'),
        },
      })
    ).id;

    const now = Date.now();
    invB = await makeInvoice(runOrg, runClient, projB, 3_000, 3_000, new Date(now - 5 * DAY)); // 1–30, projB
    await makeInvoice(runOrg, runClient, projA, 150_000, 90_000, new Date(now - 40 * DAY)); // 31–60
    invLate70 = await makeInvoice(
      runOrg,
      runClient,
      projA,
      10_000,
      10_000,
      new Date(now - 70 * DAY),
    ); // over 60
    await makeInvoice(runOrg, runClient, projA, 20_000, 20_000, new Date(now + 20 * DAY)); // not due
    await makeInvoice(runOrg, runClient, null, 5_000, 5_000, new Date(now - 10 * DAY)); // 1–30, no project
    await makeInvoice(runOrg, runClient, projA, 8_000, 0, new Date(now - 90 * DAY)); // paid: not counted

    await prisma.supplierBill.create({
      data: {
        organizationId: runOrg,
        supplierId,
        supplierInvoiceNumber: `SI-${suffix}`,
        supplierInvoiceNumberNorm: `SI${suffix}`,
        billDate: new Date('2026-09-20'),
        dueDate: new Date(now + 3 * DAY),
        currencyCode: 'USD',
        projectId: projA,
        subtotal: new Decimal(1_000),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(1_000),
        outstandingAmount: new Decimal(1_000),
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        createdBy: otherUser,
      },
    });
    // projB: a posted bill (payables) and two bills awaiting approval — one per project; the
    // projA one was entered by the caller (still in the queue: approve has no creator rule).
    for (const [tag, projectId, amount, posted, createdBy] of [
      ['PB', projB, 700, true, otherUser],
      ['SA', projA, 2_000, false, userId],
      ['SB', projB, 3_000, false, otherUser],
    ] as const) {
      await prisma.supplierBill.create({
        data: {
          organizationId: runOrg,
          supplierId,
          supplierInvoiceNumber: `SI-${tag}-${suffix}`,
          supplierInvoiceNumberNorm: `SI${tag}${suffix}`,
          billDate: new Date('2026-09-20'),
          dueDate: new Date(now + 3 * DAY),
          currencyCode: 'USD',
          projectId,
          subtotal: new Decimal(amount),
          vatAmount: new Decimal(0),
          totalAmount: new Decimal(amount),
          outstandingAmount: new Decimal(amount),
          documentStatus: posted ? 'APPROVED' : 'SUBMITTED',
          postingStatus: posted ? 'POSTED' : 'NOT_POSTED',
          createdBy,
        },
      });
    }

    for (const [n, requestedBy] of [
      ['1', otherUser],
      ['2', userId],
    ] as const) {
      await prisma.materialRequest.create({
        data: {
          organizationId: runOrg,
          mrNumber: `MR-${suffix}-${n}`,
          requestScope: 'PROJECT',
          projectId: projA,
          requestedBy,
          requestedDate: new Date('2026-10-01'),
          requiredByDate: new Date('2026-10-10'),
          title: `Cement ${n}`,
          status: 'SUBMITTED',
        },
      });
    }

    // Activity: seven project events over two projects, one minute apart (projB has the newest).
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'x',
        firstName: 'Dash',
        lastName: 'Tester',
        organizationId: runOrg,
      },
    });
    for (let i = 0; i < 7; i++) {
      await prisma.auditLog.create({
        data: {
          id: `dsh-evt-${suffix}-${i}`,
          userId,
          orgId: runOrg,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: i % 2 === 0 ? projA : projB,
          sourceCommand: 'project.update',
          createdAt: new Date(Date.UTC(2026, 9, 1, 12, i)),
        },
      });
    }

    await prisma.dailyProgressReport.create({
      data: {
        organizationId: runOrg,
        projectId: projA,
        reportDate: new Date('2026-10-01'),
        status: 'SUBMITTED',
        preparedBy: otherUser,
      },
    });

    // ── PREPARATION org: one DRAFT project, an active client, an estimate, nothing else ──
    const prepClient = (
      await prisma.client.create({
        data: { organizationId: prepOrg, code: `CL-${suffix}`, name: 'Prep Client' },
      })
    ).id;
    projP = await makeProject(prepOrg, `DSH-P-${suffix}`, 'DRAFT', {
      clientId: prepClient,
      contractValue: new Decimal(75_000),
    });

    // ── NEW org: only a cancelled project and a client ────────────────────────────────
    await prisma.client.create({
      data: { organizationId: newOrg, code: `CL-${suffix}`, name: 'New Client' },
    });
    await makeProject(newOrg, `DSH-N-${suffix}`, 'CANCELLED');
  }, 60_000);

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await prisma.dailyProgressReport.deleteMany({ where });
    await prisma.materialRequest.deleteMany({ where });
    await prisma.supplierBill.deleteMany({ where });
    await prisma.supplier.deleteMany({ where });
    await prisma.clientInvoice.deleteMany({ where });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: where } });
    await prisma.contract.deleteMany({ where });
    await prisma.boqVersion.deleteMany({ where: { boq: where } });
    await prisma.boq.deleteMany({ where });
    await prisma.project.deleteMany({ where });
    await prisma.client.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  }, 30_000);

  let runFinance: DashboardResponse;
  let runPm: DashboardResponse;
  beforeAll(async () => {
    [runFinance, runPm] = await Promise.all([dashboard.get(finance(runOrg)), dashboard.get(pm)]);
  }, 60_000);

  it('DSH-1: stage is decided on the organisation — NEW / PREPARATION / RUNNING', async () => {
    expect(runFinance.stage).toBe('RUNNING');
    expect(runPm.stage).toBe('RUNNING'); // the PM sees one project, the company is still running
    expect((await dashboard.get(finance(prepOrg))).stage).toBe('PREPARATION');
    expect((await dashboard.get(finance(newOrg))).stage).toBe('NEW');
  });

  it('DSH-2: a finance caller sees money; project rows equal the Finance portfolio rows', async () => {
    expect(runFinance.moneyVisible).toBe(true);
    expect(runFinance.projectScope).toBe('ALL');
    expect(runFinance.organizationName).toBe(`Running Co ${suffix}`);
    const portfolioRows = (await portfolio.list(finance(runOrg))).items;
    const a = runFinance.projects.inProgress.find((p) => p.id === projA)!;
    const rowA = portfolioRows.find((r) => r.projectId === projA)!;
    expect(a).toMatchObject({
      contractValue: rowA.contractValue,
      outstanding: rowA.outstanding,
      overdue: rowA.overdue,
      clientName: rowA.clientName,
    });
    expect(a.contractValue).toBe('500000.00');
    expect(a.outstanding).toBe('120000.00');
    expect(a.overdue).toBe('100000.00');
    expect(runFinance.projects.inProgress.map((p) => p.id).sort()).toEqual([projA, projB].sort());
    expect(runFinance.projects.statusCounts).toEqual({ ACTIVE: 2, DRAFT: 1 });
  });

  it('DSH-2b: no work package and no plan → both percentages null (not 0), read without error', async () => {
    await expect(progress.getScheduleReading(finance(runOrg), projA)).resolves.toEqual({
      plannedPercent: null,
      physicalPercent: null,
    });
    const a = runFinance.projects.inProgress.find((p) => p.id === projA)!;
    expect(a.physicalPercent).toBeNull();
    expect(a.plannedPercent).toBeNull();
  });

  it('DSH-3: figures — receivables org-wide (incl. a project-less invoice), aging folded, payables', () => {
    expect(runFinance.figures).toHaveLength(1);
    const usd = runFinance.figures![0]!;
    expect(usd.currency).toBe('USD');
    // projA's ACTIVE contract + projB's reopened (DRAFT) one: the portfolio's main-contract rule.
    expect(usd.contractValueInProgress).toBe('600000.00');
    expect(usd.activeProjectCount).toBe(2);
    expect(usd.receivables).toEqual({
      outstanding: '128000.00',
      unpaidInvoiceCount: 5,
      overdue: '108000.00',
      overdueInvoiceCount: 4,
      oldestDaysLate: 70,
      aging: {
        notDue: '20000.00',
        days1To30: '8000.00',
        days31To60: '90000.00',
        over60: '10000.00',
      },
    });
    expect(usd.payables).toEqual({
      outstanding: '1700.00',
      unpaidBillCount: 2,
      dueThisWeek: '1700.00',
    });
  });

  it('DSH-4: overdue invoices lead the to-do list, most days late first, linked to the invoice', () => {
    const overdue = runFinance.todo.filter((t) => t.kind === 'INVOICE_OVERDUE');
    expect(overdue).toHaveLength(4);
    expect(runFinance.todo[0]).toMatchObject({
      kind: 'INVOICE_OVERDUE',
      tone: 'danger',
      daysLate: 70,
      amount: '10000.00',
      currency: 'USD',
      clientName: 'Hodan Trading',
      href: `/finance/accounting/invoices/${invLate70}`,
    });
    expect(overdue.map((t) => (t.kind === 'INVOICE_OVERDUE' ? t.daysLate : 0))).toEqual([
      70, 40, 10, 5,
    ]);
    const tones = runFinance.todo.map((t) => t.tone);
    const rank = { danger: 0, attention: 1, neutral: 2 } as const;
    expect([...tones].sort((x, y) => rank[x] - rank[y])).toEqual(tones);
  });

  it("DSH-5: material requests exclude the caller's own; stages to bill pass the raise blocker", () => {
    const mrs = runFinance.todo.filter((t) => t.kind === 'MATERIAL_REQUEST_AWAITING_APPROVAL');
    expect(mrs).toHaveLength(1);
    expect(mrs[0]).toMatchObject({
      mrNumber: `MR-${suffix}-1`,
      amount: null,
      requiredByDate: '2026-10-10',
    });

    // The prepare guard (`stagePrepareBlock`) decides: the unlinked work stage and projB's
    // reopened contract give no row; a prepared draft stays a row (it needs issuing).
    const stages = runFinance.todo.filter((t) => t.kind === 'STAGE_READY_TO_BILL');
    expect(stages).toEqual([
      expect.objectContaining({
        key: `stage-ready:${advanceStage}`,
        stageNumber: 1,
        stageLabel: 'Advance',
        amount: '200000.00',
        currency: 'USD',
        draftPrepared: false,
        href: `/finance/projects/${projA}/billing`,
      }),
      expect.objectContaining({
        key: `stage-ready:${draftStage}`,
        stageNumber: 3,
        amount: '50000.00',
        draftPrepared: true,
      }),
    ]);
    expect(JSON.stringify(runFinance.todo)).not.toContain(reopenedStage);

    // Bills awaiting approval: one aggregated row, the caller's own bill included.
    expect(runFinance.todo.find((t) => t.kind === 'BILLS_AWAITING_APPROVAL')).toMatchObject({
      count: 2,
      amount: '5000.00',
      currency: 'USD',
      href: '/finance/accounting/bills',
    });
    // The accounting setup cycle is not finished (stubbed readiness) → one attention row.
    expect(runFinance.todo.find((t) => t.kind === 'ACCOUNTING_SETUP_INCOMPLETE')).toMatchObject({
      href: '/finance/accounting/guide',
    });
  });

  it('DSH-6: money hidden for a PM — no figures, null money, no amounts anywhere in the to-do list', () => {
    expect(runPm.moneyVisible).toBe(false);
    expect(runPm.projectScope).toBe('MINE');
    expect(runPm.figures).toBeNull();
    expect(runPm.projects.inProgress).toHaveLength(1);
    expect(runPm.projects.inProgress[0]).toMatchObject({
      id: projA,
      contractValue: null,
      outstanding: null,
      overdue: null,
    });
    expect(runPm.projects.statusCounts).toEqual({ ACTIVE: 1 });
    expect(runPm.todo.some((t) => t.kind === 'INVOICE_OVERDUE')).toBe(false);
    // approve:material-request without view:procurement (the request page's gate) → no row.
    expect(runPm.todo.some((t) => t.kind === 'MATERIAL_REQUEST_AWAITING_APPROVAL')).toBe(false);
    expect(runPm.todo.every((t) => t.amount === null)).toBe(true);
    expect(runPm.todo.find((t) => t.kind === 'REPORTS_TO_REVIEW')).toMatchObject({
      count: 1,
      oldestReportDate: '2026-10-01',
      href: `/projects/${projA}/progress/review`,
    });
    // No money-shaped string anywhere in the response (timestamps aside).
    expect(JSON.stringify(runPm)).not.toMatch(/"-?\d+\.\d{2}"/);
  });

  it("DSH-6b: activity — the newest five across the caller's projects, each naming its project", () => {
    expect(runFinance.activity.map((e) => e.id)).toEqual(
      [6, 5, 4, 3, 2].map((i) => `dsh-evt-${suffix}-${i}`),
    );
    expect(runFinance.activity[0]).toMatchObject({
      project: { id: projA, name: `Project DSH-A-${suffix}` },
    });
    expect(runFinance.activity[1]).toMatchObject({ project: { id: projB } });
    // The PM sees only projA's events.
    expect(runPm.activity.map((e) => e.id)).toEqual(
      [6, 4, 2, 0].map((i) => `dsh-evt-${suffix}-${i}`),
    );
  });

  it('DSH-9: a member-scoped clerk with payable/receivable work but no money tier sees no amounts and nothing of other projects', async () => {
    const res = await dashboard.get(scopedClerk);
    expect(res.moneyVisible).toBe(false);
    expect(res.projectScope).toBe('MINE');
    expect(res.figures).toBeNull();
    expect(res.todo.every((t) => t.amount === null && t.currency === null)).toBe(true);
    expect(res.todo.some((t) => t.kind === 'INVOICE_OVERDUE')).toBe(false);
    expect(res.todo.find((t) => t.kind === 'BILLS_AWAITING_APPROVAL')).toMatchObject({ count: 1 });
    expect(res.todo.filter((t) => t.kind === 'STAGE_READY_TO_BILL').map((t) => t.key)).toEqual([
      `stage-ready:${advanceStage}`,
      `stage-ready:${draftStage}`,
    ]);
    const json = JSON.stringify(res);
    expect(json).not.toContain(projB);
    expect(json).not.toMatch(/"-?\d+\.\d{2}"/);
  });

  it('DSH-10: MINE scope — invoices and bills on a non-member project (or none) are excluded', async () => {
    const res = await dashboard.get(scopedFinance);
    expect(res.moneyVisible).toBe(true);
    expect(res.projectScope).toBe('MINE');
    const usd = res.figures![0]!;
    expect(usd.contractValueInProgress).toBe('500000.00');
    expect(usd.activeProjectCount).toBe(1);
    expect(usd.receivables).toMatchObject({
      outstanding: '120000.00',
      unpaidInvoiceCount: 3,
      overdue: '100000.00',
      overdueInvoiceCount: 2,
    });
    expect(usd.payables).toEqual({
      outstanding: '1000.00',
      unpaidBillCount: 1,
      dueThisWeek: '1000.00',
    });
    const overdue = res.todo.filter((t) => t.kind === 'INVOICE_OVERDUE');
    expect(overdue.map((t) => (t.kind === 'INVOICE_OVERDUE' ? t.daysLate : 0))).toEqual([70, 40]);
    expect(JSON.stringify(res.todo)).not.toContain(invB);
    expect(res.todo.find((t) => t.kind === 'BILLS_AWAITING_APPROVAL')).toMatchObject({
      count: 1,
      amount: '2000.00',
    });
  });

  it('DSH-7: Preparation — readiness, next step in checklist order, the estimate as value', async () => {
    const res = await dashboard.get(finance(prepOrg));
    expect(res.projects.inProgress).toEqual([]);
    expect(res.projects.inPreparation).toEqual([
      expect.objectContaining({
        id: projP,
        clientName: 'Prep Client',
        readiness: { done: 1, total: 6 },
        nextStep: { code: 'BOQ_BASELINED', owner: 'quantitySurveyor' },
        value: { amount: '75000.00', currency: 'USD', source: 'ESTIMATE' },
      }),
    ]);
    expect(res.todo.find((t) => t.kind === 'PROJECTS_WITHOUT_CONTRACT')).toMatchObject({
      count: 1,
      href: '/projects',
    });
    expect(res.todo.some((t) => t.kind === 'PROJECT_READY_TO_START')).toBe(false);
    expect(res.figures).toEqual([]);
    expect(res.setup).toBeNull();

    const hidden = await dashboard.get({
      ...finance(prepOrg),
      permissions: [PERMISSIONS.contractsView],
    });
    expect(hidden.projects.inPreparation[0]!.value).toBeNull();
  });

  it('DSH-8: a new company gets the setup checklist', async () => {
    const res = await dashboard.get(finance(newOrg));
    expect(res.setup).toEqual([
      { code: 'CLIENT', done: true, optional: false, canAct: true },
      { code: 'PROJECT', done: false, optional: false, canAct: false },
      { code: 'ACCOUNTING', done: false, optional: false, canAct: false },
      { code: 'SUPPLIERS', done: false, optional: true, canAct: true },
      { code: 'TEAM', done: false, optional: false, canAct: false },
    ]);
    expect(res.projects.statusCounts).toEqual({ CANCELLED: 1 });
    expect(res.figures).toEqual([]);
  });
});
