/**
 * A14 — PO-backed bill ↔ PO-revision link + auto-match on submit + commitment ACTUAL (D6/A2/D7)
 *
 * Runs against the real test DB (no mocking), one isolated fixture org, torn down in afterAll.
 *
 * D6  PO-backed flow: PO → goods received → bill entered → AUTO-match on submit (no manual "run").
 *     matched = silently ready; only a material variance raises an EXCEPTION. Non-PO bills untouched.
 * A2  ACCO tolerances: unit price 2% · quantity 0% · rounding ≤ USD 5 per invoice.
 * D7  On post, the commitment ACTUAL inherits the originating PO line's projectId/boqNodeId
 *     (org lines → null) so the ledger nets COMMITTED → ACCRUED → ACTUAL per project/node.
 *
 * A01 create against a PO writes purchaseOrderRevisionId (the core link)
 * A02 submit auto-matches a clean PO-backed bill → MATCHED/MATCHED_WITH_TOLERANCE (no manual step)
 * A03 submit auto-matches a >2% price-variance bill → EXCEPTION (silent, held by the posting gate)
 * A04 submit auto-matches a billed-qty > accepted-qty bill → EXCEPTION (0% qty)
 * A05 a ≤ USD 5 per-invoice net rounding diff is tolerated → MATCHED_WITH_TOLERANCE (posts)
 * A06 post writes the ACTUAL carrying the PO line's projectId/boqNodeId; the org line's ACTUAL → null
 * A07 full-loop netting: for a fully received + billed line, COMMITTED − ACCRUED and ACCRUED − ACTUAL
 *     resolve to zero per project/node
 * A08 the non-PO path is unchanged: submit does not match, post writes no commitment, GL posts
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

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: ProcurementServices;

function identity(e: ProcurementTestEnv) {
  return e.identity;
}

// ── Builders ─────────────────────────────────────────────────────────────────

async function approvedMr(qty: number) {
  const mr = await svc.mrService.create(identity(env), {
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
        boqNodeId: env.boqNodeId,
        spendCategoryId: env.spendCategoryId,
      },
    ],
  });
  await svc.mrService.submit(identity(env), mr.id);
  await svc.mrService.approve(identity(env), mr.id);
  return prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id }, include: { lines: true } });
}

/** A PO whose single MATERIAL line carries a valid cost-target (projectId + leaf boqNodeId). */
async function approvedPoWithCostTarget(mrLineId: string, qty: number, price: number) {
  const po = await svc.poService.create(identity(env), {
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
        boqNodeId: env.boqNodeId,
        mrLineAllocations: [{ materialRequestLineId: mrLineId, allocatedQuantity: qty }],
      },
    ],
  });
  await svc.poService.submit(identity(env), po!.id);
  await svc.poService.approve(identity(env), po!.id);
  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po!.id },
    include: { revisions: { include: { lines: true } } },
  });
}

async function postGrn(poId: string, poLineId: string, received: number, accepted: number) {
  const grn = await svc.grnService.create(identity(env), {
    purchaseOrderId: poId,
    deliveryDate: '2026-08-20',
    lines: [
      {
        purchaseOrderLineId: poLineId,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: received - accepted,
        qualityStatus: received - accepted > 0 ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED',
      },
    ],
  });
  await svc.grnService.post(identity(env), grn!.id);
  return grn!.id;
}

/** A PO-backed MATERIAL bill entered against a PO, in DRAFT (not yet submitted). */
async function draftPoBackedBill(poId: string, qty: number, price: number) {
  return svc.supplierBillService.create(identity(env), {
    supplierId: env.supplierId,
    supplierInvoiceNumber: `A14-INV-${Math.random().toString(36).slice(2)}`,
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
        vatAmount: 0,
        expenseProfileCode: env.postingProfileCode,
      },
    ],
  });
}

/** Bill lines don't carry lineType/materialId via the service DTO; set them so matching sees MATERIAL
 *  lines and matches them to the PO line by material (mirrors production PO-backed material bills). */
async function markLinesMaterial(billId: string) {
  await prisma.supplierBillLine.updateMany({
    where: { supplierBillId: billId },
    data: { lineType: 'MATERIAL', materialId: env.materialId },
  });
}

async function approve(billId: string) {
  await svc.supplierBillService.approve(identity(env), billId);
}

async function matchStatusOf(billId: string) {
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
  return bill.matchStatus;
}

// ── Suite ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  svc = buildProcurementServices(prisma);
}, 30_000);

afterAll(async () => {
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
}, 30_000);

// ── A01: the core link ────────────────────────────────────────────────────────
test('A01 — creating a bill against a PO writes purchaseOrderRevisionId (the ACTIVE revision)', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;

  const bill = await draftPoBackedBill(po.id, 100, 500);

  expect(bill.purchaseOrderId).toBe(po.id);
  expect(bill.purchaseOrderRevisionId).toBe(activeRev.id);
});

// ── A02: auto-match on submit, clean bill ──────────────────────────────────────
test('A02 — submit auto-matches a clean PO-backed bill (MATCHED_WITH_TOLERANCE), no manual run', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;
  await postGrn(po.id, activeRev.lines[0].id, 100, 100);

  const bill = await draftPoBackedBill(po.id, 100, 500);
  await markLinesMaterial(bill.id);

  // NOT_RUN until submit — submit is the only trigger (no manual "run matching").
  expect(await matchStatusOf(bill.id)).toBe('NOT_RUN');

  await svc.supplierBillService.submit(identity(env), bill.id);

  // Exact price/qty match against a policy that always exists (org fallback 2%/0%) → a zero-variance
  // match is MATCHED; a tolerated non-zero one is MATCHED_WITH_TOLERANCE. Either way it is postable.
  const status = await matchStatusOf(bill.id);
  expect(['MATCHED', 'MATCHED_WITH_TOLERANCE']).toContain(status);

  // The match record was created automatically by submit.
  const match = await svc.billMatchingService.findByBillId(identity(env), bill.id);
  expect(match.status).toBe(status);
});

// ── A03: >2% price variance → EXCEPTION ────────────────────────────────────────
test('A03 — submit auto-matches a >2% price-variance bill to EXCEPTION (held, not thrown)', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;
  await postGrn(po.id, activeRev.lines[0].id, 100, 100);

  // 520 vs 500 = 4% > 2% price tolerance → EXCEPTION.
  const bill = await draftPoBackedBill(po.id, 100, 520);
  await markLinesMaterial(bill.id);

  // submit does NOT throw for an out-of-tolerance bill — it lands as EXCEPTION and moves to SUBMITTED.
  await expect(svc.supplierBillService.submit(identity(env), bill.id)).resolves.toBeTruthy();
  expect(await matchStatusOf(bill.id)).toBe('EXCEPTION');

  // The posting gate then holds it (proving the EXCEPTION routes to the real approval path).
  await approve(bill.id);
  await expect(
    svc.supplierBillService.post(identity(env), { billId: bill.id, apAccountCode: 'AP-PROC' }),
  ).rejects.toThrow(/posting blocked/i);
});

// ── A04: billed qty > accepted qty → EXCEPTION (0% qty) ────────────────────────
test('A04 — submit auto-matches a billed-qty > accepted-qty bill to EXCEPTION (0% qty)', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;
  // Accept only 80.
  await postGrn(po.id, activeRev.lines[0].id, 80, 80);

  // Bill for 100 at the right price → billed 100 > accepted 80 → EXCEPTION (0% qty, never absorbed).
  const bill = await draftPoBackedBill(po.id, 100, 500);
  await markLinesMaterial(bill.id);

  await svc.supplierBillService.submit(identity(env), bill.id);
  expect(await matchStatusOf(bill.id)).toBe('EXCEPTION');
});

// ── A05: ≤ USD 5 per-invoice rounding is tolerated ─────────────────────────────
test('A05 — a ≤ USD 5 per-invoice net rounding diff is tolerated (MATCHED_WITH_TOLERANCE)', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;
  await postGrn(po.id, activeRev.lines[0].id, 100, 100);

  // 500.02 vs 500 on 100 units = USD 2 total, and 0.02/500 = 0.004% ≤ 2% price → within price tol too;
  // the per-invoice USD-5 rounding band absorbs any residual. Postable.
  const bill = await draftPoBackedBill(po.id, 100, 500.02);
  await markLinesMaterial(bill.id);

  await svc.supplierBillService.submit(identity(env), bill.id);
  expect(['MATCHED', 'MATCHED_WITH_TOLERANCE']).toContain(await matchStatusOf(bill.id));
});

// ── A06 + A07: ACTUAL inherits the PO line cost-target; the full loop nets ──────
test('A06/A07 — post writes ACTUAL carrying the PO line projectId/boqNodeId, and the loop nets to zero', async () => {
  const mr = await approvedMr(100);
  const po = await approvedPoWithCostTarget(mr.lines[0].id, 100, 500);
  const activeRev = po.revisions.find((r) => r.status === 'ACTIVE')!;
  const poLine = activeRev.lines[0];
  await postGrn(po.id, poLine.id, 100, 100);

  const bill = await draftPoBackedBill(po.id, 100, 500);
  await markLinesMaterial(bill.id);
  await svc.supplierBillService.submit(identity(env), bill.id);
  await approve(bill.id);
  await svc.supplierBillService.post(identity(env), { billId: bill.id, apAccountCode: 'AP-PROC' });

  // D7: the ACTUAL entry carries the PO line's cost-target.
  const actuals = await prisma.commitmentLedgerEntry.findMany({
    where: { sourceDocumentId: bill.id, stage: 'ACTUAL' },
  });
  expect(actuals).toHaveLength(1);
  expect(new Decimal(actuals[0].amount.toString()).equals(new Decimal('50000'))).toBe(true);
  expect(actuals[0].projectId).toBe(env.projectId);
  expect(actuals[0].boqNodeId).toBe(env.boqNodeId);

  // A07: net per project/node across the whole loop for this line.
  const summarize = async (stage: 'COMMITTED' | 'ACCRUED' | 'ACTUAL') => {
    const rows = await prisma.commitmentLedgerEntry.findMany({
      where: { organizationId: env.orgId, projectId: env.projectId, boqNodeId: env.boqNodeId, stage, purchaseOrderId: po.id },
    });
    return rows.reduce((s, r) => s.add(new Decimal(r.amount.toString())), new Decimal(0));
  };
  const committed = await summarize('COMMITTED');
  const accrued = await summarize('ACCRUED');
  const actual = await summarize('ACTUAL');

  // Fully received + fully billed at the ordered price:
  //   COMMITTED nets to 0 (raised on PO approve, fully reduced on GRN post)
  //   ACCRUED   nets to 0 (raised on GRN post, fully reversed on bill post)
  //   ACTUAL    = the billed cost (50000)
  expect(committed.equals(new Decimal('0'))).toBe(true);
  expect(accrued.equals(new Decimal('0'))).toBe(true);
  expect(actual.equals(new Decimal('50000'))).toBe(true);
});

// ── A06b: an org/overhead line's ACTUAL carries null cost-target ───────────────
test('A06b — an org/overhead PO-backed bill line writes an ACTUAL with null project/node', async () => {
  // A PO with a single ORG line (no cost-target).
  const po = await svc.poService.create(identity(env), {
    supplierId: env.supplierId,
    currencyCode: 'USD',
    effectiveFrom: '2026-08-15',
    lines: [
      { lineType: 'OTHER', description: 'Office supplies', uomCode: 'TON', orderedQuantity: 10, unitPrice: 100 },
    ],
  });
  await svc.poService.submit(identity(env), po!.id);
  await svc.poService.approve(identity(env), po!.id);
  const activeRev = po!.revisions.find((r) => r.status === 'ACTIVE')!;
  // SERVICE/OTHER line → TWO_WAY (no GRN needed).

  const bill = await draftPoBackedBill(po!.id, 10, 100);
  // Keep it a SERVICE line → TWO_WAY match by position against the org PO line.
  await prisma.supplierBillLine.updateMany({
    where: { supplierBillId: bill.id },
    data: { lineType: 'SERVICE' },
  });
  void activeRev;

  await svc.supplierBillService.submit(identity(env), bill.id);
  expect(['MATCHED', 'MATCHED_WITH_TOLERANCE']).toContain(await matchStatusOf(bill.id));
  await approve(bill.id);
  await svc.supplierBillService.post(identity(env), { billId: bill.id, apAccountCode: 'AP-PROC' });

  const actuals = await prisma.commitmentLedgerEntry.findMany({
    where: { sourceDocumentId: bill.id, stage: 'ACTUAL' },
  });
  expect(actuals).toHaveLength(1);
  expect(actuals[0].projectId).toBeNull();
  expect(actuals[0].boqNodeId).toBeNull();
  expect(new Decimal(actuals[0].amount.toString()).equals(new Decimal('1000'))).toBe(true);
});

// ── A08: non-PO path unchanged ─────────────────────────────────────────────────
test('A08 — a genuine non-PO bill is not matched on submit and posts with no commitment entry', async () => {
  const invNum = `A14-NONPO-${Math.random().toString(36).slice(2)}`;
  const bill = await svc.supplierBillService.create(identity(env), {
    supplierId: env.supplierId,
    supplierInvoiceNumber: invNum,
    billDate: '2026-08-25',
    dueDate: '2026-09-25',
    currencyCode: 'USD',
    // no purchaseOrderId → separate controlled path
    lines: [
      {
        description: 'Ad-hoc consulting',
        netAmount: 1000,
        vatAmount: 0,
        expenseProfileCode: env.postingProfileCode,
      },
    ],
  });

  expect(bill.purchaseOrderId).toBeNull();
  expect(bill.purchaseOrderRevisionId).toBeNull();

  await svc.supplierBillService.submit(identity(env), bill.id);
  // No matching runs for a non-PO bill.
  expect(await matchStatusOf(bill.id)).toBe('NOT_RUN');
  await expect(svc.billMatchingService.findByBillId(identity(env), bill.id)).rejects.toThrow(
    /No match result/i,
  );

  await approve(bill.id);
  await svc.supplierBillService.post(identity(env), { billId: bill.id, apAccountCode: 'AP-PROC' });

  const posted = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
  expect(posted.postingStatus).toBe('POSTED');

  // Non-PO bills never touch the commitment ledger.
  const commitments = await prisma.commitmentLedgerEntry.findMany({ where: { sourceDocumentId: bill.id } });
  expect(commitments).toHaveLength(0);
});
