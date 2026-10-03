/**
 * ADR-043 Phase 4 — FinanceCashflowService live-DB tests.
 *
 * The forecast has no formulas of its own: its invoice inflows must equal the portfolio's
 * `outstanding`, its supplier-bill outflows the portfolio's `billsToPay` amount (per project and in
 * the per-currency totals, where a bill coded to two projects counts once). Plus: unbilled stages
 * dated by schedule date + contract terms, open commitments by delivery + supplier terms,
 * undated / overdue placement, project scoping and currency separation.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type CashflowCurrencyForecast, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { AccountingReadinessService } from '../../../accounting/accounting-core/application/accounting-readiness.service.js';
import { ProjectFinancialPositionRepository } from '../../../accounting/financial-position/infrastructure/project-financial-position.repository.js';
import { ProjectProcurementRepository } from '../../../procurement/project-procurement/infrastructure/project-procurement.repository.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import { FinanceCashflowService } from '../application/finance-cashflow.service.js';
import { FinancePortfolioService } from '../application/finance-portfolio.service.js';

const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const dateIn = (offsetDays: number) => new Date(`${isoDay(offsetDays)}T00:00:00Z`);

describe('FinanceCashflowService — GET /finance/cashflow (ADR-043 Phase 4)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `fcf-org-${suffix}`;
  const userId = 'fcf-user-1';

  let cashflow: FinanceCashflowService;
  let portfolio: FinancePortfolioService;
  let finance: RequestIdentity;
  let clientId: string;
  let supplierId: string;
  let projA: string;
  let projB: string;
  let projS: string;

  async function makeProject(code: string, currency = 'USD') {
    return (
      await prisma.project.create({
        data: { organizationId: orgId, code, name: code, currency, status: 'ACTIVE', createdBy: userId },
      })
    ).id;
  }

  async function makeContract(projectId: string, value: number, currency = 'USD', status = 'ACTIVE') {
    const boq = await prisma.boq.create({ data: { organizationId: orgId, projectId, currency } });
    const ver = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });
    return (
      await prisma.contract.create({
        data: {
          organizationId: orgId,
          projectId,
          clientId,
          boqVersionId: ver.id,
          contractNumber: `CT-${projectId.slice(-6)}`,
          contractValue: new Decimal(value),
          baseContractValue: new Decimal(value),
          currency,
          status: status as never,
          billingModel: 'MILESTONE' as never,
          paymentTerms: '30 days',
          createdBy: userId,
        },
      })
    ).id;
  }

  async function makeStage(contractId: string, pct: string, sortOrder: number, dueDate: Date | null) {
    return (
      await prisma.contractPaymentInstallment.create({
        data: {
          contractId,
          name: `Stage ${sortOrder}`,
          sortOrder,
          percentage: new Decimal(pct),
          triggerType: dueDate ? 'TIME_BASED' : 'MILESTONE',
          dueDate,
        },
      })
    ).id;
  }

  async function makeInvoice(
    projectId: string,
    contractId: string,
    opts: { total: number; outstanding: number; dueDate: Date; installmentId?: string; draft?: boolean; currency?: string },
  ) {
    await prisma.clientInvoice.create({
      data: {
        organizationId: orgId,
        clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-08-01'),
        dueDate: opts.dueDate,
        subtotal: new Decimal(opts.total),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(opts.total),
        outstandingAmount: new Decimal(opts.outstanding),
        currencyCode: opts.currency ?? 'USD',
        billingAddressSnapshot: {},
        postingStatus: opts.draft ? 'NOT_POSTED' : 'POSTED',
        documentStatus: opts.draft ? 'DRAFT' : 'APPROVED',
        createdBy: userId,
        ...(opts.installmentId ? { sourceInstallmentId: opts.installmentId } : {}),
      },
    });
  }

  async function makeBill(opts: { header: string | null; lines: string[]; outstanding: number; dueDate: Date; posted?: boolean }) {
    const n = randomUUID().slice(0, 8);
    await prisma.supplierBill.create({
      data: {
        organizationId: orgId,
        supplierId,
        supplierInvoiceNumber: `SI-${n}`,
        supplierInvoiceNumberNorm: `SI${n}`,
        billDate: new Date('2026-08-20'),
        dueDate: opts.dueDate,
        currencyCode: 'USD',
        projectId: opts.header,
        subtotal: new Decimal(opts.outstanding),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(opts.outstanding),
        outstandingAmount: new Decimal(opts.outstanding),
        documentStatus: 'APPROVED',
        postingStatus: opts.posted === false ? 'NOT_POSTED' : 'POSTED',
        createdBy: userId,
        lines: {
          create: opts.lines.map((projectId, i) => ({
            lineNumber: i + 1,
            description: 'line',
            netAmount: new Decimal(opts.outstanding / opts.lines.length),
            vatAmount: new Decimal(0),
            grossAmount: new Decimal(opts.outstanding / opts.lines.length),
            expenseProfileCode: 'TEST',
            projectId,
          })),
        },
      },
    });
  }

  async function makeLedger(projectId: string, stage: 'COMMITTED' | 'ACCRUED' | 'ACTUAL', amount: number, purchaseOrderId?: string) {
    await prisma.commitmentLedgerEntry.create({
      data: {
        organizationId: orgId,
        projectId,
        purchaseOrderId: purchaseOrderId ?? null,
        stage,
        amount: new Decimal(amount),
        currencyCode: 'USD',
        reportingAmount: new Decimal(amount),
        sourceDocumentType: 'PURCHASE_ORDER_REVISION',
        sourceDocumentId: `src-${randomUUID()}`,
        eventType: 'TEST',
        idempotencyKey: `fcf-${randomUUID()}`,
        occurredAt: new Date('2026-08-15'),
        accountingDate: new Date('2026-08-15'),
      },
    });
  }

  async function makePurchaseOrder(expectedDeliveryDate: Date | null) {
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: orgId, supplierId, poNumber: `PO-${randomUUID().slice(0, 8)}`, createdBy: userId },
    });
    const rev = await prisma.purchaseOrderRevision.create({
      data: {
        purchaseOrderId: po.id,
        revisionNumber: 1,
        status: 'ACTIVE',
        currencyCode: 'USD',
        effectiveFrom: new Date('2026-08-01'),
        expectedDeliveryDate,
        createdBy: userId,
      },
    });
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { currentRevisionId: rev.id } });
    return po.id;
  }

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertMember: async () => undefined,
      accessibleProjectIds: async (identity: RequestIdentity) =>
        identity.roles.includes('Project Manager') ? [projA] : undefined,
    } as unknown as ProjectAccessService;
    const readiness = { getReadiness: async () => ({ ready: true, blockers: [] }) } as unknown as AccountingReadinessService;
    const commercialRepo = new CommercialPrismaRepository();
    const procurementRepo = new ProjectProcurementRepository();
    cashflow = new FinanceCashflowService(tenancy, projectAccess, commercialRepo, procurementRepo);
    portfolio = new FinancePortfolioService(
      tenancy,
      projectAccess,
      readiness,
      commercialRepo,
      procurementRepo,
      new ProjectFinancialPositionRepository(),
    );
    finance = {
      userId,
      activeOrganizationId: orgId,
      tenantSlug: `fcf-${suffix}`,
      roles: ['Finance Officer'],
      permissions: [PERMISSIONS.financialPositionView, PERMISSIONS.boqViewMargin, PERMISSIONS.accountingView],
    };

    await prisma.organization.create({ data: { id: orgId, name: `Fcf ${suffix}`, slug: `fcf-${suffix}`, status: 'ACTIVE' } });
    clientId = (await prisma.client.create({ data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Client' } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { organizationId: orgId, code: `SP-${suffix.slice(-6)}`, name: 'Supplier', paymentTermsDays: 30 },
      })
    ).id;

    projA = await makeProject(`FCF-A-${suffix.slice(-6)}`);
    projB = await makeProject(`FCF-B-${suffix.slice(-6)}`);
    projS = await makeProject(`FCF-S-${suffix.slice(-6)}`, 'SOS');

    // projA — contract 100,000, terms "30 days".
    const ctrA = await makeContract(projA, 100_000);
    const s1 = await makeStage(ctrA, '0.4', 1, null); // billed (posted invoice) → only in invoices
    const s2 = await makeStage(ctrA, '0.3', 2, dateIn(10)); // dated, draft invoice → unbilled, date + 30
    await makeStage(ctrA, '0.2', 3, null); // no date, not ready → undated
    await makeInvoice(projA, ctrA, { total: 40_000, outstanding: 25_000, dueDate: dateIn(-20), installmentId: s1 }); // overdue
    await makeInvoice(projA, ctrA, { total: 5_000, outstanding: 5_000, dueDate: dateIn(14) });
    await makeInvoice(projA, ctrA, { total: 30_000, outstanding: 30_000, dueDate: dateIn(40), installmentId: s2, draft: true });

    // projB — a DRAFT contract: its stages are not forecast.
    const ctrB = await makeContract(projB, 50_000, 'USD', 'DRAFT');
    await makeStage(ctrB, '1', 1, dateIn(5));

    // projS — an SOS project: never added to USD.
    const ctrS = await makeContract(projS, 10_000, 'SOS');
    await makeInvoice(projS, ctrS, { total: 2_000, outstanding: 2_000, dueDate: dateIn(3), currency: 'SOS' });

    // Supplier bills: one on A overdue, one shared A+B by line, one unposted (ignored).
    await makeBill({ header: projA, lines: [projA], outstanding: 7_000, dueDate: dateIn(-5) });
    await makeBill({ header: null, lines: [projA, projB], outstanding: 4_000, dueDate: dateIn(21) });
    await makeBill({ header: projA, lines: [projA], outstanding: 9_999, dueDate: dateIn(21), posted: false });

    // Commitments on A: PO1 dated (delivery in 20 days + 30 days terms) 12,000 open; PO2 no delivery
    // date → undated 3,000; PO3 fully billed → nothing; ledger without an order → undated 1,000.
    const po1 = await makePurchaseOrder(dateIn(20));
    const po2 = await makePurchaseOrder(null);
    const po3 = await makePurchaseOrder(dateIn(5));
    await makeLedger(projA, 'COMMITTED', 8_000, po1);
    await makeLedger(projA, 'ACCRUED', 4_000, po1);
    await makeLedger(projA, 'ACTUAL', 6_000, po1);
    await makeLedger(projA, 'COMMITTED', 3_000, po2);
    await makeLedger(projA, 'ACTUAL', 2_000, po3);
    await makeLedger(projA, 'COMMITTED', 1_000);
  }, 60_000);

  afterAll(async () => {
    await prisma.commitmentLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.purchaseOrder.updateMany({ where: { organizationId: orgId }, data: { currentRevisionId: null } });
    await prisma.purchaseOrderRevision.deleteMany({ where: { purchaseOrder: { organizationId: orgId } } });
    await prisma.purchaseOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.supplierBill.deleteMany({ where: { organizationId: orgId } });
    await prisma.supplier.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  }, 30_000);

  const usd = (list: CashflowCurrencyForecast[]) => list.find((c) => c.currency === 'USD')!;

  it('reconciles with the portfolio: invoice inflows = outstanding, bill outflows = bills to pay (per currency)', async () => {
    const [forecast, rows] = await Promise.all([cashflow.forecast(finance), portfolio.list(finance)]);
    for (const totals of rows.totals) {
      const f = forecast.currencies.find((c) => c.currency === totals.currency);
      expect(f?.totals.inflows.fromInvoices ?? '0.00').toBe(totals.outstanding);
      expect(f?.totals.outflows.fromSupplierBills ?? '0.00').toBe(totals.billsToPay.amount);
    }
    expect(usd(forecast.currencies).totals.inflows.fromInvoices).toBe('30000.00');
    expect(usd(forecast.currencies).totals.outflows.fromSupplierBills).toBe('11000.00'); // shared bill once
    expect(forecast.currencies.map((c) => c.currency)).toEqual(['SOS', 'USD']);
  });

  it('reconciles one project with its portfolio row', async () => {
    const [forecast, one] = await Promise.all([
      cashflow.forecast(finance, { projectId: projA }),
      portfolio.getOne(finance, projA),
    ]);
    const f = usd(forecast.currencies);
    expect(f.totals.inflows.fromInvoices).toBe(one.item.outstanding);
    expect(f.totals.outflows.fromSupplierBills).toBe(one.item.billsToPay.amount);
    expect(forecast.projectId).toBe(projA);
  });

  it('places overdue items in NOW and dates unbilled stages by schedule date + contract terms', async () => {
    const forecast = await cashflow.forecast(finance, { projectId: projA, bucket: 'WEEK', to: isoDay(120) });
    const f = usd(forecast.currencies);
    const now = f.buckets.find((b) => b.kind === 'NOW')!;
    expect(now.inflows.fromInvoices).toBe('25000.00');
    expect(now.outflows.fromSupplierBills).toBe('7000.00');

    // Stage 2 (30,000, draft invoice not yet issued): its date + 30 days.
    const stageDue = dateIn(40);
    const stageBucket = f.buckets.find(
      (b) => b.kind === 'PERIOD' && b.start! <= isoDay(40) && b.end! >= stageDue.toISOString().slice(0, 10),
    )!;
    expect(stageBucket.inflows.fromUnbilledStages).toBe('30000.00');

    const undated = f.buckets.find((b) => b.kind === 'UNDATED')!;
    expect(undated.inflows.fromUnbilledStages).toBe('20000.00'); // stage 3 — no date, never guessed
    expect(undated.outflows.fromOpenCommitments).toBe('4000.00'); // PO2 (no delivery date) + no-order ledger
    expect(undated.cumulativeNet).toBeNull();

    // Billed stage 1 is not forecast twice; the DRAFT contract on projB is not in A's view either.
    expect(f.totals.inflows.fromUnbilledStages).toBe('50000.00');
    // PO1: committed + accrued = 12,000 at delivery (20 days) + 30 days supplier terms.
    const poBucket = f.buckets.find((b) => b.kind === 'PERIOD' && b.start! <= isoDay(50) && b.end! >= isoDay(50))!;
    expect(poBucket.outflows.fromOpenCommitments).toBe('12000.00');
    expect(f.totals.outflows.fromOpenCommitments).toBe('16000.00'); // PO3 fully billed → nothing
  });

  it('respects project access: a member sees only their projects', async () => {
    const pm: RequestIdentity = { ...finance, roles: ['Project Manager'] };
    const forecast = await cashflow.forecast(pm);
    expect(forecast.currencies.map((c) => c.currency)).toEqual(['USD']);
    // Only projA: the shared bill counts once, with its whole balance (as the portfolio row).
    expect(usd(forecast.currencies).totals.outflows.fromSupplierBills).toBe('11000.00');
  });

  it('redaction (as the portfolio): without the money permissions every figure is null, counts stay', async () => {
    const noMargin: RequestIdentity = { ...finance, permissions: [PERMISSIONS.accountingView] };
    const forecast = await cashflow.forecast(noMargin, { projectId: projA });
    expect(forecast.moneyVisible).toBe(false);
    expect(usd(forecast.currencies).totals.net).toBeNull();
    expect(usd(forecast.currencies).counts.fromInvoices).toBe(2);
  });
});
