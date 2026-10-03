/**
 * ADR-043 — FinancePortfolioService live-DB tests.
 *
 * The portfolio must not have its own formulas: a row's figures are asserted EQUAL to the
 * per-project read models for the same project —
 *   billed / collected / outstanding / overdue  ← CommercialService.getOverview().financialPosition
 *   costToDate / committedCost / margin         ← ProjectFinanceOverviewService.getOverview()
 * plus ready-to-bill, bills-to-pay, queue filters, search, project access and redaction.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { AccountingReadinessService } from '../../../accounting/accounting-core/application/accounting-readiness.service.js';
import type { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import type { CollectionEventsService } from '../../../accounting/accounts-receivable/application/collection-events.service.js';
import { ProjectFinancialPositionRepository } from '../../../accounting/financial-position/infrastructure/project-financial-position.repository.js';
import { ProjectCostReconciliationService } from '../../../accounting/financial-position/application/project-cost-reconciliation.service.js';
import { ProjectFinanceOverviewService } from '../../../accounting/financial-position/application/project-finance-overview.service.js';
import { ProjectProcurementRepository } from '../../../procurement/project-procurement/infrastructure/project-procurement.repository.js';
import { ProjectProcurementService } from '../../../procurement/project-procurement/application/project-procurement.service.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import { CommercialService } from '../../commercial/application/commercial.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { FinancePortfolioService } from '../application/finance-portfolio.service.js';

const DAY = 86_400_000;

describe('FinancePortfolioService — GET /finance/projects (ADR-043)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `fpf-org-${suffix}`;
  const userId = 'fpf-user-1';

  let portfolio: FinancePortfolioService;
  let commercial: CommercialService;
  let financeOverview: ProjectFinanceOverviewService;
  let finance: RequestIdentity;
  let clientId: string;
  let supplierId: string;

  let projA: string; // the busy project: every source populated
  let projB: string; // no contract; only a shared supplier bill (TO_PAY)
  let projC: string; // contract + one ready stage with only a DRAFT invoice (still TO_BILL)
  let projD: string; // a SOS project — totals never add it to USD

  async function makeProject(code: string, name: string, currency = 'USD'): Promise<string> {
    const p = await prisma.project.create({
      data: { organizationId: orgId, code, name, currency, status: 'ACTIVE', createdBy: userId },
    });
    return p.id;
  }

  async function makeContract(projectId: string, value: number, currency = 'USD'): Promise<string> {
    const boq = await prisma.boq.create({ data: { organizationId: orgId, projectId, currency } });
    const ver = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });
    const c = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId,
        boqVersionId: ver.id,
        contractNumber: `CT-${projectId.slice(-6)}`,
        contractValue: new Decimal(value),
        baseContractValue: new Decimal(value),
        currency,
        status: 'ACTIVE',
        billingModel: 'MILESTONE' as never,
        createdBy: userId,
      },
    });
    return c.id;
  }

  async function makeInstallment(contractId: string, name: string, pct: string, sortOrder: number, ready: boolean) {
    const inst = await prisma.contractPaymentInstallment.create({
      data: {
        contractId,
        name,
        sortOrder,
        percentage: new Decimal(pct),
        triggerType: 'MILESTONE',
        milestoneLabel: name,
        readyToBillAt: ready ? new Date('2026-09-01') : null,
      },
    });
    return inst.id;
  }

  async function makeInvoice(
    projectId: string,
    contractId: string,
    opts: { total: number; outstanding: number; dueDate: Date; installmentId?: string; status?: 'POSTED' | 'CANCELLED' | 'DRAFT' },
  ): Promise<string> {
    const cancelled = opts.status === 'CANCELLED';
    const draft = opts.status === 'DRAFT';
    const inv = await prisma.clientInvoice.create({
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
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: cancelled || draft ? 'NOT_POSTED' : 'POSTED',
        documentStatus: cancelled ? 'CANCELLED' : draft ? 'DRAFT' : 'APPROVED',
        createdBy: userId,
        ...(opts.installmentId ? { sourceInstallmentId: opts.installmentId } : {}),
      },
    });
    return inv.id;
  }

  async function makeAllocation(invoiceId: string, amount: number) {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        organizationId: orgId,
        clientId,
        receiptDate: new Date('2026-09-10'),
        accountingDate: new Date('2026-09-10'),
        totalAmount: new Decimal(amount),
        unallocatedAmount: new Decimal(0),
        currencyCode: 'USD',
        postingStatus: 'POSTED',
        createdBy: userId,
      },
    });
    await prisma.clientReceiptAllocation.create({
      data: {
        organizationId: orgId,
        paymentReceiptId: receipt.id,
        clientInvoiceId: invoiceId,
        allocatedAmount: new Decimal(amount),
        allocationDate: new Date('2026-09-10'),
        postingStatus: 'POSTED',
        createdBy: userId,
      },
    });
  }

  async function makeLedger(projectId: string, stage: 'COMMITTED' | 'ACCRUED' | 'ACTUAL', amount: number) {
    await prisma.commitmentLedgerEntry.create({
      data: {
        organizationId: orgId,
        projectId,
        stage,
        amount: new Decimal(amount),
        currencyCode: 'USD',
        reportingAmount: new Decimal(amount),
        sourceDocumentType: 'PURCHASE_ORDER_REVISION',
        sourceDocumentId: `src-${randomUUID()}`,
        eventType: 'TEST',
        idempotencyKey: `fpf-${randomUUID()}`,
        occurredAt: new Date('2026-08-15'),
        accountingDate: new Date('2026-08-15'),
      },
    });
  }

  async function makeAccount(code: string, normalBalance: 'DEBIT' | 'CREDIT', accountClass: string, subtype: string) {
    const account = await prisma.account.create({
      data: { id: `${orgId}-${code}`, organizationId: orgId, code, normalBalance: normalBalance as never, createdBy: userId },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: account.id,
        versionNumber: 1,
        name: `${code} Account`,
        accountClass: accountClass as never,
        accountSubtype: subtype as never,
        isPostingAllowed: true,
        isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED' as never,
        effectiveFrom: new Date('2025-01-01'),
        effectiveTo: null,
        changedBy: userId,
      },
    });
    return account.id;
  }

  async function makeBill(opts: {
    headerProjectId: string | null;
    lineProjectIds: (string | null)[];
    total: number;
    outstanding: number;
    posted: boolean;
  }) {
    const n = randomUUID().slice(0, 8);
    await prisma.supplierBill.create({
      data: {
        organizationId: orgId,
        supplierId,
        supplierInvoiceNumber: `SI-${n}`,
        supplierInvoiceNumberNorm: `SI${n}`,
        billDate: new Date('2026-08-20'),
        dueDate: new Date('2026-09-20'),
        currencyCode: 'USD',
        projectId: opts.headerProjectId,
        subtotal: new Decimal(opts.total),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(opts.total),
        outstandingAmount: new Decimal(opts.outstanding),
        documentStatus: 'APPROVED',
        postingStatus: opts.posted ? 'POSTED' : 'NOT_POSTED',
        createdBy: userId,
        lines: {
          create: opts.lineProjectIds.map((projectId, i) => ({
            lineNumber: i + 1,
            description: 'line',
            netAmount: new Decimal(opts.total / opts.lineProjectIds.length),
            vatAmount: new Decimal(0),
            grossAmount: new Decimal(opts.total / opts.lineProjectIds.length),
            expenseProfileCode: 'TEST',
            projectId,
          })),
        },
      },
    });
  }

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertMember: async () => undefined,
      assertContract: async () => undefined,
      // A Project Manager sees only projA (stands in for membership); everyone else bypasses.
      accessibleProjectIds: async (identity: RequestIdentity) =>
        identity.roles.includes('Project Manager') ? [projA] : undefined,
    } as unknown as ProjectAccessService;
    // The ledger is treated as able to post, so margin is computed on both sides.
    const readiness = {
      getReadiness: async () => ({ ready: true, blockers: [] }),
    } as unknown as AccountingReadinessService;

    const commercialRepo = new CommercialPrismaRepository();
    const procurementRepo = new ProjectProcurementRepository();
    const financeRepo = new ProjectFinancialPositionRepository();

    commercial = new CommercialService(
      tenancy,
      projectAccess,
      commercialRepo,
      new VariationOrderPrismaRepository(),
      {} as unknown as BoqVersioningService,
      {} as unknown as CollectionEventsService,
    );
    financeOverview = new ProjectFinanceOverviewService(
      tenancy,
      projectAccess,
      new ProjectProcurementService(tenancy, projectAccess, procurementRepo),
      new ProjectCostReconciliationService(tenancy, financeRepo),
      readiness,
      financeRepo,
    );
    portfolio = new FinancePortfolioService(
      tenancy,
      projectAccess,
      readiness,
      commercialRepo,
      procurementRepo,
      financeRepo,
    );

    finance = {
      userId,
      activeOrganizationId: orgId,
      tenantSlug: `fpf-${suffix}`,
      roles: ['Finance Officer'],
      permissions: [PERMISSIONS.financialPositionView, PERMISSIONS.boqViewMargin, PERMISSIONS.accountingView],
    };

    await prisma.organization.create({
      data: { id: orgId, name: `Fpf Org ${suffix}`, slug: `fpf-${suffix}`, status: 'ACTIVE' },
    });
    clientId = (
      await prisma.client.create({ data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Hodan Trading' } })
    ).id;
    supplierId = (
      await prisma.supplier.create({ data: { organizationId: orgId, code: `SP-${suffix.slice(-6)}`, name: 'Supplier' } })
    ).id;

    projA = await makeProject(`FPF-A-${suffix.slice(-6)}`, 'Mogadishu clinic');
    projB = await makeProject(`FPF-B-${suffix.slice(-6)}`, 'Warehouse');
    projC = await makeProject(`FPF-C-${suffix.slice(-6)}`, 'School');

    // ── projA: contract 500,000 with four stages ──────────────────────────────────
    const ctrA = await makeContract(projA, 500_000);
    const inst1 = await makeInstallment(ctrA, 'Advance', '0.3', 1, true); // ready + invoiced
    await makeInstallment(ctrA, 'Foundation', '0.2', 2, true); // ready, not invoiced → 100,000
    await makeInstallment(ctrA, 'Roof', '0.4', 3, false); // not ready
    const inst4 = await makeInstallment(ctrA, 'Handover', '0.1', 4, true); // ready, only a cancelled draft → 50,000

    const past = new Date(Date.now() - 40 * DAY);
    const future = new Date(Date.now() + 20 * DAY);
    // 150,000 overdue invoice: 10,000 credit note, 50,000 collected → outstanding 90,000.
    const inv1 = await makeInvoice(projA, ctrA, { total: 150_000, outstanding: 90_000, dueDate: past, installmentId: inst1 });
    await prisma.creditNote.create({
      data: {
        organizationId: orgId,
        invoiceId: inv1,
        reason: 'CORRECTION',
        netAmount: new Decimal(10_000),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(10_000),
        accountingDate: new Date('2026-09-05'),
        postingStatus: 'POSTED',
        createdBy: userId,
      },
    });
    await makeAllocation(inv1, 50_000);
    await makeInvoice(projA, ctrA, { total: 20_000, outstanding: 20_000, dueDate: future });
    await makeInvoice(projA, ctrA, { total: 50_000, outstanding: 50_000, dueDate: future, installmentId: inst4, status: 'CANCELLED' });

    // Cost: 80,000 committed, 30,000 accrued, 60,000 actual.
    await makeLedger(projA, 'COMMITTED', 80_000);
    await makeLedger(projA, 'ACCRUED', 30_000);
    await makeLedger(projA, 'ACTUAL', 60_000);

    // GL: 160,000 revenue and 60,000 cost on projA (bank leg unattributed). Balanced: 160 = 160.
    const rev = await makeAccount('REV', 'CREDIT', 'INCOME', 'PROJECT_REVENUE');
    const exp = await makeAccount('EXP', 'DEBIT', 'EXPENSE', 'ADMINISTRATIVE_EXPENSE');
    const bank = await makeAccount('BNK', 'DEBIT', 'ASSET', 'CASH_AND_BANK');
    const line = (n: number, accountId: string, code: string, debit: number, credit: number, projectId: string | null) => ({
      lineNumber: n,
      accountId,
      accountCodeSnapshot: code,
      accountNameSnapshot: code,
      accountVersionNumber: 1,
      debitAmount: new Decimal(debit),
      creditAmount: new Decimal(credit),
      postingOrigin: 'MANUAL' as never,
      projectId,
    });
    await prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        journalCategory: 'GENERAL' as never,
        entryPurpose: 'NORMAL' as never,
        status: 'POSTED' as never,
        documentDate: new Date('2026-08-30'),
        accountingDate: new Date('2026-08-30'),
        description: 'test',
        currencyCode: 'USD',
        createdBy: userId,
        lines: {
          create: [
            line(1, exp, 'EXP', 60_000, 0, projA),
            line(2, bank, 'BNK', 100_000, 0, null),
            line(3, rev, 'REV', 0, 160_000, projA),
          ],
        },
      },
    });

    // Supplier bills.
    await makeBill({ headerProjectId: projA, lineProjectIds: [projA], total: 25_000, outstanding: 25_000, posted: true });
    await makeBill({ headerProjectId: projA, lineProjectIds: [projA], total: 5_000, outstanding: 0, posted: true }); // paid
    await makeBill({ headerProjectId: projA, lineProjectIds: [projA], total: 40_000, outstanding: 40_000, posted: false }); // unposted
    await makeBill({ headerProjectId: null, lineProjectIds: [projA, projB], total: 10_000, outstanding: 10_000, posted: true }); // shared

    // ── projC: a ready stage whose invoice is only a DRAFT — Finance still has to issue it ──
    const ctrC = await makeContract(projC, 200_000);
    const instC = await makeInstallment(ctrC, 'Mobilisation', '0.5', 1, true);
    await makeInvoice(projC, ctrC, { total: 100_000, outstanding: 100_000, dueDate: future, installmentId: instC, status: 'DRAFT' });

    // ── projD: another currency ──────────────────────────────────────────────────────
    projD = await makeProject(`FPF-D-${suffix.slice(-6)}`, 'Hargeisa depot', 'SOS');
    await makeContract(projD, 1_000, 'SOS');
  }, 60_000);

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entry: { organizationId: orgId } } });
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.accountVersion.deleteMany({ where: { account: { organizationId: orgId } } });
    await prisma.account.deleteMany({ where: { organizationId: orgId } });
    await prisma.supplierBill.deleteMany({ where: { organizationId: orgId } });
    await prisma.supplier.deleteMany({ where: { organizationId: orgId } });
    await prisma.commitmentLedgerEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.creditNote.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientReceiptAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.paymentReceipt.deleteMany({ where: { organizationId: orgId } });
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

  const row = async (projectId: string, identity = finance) => {
    const res = await portfolio.list(identity);
    const r = res.items.find((i) => i.projectId === projectId);
    if (!r) throw new Error(`row ${projectId} missing`);
    return r;
  };

  it('FPF-1: a row equals the Commercial Overview and Finance Overview for the same project', async () => {
    const [r, overview, fin] = await Promise.all([
      row(projA),
      commercial.getOverview(finance, projA),
      financeOverview.getOverview(finance, projA),
    ]);

    expect(r.billed).toBe(overview.financialPosition.netBilled);
    expect(r.collected).toBe(overview.financialPosition.collected);
    expect(r.outstanding).toBe(overview.financialPosition.outstanding);
    expect(r.overdue).toBe(overview.financialPosition.overdue);
    expect(r.contractValue).toBe(overview.contract.currentContractValue);
    expect(r.costToDate).toBe(fin.costPosition.actual);
    expect(r.committedCost).toBe(fin.costPosition.committedToDate);
    expect(r.margin).toBe(fin.accountingPosition.marginPercent);

    // And the figures themselves, so equality is not equality of two wrong answers.
    expect(r.billed).toBe('160000.00'); // 150,000 + 20,000 − 10,000 credit note
    expect(r.collected).toBe('50000.00');
    expect(r.outstanding).toBe('110000.00');
    expect(r.overdue).toBe('90000.00');
    expect(r.contractValue).toBe('500000.00');
    expect(r.costToDate).toBe('60000.00');
    expect(r.committedCost).toBe('170000.00');
    expect(r.margin).toBe(62.5); // (160,000 − 60,000) / 160,000
    expect(r.clientName).toBe('Hodan Trading');
    expect(r.currency).toBe('USD');
  });

  it('FPF-2: ready to bill = ready stages with no POSTED invoice (a cancelled draft does not bill)', async () => {
    const r = await row(projA);
    // 20% + 10% of 500,000; the POSTED stage-1 invoice removed stage 1; no prepared drafts.
    expect(r.readyToBill).toEqual({ count: 2, draftCount: 0, amount: '150000.00' });
  });

  it('FPF-2b: a ready stage whose invoice is only a DRAFT stays To bill, marked draft prepared', async () => {
    const r = await row(projC);
    expect(r.readyToBill).toEqual({ count: 1, draftCount: 1, amount: '100000.00' });
    const toBill = await portfolio.list(finance, { queue: 'TO_BILL' });
    expect(toBill.items.map((i) => i.projectId).sort()).toEqual([projA, projC].sort());
  });

  it('FPF-3: overdue invoices count and age', async () => {
    const r = await row(projA);
    expect(r.overdueInvoices.count).toBe(1);
    expect(r.overdueInvoices.oldestDaysPastDue).toBeGreaterThanOrEqual(39);
    expect((await row(projC)).overdueInvoices).toEqual({ count: 0, oldestDaysPastDue: null });
  });

  it('FPF-4: bills to pay = POSTED bills with a balance, matched by header or line', async () => {
    expect((await row(projA)).billsToPay).toEqual({ count: 2, amount: '35000.00' });
    expect((await row(projB)).billsToPay).toEqual({ count: 1, amount: '10000.00' });
  });

  it('FPF-5: queue filters and counts', async () => {
    const all = await portfolio.list(finance);
    expect(all.queueCounts).toEqual({ ALL: 4, TO_BILL: 2, OVERDUE: 1, TO_PAY: 2 });
    const overdue = await portfolio.list(finance, { queue: 'OVERDUE' });
    expect(overdue.items.map((i) => i.projectId)).toEqual([projA]);
    const toPay = await portfolio.list(finance, { queue: 'TO_PAY' });
    expect(toPay.items.map((i) => i.projectId).sort()).toEqual([projA, projB].sort());
    // The shared bill is owed once: 25,000 + 10,000.
    expect(toPay.totals).toHaveLength(1);
    expect(toPay.totals[0]!.billsToPay).toEqual({ count: 2, amount: '35000.00' });
  });

  it('FPF-6: search matches code, name or client; status filters', async () => {
    const byName = await portfolio.list(finance, { search: 'clinic' });
    expect(byName.items.map((i) => i.projectId)).toEqual([projA]);
    const byClient = await portfolio.list(finance, { search: 'hodan' });
    expect(byClient.items.map((i) => i.projectId).sort()).toEqual([projA, projC, projD].sort());
    const closed = await portfolio.list(finance, { status: 'CLOSED' });
    expect(closed.items).toEqual([]);
  });

  it('FPF-7: totals sum the visible rows per currency — never across currencies', async () => {
    const all = await portfolio.list(finance);
    expect(all.totals.map((t) => t.currency)).toEqual(['SOS', 'USD']);
    const usd = all.totals.find((t) => t.currency === 'USD')!;
    const sos = all.totals.find((t) => t.currency === 'SOS')!;
    expect(usd.projectCount).toBe(3);
    expect(usd.contractValue).toBe('700000.00');
    expect(usd.billed).toBe('160000.00');
    expect(usd.readyToBill).toEqual({ count: 3, draftCount: 1, amount: '250000.00' });
    expect(sos.projectCount).toBe(1);
    expect(sos.contractValue).toBe('1000.00');
    expect(sos.billed).toBe('0.00');
  });

  it('FPF-7b: GET /finance/projects/:id returns the same row as the list', async () => {
    const one = await portfolio.getOne(finance, projA);
    expect(one.item).toEqual(await row(projA));
    await expect(
      portfolio.getOne({ ...finance, activeOrganizationId: `other-${suffix}` }, projA),
    ).rejects.toThrow('not found');
  });

  it('FPF-8: project access — a member-scoped caller sees only their projects', async () => {
    const pm: RequestIdentity = { ...finance, roles: ['Project Manager'] };
    const res = await portfolio.list(pm);
    expect(res.items.map((i) => i.projectId)).toEqual([projA]);
  });

  it('FPF-9: org-scoped — another organisation sees none of these projects', async () => {
    const res = await portfolio.list({ ...finance, activeOrganizationId: `other-${suffix}` });
    expect(res.items).toEqual([]);
  });

  it('FPF-10: redaction — without the money/margin permissions every figure is null, counts stay', async () => {
    const blind: RequestIdentity = { ...finance, permissions: [PERMISSIONS.accountingView] };
    const res = await portfolio.list(blind);
    expect(res.moneyVisible).toBe(false);
    expect(res.marginVisible).toBe(false);
    const r = res.items.find((i) => i.projectId === projA)!;
    expect(r.billed).toBeNull();
    expect(r.contractValue).toBeNull();
    expect(r.costToDate).toBeNull();
    expect(r.margin).toBeNull();
    expect(r.readyToBill).toEqual({ count: 2, draftCount: 0, amount: null });
    expect(res.totals.every((t) => t.billed === null)).toBe(true);
  });

  it('FPF-11: margin follows the margin permission (cost visible, margin withheld)', async () => {
    // view:financial-position implies the margin tier (resolveBoqVisibility); a caller with only
    // the margin tier but not view:financial-position sees no cost and no margin.
    const marginOnly: RequestIdentity = { ...finance, permissions: [PERMISSIONS.boqViewMargin] };
    const res = await portfolio.list(marginOnly);
    const r = res.items.find((i) => i.projectId === projA)!;
    expect(r.margin).toBeNull();
    expect(r.costToDate).toBeNull();
  });
});
