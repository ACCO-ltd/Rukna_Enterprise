/**
 * REC — Does procurement's ACTUAL agree with the general ledger?
 *
 * This is the gate for the whole Finance workspace. Every figure a Finance screen shows is
 * a claim that the commitment ledger and the accounts tell the same story about project
 * cost, and until the Phase 6 audit those were two independent variables: the ledger took
 * its cost-target from the matched purchase-order line, the GL took whatever an AP clerk
 * had keyed onto the bill — and since no bill form ever sent a project at all, the GL side
 * was always null. Project actual cost in the accounts was structurally $0.
 *
 *   REC-01  ledger ACTUAL == posted GL project cost from supplier bills   (Scenario B)
 *   REC-02  the three ledger stages sum to what was ordered               (Scenario B)
 *   REC-03  project-level (non-BOQ) cost survives into the GL as a category (Scenario D)
 *   REC-04  the accrual is released at what was accrued, leaving no residual
 *   REC-05  reversing a bill reverses BOTH sides                          (Scenario G1)
 *   REC-06  non-procurement project cost does not break the reconciliation (Scenario E)
 *
 * Runs against the real test DB through the real services — no mocking. The reconciliation
 * read model is asserted alongside the raw sums, because it is what the UI will render and
 * a read model that disagrees with its own source is worse than no read model.
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ProcurementFixtureFactory,
  type ProcurementTestEnv,
} from './helpers/procurement-fixture.factory.js';
import {
  buildProcurementServices,
  type ProcurementServices,
} from './helpers/build-procurement-services.js';
import { TenancyService } from '../../../platform/tenancy/tenancy.service.js';
import { ProjectFinancialPositionRepository } from '../../accounting/financial-position/infrastructure/project-financial-position.repository.js';
import { ProjectCostReconciliationService } from '../../accounting/financial-position/application/project-cost-reconciliation.service.js';
import { AccountingPostingService } from '../../accounting/accounting-core/infrastructure/accounting-posting.service.js';
import { JournalRepository } from '../../accounting/accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../accounting/accounting-core/infrastructure/document-sequence.repository.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: ProcurementServices;
let reconciliation: ProjectCostReconciliationService;
let posting: AccountingPostingService;

const D = (v: string | number) => new Decimal(v);

// ── Raw sums, computed independently of the read model under test ─────────────

/** Σ commitment-ledger amount for a stage on this project. */
async function ledgerStage(stage: 'COMMITTED' | 'ACCRUED' | 'ACTUAL'): Promise<Decimal> {
  const agg = await prisma.commitmentLedgerEntry.aggregate({
    where: { organizationId: env.orgId, projectId: env.projectId, stage },
    _sum: { amount: true },
  });
  return D((agg._sum.amount ?? 0).toString());
}

/** Σ (debit − credit) on cost accounts carrying this project, optionally by source document. */
async function glProjectCost(sourceDocumentType?: 'SUPPLIER_BILL'): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: {
      projectId: env.projectId,
      accountId: env.expAccountId,
      entry: {
        organizationId: env.orgId,
        status: 'POSTED',
        entryPurpose: { not: 'CLOSING' },
        ...(sourceDocumentType ? { sourceDocumentType } : {}),
      },
    },
    select: { debitAmount: true, creditAmount: true },
  });
  return lines.reduce(
    (sum, l) => sum.plus(D(l.debitAmount.toString())).minus(D(l.creditAmount.toString())),
    D(0),
  );
}

// ── Flow builders ─────────────────────────────────────────────────────────────

async function approvedMr(qty: number, opts: { boq: boolean }) {
  const mr = await svc.mrService.create(env.identity, {
    requestScope: 'PROJECT',
    projectId: env.projectId,
    requestedDate: '2026-08-10',
    lines: [
      {
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12',
        description: '12mm Rebar',
        uomCode: 'TON',
        requestedQuantity: qty,
        ...(opts.boq ? { boqNodeId: env.boqNodeId } : {}),
        spendCategoryId: env.spendCategoryId,
      },
    ],
  });
  await svc.mrService.submit(env.identity, mr.id);
  await svc.mrService.approve(env.identity, mr.id);
  return prisma.materialRequest.findUniqueOrThrow({
    where: { id: mr.id },
    include: { lines: true },
  });
}

/**
 * An approved PO for this project. `boq: true` is a BOQ-coded line (cost-target state 3);
 * `boq: false` is project-level cost with a spend category and no BOQ node (state 2) — the
 * attribution that could reach the ledger but not the accounts before this work.
 */
async function approvedPo(mrLineId: string, qty: number, price: number, opts: { boq: boolean }) {
  const po = await svc.poService.create(env.identity, {
    supplierId: env.supplierId,
    currencyCode: 'USD',
    effectiveFrom: '2026-08-15',
    lines: [
      {
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12',
        description: '12mm Rebar',
        uomCode: 'TON',
        orderedQuantity: qty,
        unitPrice: price,
        spendCategoryId: env.spendCategoryId,
        projectId: env.projectId,
        ...(opts.boq ? { boqNodeId: env.boqNodeId } : {}),
        mrLineAllocations: [{ materialRequestLineId: mrLineId, allocatedQuantity: qty }],
      },
    ],
  });
  await svc.poService.submit(env.identity, po!.id);
  await svc.poService.approve(env.identity, po!.id);
  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po!.id },
    include: { revisions: { include: { lines: true } } },
  });
}

async function postGrn(poId: string, poLineId: string, qty: number) {
  const grn = await svc.grnService.create(env.identity, {
    purchaseOrderId: poId,
    deliveryDate: '2026-08-20',
    lines: [
      {
        purchaseOrderLineId: poLineId,
        receivedQuantity: qty,
        acceptedQuantity: qty,
        rejectedQuantity: 0,
        qualityStatus: 'ACCEPTED',
      },
    ],
  });
  await svc.grnService.post(env.identity, grn!.id);
  return grn!.id;
}

/**
 * Enter, match, approve and post a PO-backed bill. `vat` is charged on top of the net, and
 * posts into expense: ACCO's input VAT is non-recoverable (ACC-TAX-001), so the GL debit —
 * and therefore ACTUAL — is the gross.
 */
async function postBill(poId: string, qty: number, price: number, vat: number) {
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId,
    supplierInvoiceNumber: `REC-INV-${Math.random().toString(36).slice(2)}`,
    billDate: '2026-08-25',
    dueDate: '2026-09-25',
    currencyCode: 'USD',
    purchaseOrderId: poId,
    lines: [
      {
        description: '12mm Rebar',
        quantity: qty,
        unitPrice: price,
        netAmount: qty * price,
        vatAmount: vat,
        expenseProfileCode: env.postingProfileCode,
      },
    ],
  });
  // Matching pairs bill lines to PO lines by material, as production PO-backed material bills do.
  await prisma.supplierBillLine.updateMany({
    where: { supplierBillId: bill.id },
    data: { lineType: 'MATERIAL', materialId: env.materialId },
  });
  await svc.supplierBillService.submit(env.identity, bill.id);
  await svc.supplierBillService.approve(env.identity, bill.id);
  await svc.supplierBillService.post(env.identity, {
    billId: bill.id,
    apAccountCode: 'AP-PROC',
  });
  return bill.id;
}

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  svc = buildProcurementServices(prisma);
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  reconciliation = new ProjectCostReconciliationService(
    tenancy,
    new ProjectFinancialPositionRepository(),
  );
  posting = new AccountingPostingService(new DocumentSequenceRepository(), new JournalRepository());
}, 30_000);

afterAll(async () => {
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
}, 30_000);

// ─── Scenario B — the full procurement chain, BOQ-coded ───────────────────────
describe('Scenario B — PO → GRN → posted bill, BOQ-coded', () => {
  const QTY = 100;
  const PRICE = 400;
  const NET = QTY * PRICE; // 40 000
  const VAT = 2000;
  const GROSS = NET + VAT; // 42 000

  let poId: string;

  beforeAll(async () => {
    const mr = await approvedMr(QTY, { boq: true });
    const po = await approvedPo(mr.lines[0]!.id, QTY, PRICE, { boq: true });
    poId = po.id;
    const line = po.revisions.find((r) => r.status === 'ACTIVE')!.lines[0]!;
    await postGrn(po.id, line.id, QTY);
    await postBill(po.id, QTY, PRICE, VAT);
  }, 60_000);

  it('REC-01: ledger ACTUAL equals posted GL project cost from supplier bills', async () => {
    const actual = await ledgerStage('ACTUAL');
    const gl = await glProjectCost('SUPPLIER_BILL');

    expect(actual.toFixed(2)).toBe(D(GROSS).toFixed(2));
    expect(gl.toFixed(2)).toBe(D(GROSS).toFixed(2));
    expect(gl.minus(actual).toFixed(2)).toBe('0.00');
  });

  it('REC-01: the reconciliation read model agrees with its own source', async () => {
    const rec = await reconciliation.getForProject(env.identity, env.projectId);

    expect(rec.reconciled).toBe(true);
    expect(rec.variance).toBe('0.00');
    expect(rec.ledgerActual).toBe(D(GROSS).toFixed(2));
    expect(rec.glProcurementCost).toBe(D(GROSS).toFixed(2));
    expect(rec.unattributedBillLines).toBe(0);
  });

  it('REC-02: the three ledger stages sum to what was ordered, plus the tax on it', async () => {
    const [committed, accrued, actual] = await Promise.all([
      ledgerStage('COMMITTED'),
      ledgerStage('ACCRUED'),
      ledgerStage('ACTUAL'),
    ]);

    // Fully received and billed: nothing is still on order, nothing is still unbilled.
    expect(committed.toFixed(2)).toBe('0.00');
    expect(accrued.toFixed(2)).toBe('0.00');
    // Committed-to-date is the ordered value plus the non-recoverable VAT the bill added —
    // which is the real money the project spends, and the right basis for budget headroom.
    expect(committed.plus(accrued).plus(actual).toFixed(2)).toBe(D(GROSS).toFixed(2));
  });

  /**
   * The accrual is raised on the purchase-order price and released on the same basis. It
   * used to be released at the bill's GROSS, so a project that was fully billed carried a
   * permanent −VAT residual and reported a NEGATIVE "remaining committed".
   */
  it('REC-04: releasing the accrual leaves no residual', async () => {
    const accrued = await ledgerStage('ACCRUED');
    expect(accrued.toFixed(2)).toBe('0.00');
    expect(accrued.isNegative()).toBe(false);
  });

  it('the GL line carries the PO line’s BOQ node, not the bill clerk’s keying', async () => {
    const line = await prisma.journalLine.findFirstOrThrow({
      where: {
        projectId: env.projectId,
        accountId: env.expAccountId,
        entry: { sourceDocumentType: 'SUPPLIER_BILL', status: 'POSTED' },
      },
    });
    expect(line.boqNodeId).toBe(env.boqNodeId);
    expect(line.supplierId).toBe(env.supplierId);
  });

  // ─── Scenario G1 — reversal ─────────────────────────────────────────────────
  it('REC-05: reversing the bill reverses BOTH the GL and the ledger', async () => {
    const bill = await prisma.supplierBill.findFirstOrThrow({
      where: { organizationId: env.orgId, postingStatus: 'POSTED', purchaseOrderId: poId },
    });

    await svc.supplierBillService.reverse(env.identity, bill.id, {
      reversalDate: '2026-08-28',
      reason: 'REC-05 reversal',
    });

    const actual = await ledgerStage('ACTUAL');
    const gl = await glProjectCost('SUPPLIER_BILL');
    const accrued = await ledgerStage('ACCRUED');

    // Both sides return to zero — the defect was that only the GL did.
    expect(gl.toFixed(2)).toBe('0.00');
    expect(actual.toFixed(2)).toBe('0.00');
    // The goods are still on site and still unbilled, so the accrual comes back.
    expect(accrued.toFixed(2)).toBe(D(NET).toFixed(2));

    const rec = await reconciliation.getForProject(env.identity, env.projectId);
    expect(rec.reconciled).toBe(true);
    expect(rec.variance).toBe('0.00');
  });
});

// ─── Scenario D — project-level cost with no BOQ line ─────────────────────────
describe('Scenario D — project-level (non-BOQ) cost', () => {
  const QTY = 10;
  const PRICE = 1500;
  const NET = QTY * PRICE; // 15 000

  let projectId: string;

  beforeAll(async () => {
    // A second isolated project so Scenario B's reversed figures do not bleed in.
    const mr = await approvedMr(QTY, { boq: false });
    const po = await approvedPo(mr.lines[0]!.id, QTY, PRICE, { boq: false });
    projectId = env.projectId;
    const line = po.revisions.find((r) => r.status === 'ACTIVE')!.lines[0]!;
    await postGrn(po.id, line.id, QTY);
    await postBill(po.id, QTY, PRICE, 0);
  }, 60_000);

  it('REC-03: the spend category survives into the GL journal line', async () => {
    const line = await prisma.journalLine.findFirstOrThrow({
      where: {
        projectId,
        accountId: env.expAccountId,
        boqNodeId: null,
        entry: { sourceDocumentType: 'SUPPLIER_BILL', status: 'POSTED' },
      },
    });

    // Before this work `JournalLine` had no spendCategoryId at all, so project-level cost
    // reached the accounts as an unclassified bucket nobody could decompose.
    expect(line.spendCategoryId).toBe(env.spendCategoryId);
    expect(line.projectId).toBe(projectId);
    expect(line.boqNodeId).toBeNull();
  });

  it('REC-01 still holds with project-level cost in the mix', async () => {
    const rec = await reconciliation.getForProject(env.identity, projectId);
    expect(rec.reconciled).toBe(true);
    expect(rec.variance).toBe('0.00');
    expect(rec.glProcurementCost).toBe(D(NET).toFixed(2));
  });
});

// ─── Scenario E — non-procurement project cost ────────────────────────────────
describe('Scenario E — a manual project journal', () => {
  const MANUAL = 5000;
  let accrualAccountId: string;

  beforeAll(async () => {
    // A plain liability to credit. The fixture's AP account is a SYSTEM_ONLY control
    // account and correctly refuses manual postings, which is the guard working, not a
    // problem to route around.
    const acct = await prisma.account.create({
      data: {
        id: `${env.orgId}-ACCR-PROC`,
        organizationId: env.orgId,
        code: 'ACCR-PROC',
        normalBalance: 'CREDIT',
        createdBy: env.identity.userId,
      },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: acct.id,
        versionNumber: 1,
        name: 'Accrued liabilities',
        accountClass: 'LIABILITY' as never,
        accountSubtype: 'OTHER_CURRENT_LIABILITY' as never,
        isPostingAllowed: true,
        isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED' as never,
        effectiveFrom: new Date('2025-01-01'),
        changedBy: env.identity.userId,
      },
    });
    accrualAccountId = acct.id;

    await prisma.$transaction((tx) =>
      posting.post(
        {
          organizationId: env.orgId,
          accountingDate: new Date('2026-08-26'),
          documentDate: new Date('2026-08-26'),
          description: 'Site labour — not procured',
          currencyCode: 'USD',
          eventType: `REC-MANUAL-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId: `rec-manual-${Date.now()}`,
          journalCategory: 'GENERAL',
          entryPurpose: 'NORMAL',
          postingOrigin: 'MANUAL',
          createdBy: env.identity.userId,
          lines: [
            {
              accountId: env.expAccountId,
              debitAmount: D(MANUAL),
              creditAmount: D(0),
              projectId: env.projectId,
            },
            { accountId: accrualAccountId, debitAmount: D(0), creditAmount: D(MANUAL) },
          ],
        },
        tx as never,
      ),
    );
  }, 30_000);

  /**
   * The case that proves the reconciliation must be source-scoped. Payroll, plant and
   * manual accruals are real project cost that procurement never sees. Comparing ledger
   * ACTUAL against ALL GL project cost would report this as a variance and push someone
   * into "fixing" it by forcing non-procurement cost through procurement.
   */
  it('REC-06: non-procurement cost raises total project cost without breaking the reconciliation', async () => {
    const rec = await reconciliation.getForProject(env.identity, env.projectId);

    expect(rec.reconciled).toBe(true);
    expect(rec.variance).toBe('0.00');
    expect(rec.glNonProcurementCost).toBe(D(MANUAL).toFixed(2));
    // The whole picture is the sum of the two, and the split is what makes it readable.
    expect(rec.glTotalProjectCost).toBe(
      D(rec.glProcurementCost).plus(D(rec.glNonProcurementCost)).toFixed(2),
    );
  });
});
