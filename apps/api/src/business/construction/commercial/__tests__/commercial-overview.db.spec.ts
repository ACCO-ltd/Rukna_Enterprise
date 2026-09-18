/**
 * Slice 7 — CommercialService.getOverview live-DB tests.
 *
 * Financial scenarios A–G verify the reconciliation invariant:
 *   netBilled − collected = outstanding (Σ invoice.outstandingAmount)
 *
 * Current-position tests verify OverviewCycleStage derivation from the
 * MILESTONE payment schedule.
 *
 * Attention tests verify per-invoice dedup rules:
 *   OPEN_DISPUTE > MISSED_PROMISE > ISSUED_NOT_SENT > OVERDUE_INVOICE
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import type { CollectionEventsService } from '../../../accounting/accounts-receivable/application/collection-events.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialService } from '../application/commercial.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';

describe('CommercialService — getOverview (Slice 7)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `cov-org-${suffix}`;
  const userId = 'cov-user-1';

  let service: CommercialService;
  let identity: RequestIdentity;
  let clientId: string;

  // ─── Project IDs (one per isolated scenario) ─────────────────────────────
  let projA: string; // Scenario A — no contract
  let projB: string; // Scenario B — contract, no invoices
  let projC: string; // Scenario C — one POSTED invoice
  let projD: string; // Scenario D — partial payment
  let projE: string; // Scenario E — credit note
  let projF: string; // Scenario F — separate charge
  let projG: string; // Scenario G — overdue mix
  // Current-position scenarios
  let projReview: string;      // REVIEW_FOR_BILLING
  let projReady: string;       // READY_TO_BILL
  let projAllBilled: string;   // ALL_BILLED
  let projAllComplete: string; // ALL_COMPLETE
  // Attention scenarios
  let projIssuedNotSent: string;
  let projDelivered: string;
  let projOverdue: string;
  let projNullDue: string;
  let projPaidPastDue: string;
  let projMissedPromise: string;
  let projOpenDispute: string;
  let projResolvedDispute: string;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async function makeProject(code: string): Promise<string> {
    const p = await prisma.project.create({
      data: { organizationId: orgId, code, name: code, currency: 'USD', createdBy: userId },
    });
    return p.id;
  }

  async function makeContract(
    projectId: string,
    opts: { value?: number; billingModel?: string } = {},
  ): Promise<string> {
    const boq = await prisma.boq.create({
      data: { organizationId: orgId, projectId, currency: 'USD' },
    });
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
        contractValue: new Decimal(opts.value ?? 500_000),
        baseContractValue: new Decimal(opts.value ?? 500_000),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: (opts.billingModel ?? 'MILESTONE') as never,
        createdBy: userId,
      },
    });
    return c.id;
  }

  async function makeInstallment(
    contractId: string,
    name: string,
    pct: string,
    sortOrder: number,
    opts: { readyToBillAt?: Date } = {},
  ): Promise<string> {
    const inst = await prisma.contractPaymentInstallment.create({
      data: {
        contractId,
        name,
        sortOrder,
        percentage: new Decimal(pct),
        triggerType: 'MILESTONE',
        milestoneLabel: name,
        readyToBillAt: opts.readyToBillAt ?? null,
      },
    });
    return inst.id;
  }

  async function makePostedInvoice(
    projectId: string,
    contractId: string,
    opts: {
      total: number;
      outstanding?: number;
      dueDate?: Date | null;
      sourceInstallmentId?: string;
    },
  ): Promise<string> {
    const total = opts.total;
    const outstanding = opts.outstanding ?? total;
    const inv = await prisma.clientInvoice.create({
      data: {
        organizationId: orgId,
        clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        ...(opts.dueDate !== undefined
          ? { dueDate: opts.dueDate }
          : { dueDate: new Date('2026-10-31') }),
        subtotal: new Decimal(total),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(total),
        outstandingAmount: new Decimal(outstanding),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
        createdBy: userId,
        ...(opts.sourceInstallmentId ? { sourceInstallmentId: opts.sourceInstallmentId } : {}),
      },
    });
    return inv.id;
  }

  async function makePostedCreditNote(invoiceId: string, amount: number): Promise<void> {
    await prisma.creditNote.create({
      data: {
        organizationId: orgId,
        invoiceId,
        reason: 'CORRECTION',
        netAmount: new Decimal(amount),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(amount),
        accountingDate: new Date('2026-09-05'),
        postingStatus: 'POSTED',
        createdBy: userId,
      },
    });
  }

  async function makePostedAllocation(invoiceId: string, amount: number): Promise<void> {
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

  async function makeDelivery(invoiceId: string): Promise<void> {
    await prisma.clientInvoiceDelivery.create({
      data: {
        organizationId: orgId,
        invoiceId,
        method: 'EMAIL',
        sentAt: new Date('2026-09-02'),
        sentBy: userId,
      },
    });
  }

  async function makePromise(invoiceId: string, promisedDate: Date): Promise<void> {
    await prisma.invoicePaymentPromise.create({
      data: {
        organizationId: orgId,
        invoiceId,
        promisedDate,
        outstandingAtPromise: new Decimal(20_000),
        recordedBy: userId,
      },
    });
  }

  async function makeOpenDispute(invoiceId: string): Promise<void> {
    await prisma.invoiceDispute.create({
      data: {
        organizationId: orgId,
        invoiceId,
        reason: 'PRICE_ERROR',
        openedBy: userId,
        resolvedAt: null,
      },
    });
  }

  async function makeResolvedDispute(invoiceId: string): Promise<void> {
    await prisma.invoiceDispute.create({
      data: {
        organizationId: orgId,
        invoiceId,
        reason: 'PRICE_ERROR',
        openedBy: userId,
        resolvedAt: new Date('2026-09-15'),
        resolvedBy: userId,
        resolutionNote: 'Resolved',
      },
    });
  }

  // ─── Test environment ─────────────────────────────────────────────────────

  beforeAll(async () => {
    // ── Service ──────────────────────────────────────────────────────────────
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertMember: async () => undefined,
      assertContract: async () => undefined,
    } as unknown as ProjectAccessService;

    service = new CommercialService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      new VariationOrderPrismaRepository(),
      {} as unknown as BoqVersioningService,      // unused by getOverview
      {} as unknown as CollectionEventsService,   // unused by getOverview
    );

    identity = {
      userId,
      activeOrganizationId: orgId,
      tenantSlug: `cov-${suffix}`,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.contractsManage,
        PERMISSIONS.financialPositionView,
      ],
    };

    // ── Org + shared client ───────────────────────────────────────────────────
    await prisma.organization.create({
      data: { id: orgId, name: `Cov Org ${suffix}`, slug: `cov-${suffix}`, status: 'ACTIVE' },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Test Client' },
    });
    clientId = client.id;

    // ── Scenario A — no contract ─────────────────────────────────────────────
    projA = await makeProject(`COV-A-${suffix.slice(-6)}`);
    // (no contract created)

    // ── Scenario B — contract, no invoices ───────────────────────────────────
    projB = await makeProject(`COV-B-${suffix.slice(-6)}`);
    await makeContract(projB);

    // ── Scenario C — one POSTED invoice (105,000) ────────────────────────────
    projC = await makeProject(`COV-C-${suffix.slice(-6)}`);
    const ctrC = await makeContract(projC);
    await makePostedInvoice(projC, ctrC, { total: 105_000 });

    // ── Scenario D — partial payment (105,000 issued, 40,000 collected) ──────
    projD = await makeProject(`COV-D-${suffix.slice(-6)}`);
    const ctrD = await makeContract(projD);
    const invD = await makePostedInvoice(projD, ctrD, { total: 105_000, outstanding: 65_000 });
    await makePostedAllocation(invD, 40_000);

    // ── Scenario E — credit note (105,000 gross, 10,500 CN, 40,000 collected)
    //   outstandingAmount pre-set to 54,500 = 105,000 − 10,500 − 40,000
    projE = await makeProject(`COV-E-${suffix.slice(-6)}`);
    const ctrE = await makeContract(projE);
    const invE = await makePostedInvoice(projE, ctrE, { total: 105_000, outstanding: 54_500 });
    await makePostedCreditNote(invE, 10_500);
    await makePostedAllocation(invE, 40_000);

    // ── Scenario F — separate charge exceeds contract value ───────────────────
    projF = await makeProject(`COV-F-${suffix.slice(-6)}`);
    const ctrF = await makeContract(projF, { value: 500_000 });
    await makePostedInvoice(projF, ctrF, { total: 500_000 });
    await makePostedInvoice(projF, ctrF, { total: 10_500 });   // separate charge

    // ── Scenario G — overdue mix ──────────────────────────────────────────────
    projG = await makeProject(`COV-G-${suffix.slice(-6)}`);
    const ctrG = await makeContract(projG);
    // current (future dueDate, outstanding > 0) — NOT overdue
    await makePostedInvoice(projG, ctrG, {
      total: 20_000,
      dueDate: new Date('2026-12-31'),
    });
    // overdue (past dueDate, outstanding > 0)
    await makePostedInvoice(projG, ctrG, {
      total: 30_000,
      dueDate: new Date('2026-09-01'),
    });
    // paid but past due (outstanding = 0) — NOT overdue
    await makePostedInvoice(projG, ctrG, {
      total: 25_000,
      outstanding: 0,
      dueDate: new Date('2026-09-01'),
    });
    // no due date (outstanding > 0) — NOT overdue
    await makePostedInvoice(projG, ctrG, { total: 15_000, dueDate: null });

    // ── Current position: REVIEW_FOR_BILLING ──────────────────────────────────
    projReview = await makeProject(`COV-H-${suffix.slice(-6)}`);
    const ctrReview = await makeContract(projReview);
    await makeInstallment(ctrReview, 'Mobilisation', '0.4000', 0); // !readyToBill
    await makeInstallment(ctrReview, 'Completion', '0.6000', 1);

    // ── Current position: READY_TO_BILL ──────────────────────────────────────
    projReady = await makeProject(`COV-I-${suffix.slice(-6)}`);
    const ctrReady = await makeContract(projReady);
    await makeInstallment(ctrReady, 'Mobilisation', '0.4000', 0, {
      readyToBillAt: new Date('2026-09-10'),
    });
    await makeInstallment(ctrReady, 'Completion', '0.6000', 1);

    // ── Current position: ALL_BILLED (all installments have invoices, outstanding) ─
    projAllBilled = await makeProject(`COV-J-${suffix.slice(-6)}`);
    const ctrAllBilled = await makeContract(projAllBilled, { value: 100_000 });
    const instAB1 = await makeInstallment(ctrAllBilled, 'Stage 1', '0.4000', 0);
    const instAB2 = await makeInstallment(ctrAllBilled, 'Stage 2', '0.6000', 1);
    await makePostedInvoice(projAllBilled, ctrAllBilled, {
      total: 40_000,
      outstanding: 40_000,
      sourceInstallmentId: instAB1,
    });
    await makePostedInvoice(projAllBilled, ctrAllBilled, {
      total: 60_000,
      outstanding: 60_000,
      sourceInstallmentId: instAB2,
    });

    // ── Current position: ALL_COMPLETE (all installments paid, outstanding = 0) ─
    projAllComplete = await makeProject(`COV-K-${suffix.slice(-6)}`);
    const ctrAllComplete = await makeContract(projAllComplete, { value: 100_000 });
    const instAC1 = await makeInstallment(ctrAllComplete, 'Stage 1', '0.4000', 0);
    const instAC2 = await makeInstallment(ctrAllComplete, 'Stage 2', '0.6000', 1);
    await makePostedInvoice(projAllComplete, ctrAllComplete, {
      total: 40_000,
      outstanding: 0,
      sourceInstallmentId: instAC1,
    });
    await makePostedInvoice(projAllComplete, ctrAllComplete, {
      total: 60_000,
      outstanding: 0,
      sourceInstallmentId: instAC2,
    });

    // ── Attention: ISSUED_NOT_SENT — zero deliveries ──────────────────────────
    projIssuedNotSent = await makeProject(`COV-L-${suffix.slice(-6)}`);
    const ctrL = await makeContract(projIssuedNotSent);
    await makePostedInvoice(projIssuedNotSent, ctrL, {
      total: 20_000,
      dueDate: new Date('2026-12-31'), // future, not overdue
    });

    // ── Attention: delivered invoice — should NOT produce ISSUED_NOT_SENT ────
    projDelivered = await makeProject(`COV-M-${suffix.slice(-6)}`);
    const ctrM = await makeContract(projDelivered);
    const invM = await makePostedInvoice(projDelivered, ctrM, {
      total: 20_000,
      dueDate: new Date('2026-12-31'),
    });
    await makeDelivery(invM);

    // ── Attention: OVERDUE_INVOICE — past dueDate + outstanding > 0 ──────────
    projOverdue = await makeProject(`COV-N-${suffix.slice(-6)}`);
    const ctrN = await makeContract(projOverdue);
    const invN = await makePostedInvoice(projOverdue, ctrN, {
      total: 30_000,
      dueDate: new Date('2026-09-01'), // past
    });
    await makeDelivery(invN); // delivered so ISSUED_NOT_SENT doesn't fire

    // ── Attention: null dueDate — NOT overdue ──────────────────────────────────
    projNullDue = await makeProject(`COV-O-${suffix.slice(-6)}`);
    const ctrO = await makeContract(projNullDue);
    const invO = await makePostedInvoice(projNullDue, ctrO, { total: 15_000, dueDate: null });
    await makeDelivery(invO);

    // ── Attention: outstanding = 0 + past dueDate — NOT overdue ──────────────
    projPaidPastDue = await makeProject(`COV-P-${suffix.slice(-6)}`);
    const ctrP = await makeContract(projPaidPastDue);
    const invP = await makePostedInvoice(projPaidPastDue, ctrP, {
      total: 25_000,
      outstanding: 0,
      dueDate: new Date('2026-09-01'),
    });
    await makeDelivery(invP);

    // ── Attention: MISSED_PROMISE trumps OVERDUE_INVOICE ─────────────────────
    projMissedPromise = await makeProject(`COV-Q-${suffix.slice(-6)}`);
    const ctrQ = await makeContract(projMissedPromise);
    const invQ = await makePostedInvoice(projMissedPromise, ctrQ, {
      total: 20_000,
      dueDate: new Date('2026-09-01'), // past → also overdue
    });
    await makeDelivery(invQ);
    // promise with past date → missed
    await makePromise(invQ, new Date('2026-09-05'));

    // ── Attention: OPEN_DISPUTE trumps MISSED_PROMISE + OVERDUE ──────────────
    projOpenDispute = await makeProject(`COV-R-${suffix.slice(-6)}`);
    const ctrR = await makeContract(projOpenDispute);
    const invR = await makePostedInvoice(projOpenDispute, ctrR, {
      total: 20_000,
      dueDate: new Date('2026-09-01'), // past → also overdue
    });
    await makeDelivery(invR);
    await makePromise(invR, new Date('2026-09-05')); // also missed
    await makeOpenDispute(invR);

    // ── Attention: resolved dispute — no attention item ───────────────────────
    projResolvedDispute = await makeProject(`COV-S-${suffix.slice(-6)}`);
    const ctrS = await makeContract(projResolvedDispute);
    const invS = await makePostedInvoice(projResolvedDispute, ctrS, {
      total: 20_000,
      dueDate: new Date('2026-12-31'), // future, not overdue
    });
    await makeDelivery(invS);
    await makeResolvedDispute(invS);
  }, 60_000);

  afterAll(async () => {
    await prisma.invoiceDispute.deleteMany({ where: { organizationId: orgId } });
    await prisma.invoicePaymentPromise.deleteMany({ where: { organizationId: orgId } });
    await prisma.invoiceFollowUp.deleteMany({ where: { organizationId: orgId } });
    await prisma.creditNote.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientReceiptAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.paymentReceipt.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoiceDelivery.deleteMany({
      where: { invoice: { organizationId: orgId } },
    });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({
      where: { contract: { organizationId: orgId } },
    });
    await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // Financial scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  it('OV-A: empty project — zeros and NO_CONTRACT stage, no attention', async () => {
    const r = await service.getOverview(identity, projA);

    expect(r.contract.id).toBeNull();
    expect(r.contract.baseContractValue).toBe('0.00');
    expect(r.financialPosition.grossIssued).toBe('0.00');
    expect(r.financialPosition.netBilled).toBe('0.00');
    expect(r.financialPosition.collected).toBe('0.00');
    expect(r.financialPosition.outstanding).toBe('0.00');
    expect(r.financialPosition.overdue).toBe('0.00');
    expect(r.currentCycle.stage).toBe('NO_CONTRACT');
    expect(r.attention).toHaveLength(0);
  });

  it('OV-B: contract only — financial zeros, contract value correct', async () => {
    const r = await service.getOverview(identity, projB);

    expect(r.contract.id).not.toBeNull();
    expect(r.contract.currentContractValue).toBe('500000.00');
    expect(r.contract.baseContractValue).toBe('500000.00');
    expect(r.financialPosition.grossIssued).toBe('0.00');
    expect(r.financialPosition.netBilled).toBe('0.00');
    expect(r.financialPosition.collected).toBe('0.00');
    expect(r.financialPosition.outstanding).toBe('0.00');
    expect(r.attention).toHaveLength(0);
  });

  it('OV-C: one POSTED invoice — grossIssued = outstanding, collected = 0', async () => {
    const r = await service.getOverview(identity, projC);

    expect(r.financialPosition.grossIssued).toBe('105000.00');
    expect(r.financialPosition.postedCreditNotes).toBe('0.00');
    expect(r.financialPosition.netBilled).toBe('105000.00');
    expect(r.financialPosition.collected).toBe('0.00');
    expect(r.financialPosition.outstanding).toBe('105000.00');
    // netBilled − collected = outstanding
    const nb = parseFloat(r.financialPosition.netBilled!);
    const col = parseFloat(r.financialPosition.collected!);
    const outs = parseFloat(r.financialPosition.outstanding!);
    expect(nb - col).toBeCloseTo(outs, 2);
  });

  it('OV-D: partial payment — collected = 40,000, outstanding = 65,000', async () => {
    const r = await service.getOverview(identity, projD);

    expect(r.financialPosition.grossIssued).toBe('105000.00');
    expect(r.financialPosition.collected).toBe('40000.00');
    expect(r.financialPosition.outstanding).toBe('65000.00');
    // invariant
    const nb = parseFloat(r.financialPosition.netBilled!);
    const col = parseFloat(r.financialPosition.collected!);
    const outs = parseFloat(r.financialPosition.outstanding!);
    expect(nb - col).toBeCloseTo(outs, 2);
  });

  it('OV-E: credit note — netBilled = 94,500 and invariant holds', async () => {
    const r = await service.getOverview(identity, projE);

    expect(r.financialPosition.grossIssued).toBe('105000.00');
    expect(r.financialPosition.postedCreditNotes).toBe('10500.00');
    expect(r.financialPosition.netBilled).toBe('94500.00');
    expect(r.financialPosition.collected).toBe('40000.00');
    expect(r.financialPosition.outstanding).toBe('54500.00');

    // Prove netBilled − collected = outstanding (the reconciliation invariant)
    const nb = parseFloat(r.financialPosition.netBilled!);
    const col = parseFloat(r.financialPosition.collected!);
    const outs = parseFloat(r.financialPosition.outstanding!);
    expect(nb - col).toBeCloseTo(outs, 2);
  });

  it('OV-F: separate charge — netBilled can exceed currentContractValue without error', async () => {
    const r = await service.getOverview(identity, projF);

    // currentContractValue = 500,000; netBilled = 510,500
    expect(r.contract.currentContractValue).toBe('500000.00');
    expect(r.financialPosition.grossIssued).toBe('510500.00');
    expect(r.financialPosition.netBilled).toBe('510500.00');
  });

  it('OV-G: overdue mix — only past-due + outstanding enters overdue total', async () => {
    const r = await service.getOverview(identity, projG);

    // grossIssued = 20,000 + 30,000 + 25,000 + 15,000 = 90,000
    expect(r.financialPosition.grossIssued).toBe('90000.00');
    // outstanding = 20,000 (future) + 30,000 (past) + 0 (paid) + 15,000 (null-due) = 65,000
    expect(r.financialPosition.outstanding).toBe('65000.00');
    // overdue = only the 30,000 invoice (past dueDate, outstanding > 0)
    expect(r.financialPosition.overdue).toBe('30000.00');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Current position
  // ═══════════════════════════════════════════════════════════════════════════

  it('OV-H: NEXT installment + !readyToBill → REVIEW_FOR_BILLING + MARK_READY action', async () => {
    const r = await service.getOverview(identity, projReview);

    expect(r.currentCycle.stage).toBe('REVIEW_FOR_BILLING');
    expect(r.currentCycle.installmentId).not.toBeNull();
    expect(r.currentCycle.nextAction?.kind).toBe('MARK_READY');
    expect(r.currentCycle.nextAction?.targetId).toBe(r.currentCycle.installmentId);
  });

  it('OV-I: NEXT installment + readyToBill → READY_TO_BILL + PREPARE_INVOICE action', async () => {
    const r = await service.getOverview(identity, projReady);

    expect(r.currentCycle.stage).toBe('READY_TO_BILL');
    expect(r.currentCycle.installmentId).not.toBeNull();
    expect(r.currentCycle.nextAction?.kind).toBe('PREPARE_INVOICE');
    expect(r.currentCycle.nextAction?.targetId).toBe(r.currentCycle.installmentId);
  });

  it('OV-J: all installments billed, some outstanding → ALL_BILLED', async () => {
    const r = await service.getOverview(identity, projAllBilled);

    expect(r.currentCycle.stage).toBe('ALL_BILLED');
    expect(r.currentCycle.nextAction).toBeNull();
    expect(r.currentCycle.installmentId).toBeNull();
  });

  it('OV-K: all installments billed, all paid → ALL_COMPLETE', async () => {
    const r = await service.getOverview(identity, projAllComplete);

    expect(r.currentCycle.stage).toBe('ALL_COMPLETE');
    expect(r.currentCycle.nextAction).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Attention items
  // ═══════════════════════════════════════════════════════════════════════════

  it('OV-L: POSTED invoice with zero deliveries → ISSUED_NOT_SENT', async () => {
    const r = await service.getOverview(identity, projIssuedNotSent);

    expect(r.attention).toHaveLength(1);
    expect(r.attention[0].kind).toBe('ISSUED_NOT_SENT');
    expect(r.attention[0].headline).toBe('Issued but not sent to client');
  });

  it('OV-M: invoice with one delivery → no ISSUED_NOT_SENT', async () => {
    const r = await service.getOverview(identity, projDelivered);

    const issuedNotSent = r.attention.filter((a) => a.kind === 'ISSUED_NOT_SENT');
    expect(issuedNotSent).toHaveLength(0);
    expect(r.attention).toHaveLength(0); // future dueDate, no other issues
  });

  it('OV-N: past dueDate + outstanding > 0 → OVERDUE_INVOICE with daysOverdue', async () => {
    const r = await service.getOverview(identity, projOverdue);

    expect(r.attention).toHaveLength(1);
    expect(r.attention[0].kind).toBe('OVERDUE_INVOICE');
    expect(r.attention[0].daysOverdue).toBeGreaterThan(0);
    expect(r.attention[0].amount).toBe('30000.00');
  });

  it('OV-O: null dueDate + outstanding > 0 → no overdue attention', async () => {
    const r = await service.getOverview(identity, projNullDue);

    expect(r.attention).toHaveLength(0);
  });

  it('OV-P: outstanding = 0 + past dueDate → not overdue', async () => {
    const r = await service.getOverview(identity, projPaidPastDue);

    expect(r.attention).toHaveLength(0);
  });

  it('OV-Q: missed promise trumps OVERDUE_INVOICE (dedup)', async () => {
    const r = await service.getOverview(identity, projMissedPromise);

    // Invoice is past-due AND has a missed promise — should appear only as MISSED_PROMISE
    expect(r.attention).toHaveLength(1);
    expect(r.attention[0].kind).toBe('MISSED_PROMISE');
    expect(r.attention[0].headline).toBe('Promise missed');
    expect(r.attention[0].promisedDate).toBe('2026-09-05');
  });

  it('OV-R: open dispute trumps MISSED_PROMISE + OVERDUE_INVOICE (dedup)', async () => {
    const r = await service.getOverview(identity, projOpenDispute);

    // Invoice is past-due, has missed promise, AND has open dispute — emit only OPEN_DISPUTE
    expect(r.attention).toHaveLength(1);
    expect(r.attention[0].kind).toBe('OPEN_DISPUTE');
    expect(r.attention[0].headline).toBe('Client dispute open');
  });

  it('OV-S: resolved dispute → no attention item', async () => {
    const r = await service.getOverview(identity, projResolvedDispute);

    // Invoice has a resolved (non-null resolvedAt) dispute — must not surface
    expect(r.attention).toHaveLength(0);
  });
});
