import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { WorkflowTransactionType } from '@erp/types';

import { activateSodRules, addTransitionBinding } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type MrLineSpec,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * ADR-044 Q6 (live DB) — raise the order from an award, PO confirm coverage, re-decision, and the
 * MR-allocation hardening. Scenarios S7, S9; refusal R6.
 */
describe('ADR-044 Q6 — from award to purchase order', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  const THREE_LINES: MrLineSpec[] = [
    { quantity: 50, estimate: 22.1, description: 'Cement 42.5' },
    { quantity: 40, estimate: 23.45, description: 'Rebar 12mm' },
    { quantity: 10, estimate: 31, description: 'Tie wire' },
  ];

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, [
      'QUOTE_UPLOADER_CANNOT_SELECT',
      'REQUESTER_CANNOT_SELECT',
      'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
    ]);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  /** An AWARDED request: three stores, the first (a registered supplier) at `total`. */
  async function awarded(total: string, lines: MrLineSpec[] = THREE_LINES, opts: { newStore?: string } = {}) {
    const mr = await createApprovedMr(prisma, env, { lines });
    const request = await svc.collect.open(env.as('collector'), mr.id);
    const first = opts.newStore ? { storeName: opts.newStore } : { supplierId: env.supplierId };
    await s.addQuote(request.request.id, first);
    await s.addQuote(request.request.id, { storeName: `Other A ${mr.id.slice(-5)}` });
    await s.addQuote(request.request.id, { storeName: `Other B ${mr.id.slice(-5)}` });
    const sent = await svc.collect.send(env.as('collector'), request.request.id);
    const [a, b, c] = sent.quotes;
    await svc.selection.enterTotal(env.as('selector'), sent.id, a.id, total);
    await svc.selection.enterTotal(env.as('selector'), sent.id, b.id, new Decimal(total).add(100).toFixed(2));
    await svc.selection.enterTotal(env.as('selector'), sent.id, c.id, new Decimal(total).add(200).toFixed(2));
    const result = await svc.awards.award(env.as('selector'), sent.id, { quoteId: a.id, paymentPath: 'FINANCE_PAYS_SUPPLIER' });
    return { mr, request: result, winning: result.quotes[0] };
  }

  const poOf = (id: string) =>
    prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        revisions: { include: { lines: { include: { mrAllocations: true }, orderBy: { lineNumber: 'asc' } }, attachments: true } },
      },
    });

  it('S7: order-draft previews the estimate split; raise creates the DRAFT PO within the award with the evidence', async () => {
    const { mr, request, winning } = await awarded('2295.00');
    const draft = await svc.orders.orderDraft(env.as('collector'), request.id);
    expect(draft).toMatchObject({
      splitMode: 'ESTIMATE',
      awardedTotal: '2295.00',
      supplier: { id: env.supplierId },
      paymentPath: 'FINANCE_PAYS_SUPPLIER',
    });
    expect(draft.lines.map((l) => [l.description, l.quantity])).toEqual([
      ['Cement 42.5', '50.0000'],
      ['Rebar 12mm', '40.0000'],
      ['Tie wire', '10.0000'],
    ]);

    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    const po = await poOf(purchaseOrderId);
    const revision = po.revisions[0];
    expect(po).toMatchObject({ status: 'DRAFT', supplierId: env.supplierId, createdBy: env.userIds.collector });
    expect(revision.lines).toHaveLength(3);
    const ordered = revision.lines.reduce(
      (sum, l) => sum.add(new Decimal(l.unitPrice.toString()).mul(l.orderedQuantity.toString())),
      new Decimal(0),
    );
    expect(ordered.lessThanOrEqualTo(new Decimal('2295'))).toBe(true);
    expect(new Decimal('2295').sub(ordered).lessThan(new Decimal('0.01'))).toBe(true);
    expect(revision.lines.map((l) => l.mrAllocations.map((a) => a.materialRequestLineId))).toEqual(
      mr.lines.map((l) => [l.id]),
    );
    expect(revision.lines.every((l) => l.projectId === env.projectId && l.boqNodeId === env.boqNodeId)).toBe(true);
    // Effective date = the award's date (the source document), not the clock.
    const awardedAt = (await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } })).awardedAt!;
    expect(revision.effectiveFrom.toISOString().slice(0, 10)).toBe(awardedAt.toISOString().slice(0, 10));
    expect(revision).toMatchObject({ quotationRef: request.number });
    expect(revision.quotedAmount?.toString()).toBe('2295');
    expect(revision.quotationDate?.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(revision.attachments.map((a) => [a.platformFileId, a.purpose, a.supplierRef])).toEqual(
      winning.photos.map((p) => [p.fileId, 'QUOTATION', request.number]),
    );
    const files = await prisma.platformFile.findMany({ where: { id: { in: winning.photos.map((p) => p.fileId) } } });
    expect(files.every((f) => f.lifecycle === 'IMMUTABLE')).toBe(true);

    const after = await svc.query.detail(env.as('collector'), request.id);
    expect(after.purchaseOrder).toMatchObject({ id: purchaseOrderId, status: 'DRAFT' });
    expect(await s.events(request.id)).toContain('QUOTATION_ORDER_RAISED');

    // R6/invariant 7: a second raise while the draft is live is refused.
    expect(await refusal(svc.orders.raiseOrder(env.as('collector'), request.id, {}))).toEqual({
      status: 409,
      code: 'PURCHASE_ORDER_LIVE',
    });

    // Confirm is covered by the award: no approval instance, commitments written, approvedBy = selector.
    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
    const confirmed = await poOf(purchaseOrderId);
    expect(confirmed.status).toBe('OPEN');
    expect(confirmed.revisions[0]).toMatchObject({ status: 'ACTIVE', approvedBy: env.userIds.selector, approvalInstanceId: null });
    expect(await prisma.approvalInstance.count({ where: { transactionId: purchaseOrderId } })).toBe(0);
    expect(await prisma.commitmentLedgerEntry.count({ where: { purchaseOrderId, stage: 'COMMITTED' } })).toBe(3);
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: purchaseOrderId, sourceCommand: 'po.confirm' } });
    expect(audit?.reason).toBe(`Covered by quotation award ${request.number}`);

    // The award is spent: no re-decision, no cancel.
    expect(await refusal(svc.orders.requestRedecision(env.as('collector'), request.id, 'price changed'))).toEqual({
      status: 409,
      code: 'PURCHASE_ORDER_CONFIRMED',
    });
    expect(await refusal(svc.collect.cancel(env.as('collector'), request.id, 'oops'))).toEqual({
      status: 409,
      code: 'PURCHASE_ORDER_CONFIRMED',
    });
  });

  it('manual lines: dropping a line and lowering quantities is fine; over the cap, foreign lines and bad input are 422', async () => {
    const { mr, request } = await awarded('1000.00');
    const [l1, l2, l3] = mr.lines;
    const line = (id: string, quantity: string, amount: string) => ({ materialRequestLineId: id, quantity, amount });
    expect(
      await refusal(svc.orders.raiseOrder(env.as('collector'), request.id, { lines: [line(l1.id, '50', '600'), line(l2.id, '40', '400.01')] })),
    ).toEqual({ status: 422, code: 'PO_EXCEEDS_AWARD' });
    expect(await refusal(svc.orders.raiseOrder(env.as('collector'), request.id, { lines: [line('foreign-line', '1', '1')] }))).toEqual({
      status: 422,
      code: 'ORDER_LINE_NOT_ON_REQUEST',
    });
    expect(await refusal(svc.orders.raiseOrder(env.as('collector'), request.id, { lines: [line(l3.id, '11', '10')] }))).toEqual({
      status: 422,
      code: 'ORDER_LINE_QUANTITY_INVALID',
    });
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {
      lines: [line(l1.id, '30', '600'), line(l2.id, '40', '400')],
      expectedDeliveryDate: '2026-10-12',
      deliveryAddress: 'HQ site gate 2',
    });
    const po = await poOf(purchaseOrderId);
    expect(po.revisions[0].lines.map((l) => [l.orderedQuantity.toString(), l.unitPrice.toString()])).toEqual([
      ['30', '20'],
      ['40', '10'],
    ]);
    expect(po.revisions[0]).toMatchObject({ deliveryAddress: 'HQ site gate 2' });
  });

  it('MANUAL mode (an unpriced line among several) needs lines', async () => {
    const { request } = await awarded('500.00', [{ quantity: 5, estimate: 50 }, { quantity: 5 }]);
    expect((await svc.orders.orderDraft(env.as('collector'), request.id)).splitMode).toBe('MANUAL');
    expect(await refusal(svc.orders.raiseOrder(env.as('collector'), request.id, {}))).toEqual({
      status: 422,
      code: 'ORDER_LINES_REQUIRED',
    });
  });

  it('a cancelled, never-confirmed draft frees the award: re-raise, or send back to finance', async () => {
    const { request } = await awarded('900.00', [{ quantity: 10, estimate: 95 }]);
    const first = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    expect(await refusal(svc.orders.requestRedecision(env.as('collector'), request.id, 'x'))).toEqual({
      status: 409,
      code: 'PURCHASE_ORDER_LIVE',
    });
    await svc.poService.cancel(env.as('collector'), first.purchaseOrderId);
    // The cancelled order's quantity is free again, so the award can be raised anew.
    const second = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    expect(second.purchaseOrderId).not.toBe(first.purchaseOrderId);
    await svc.poService.cancel(env.as('collector'), second.purchaseOrderId);

    const back = await svc.orders.requestRedecision(env.as('selector'), request.id, 'Supplier no longer has stock');
    expect(back).toMatchObject({ status: 'AWAITING_DECISION', award: null, purchaseOrder: null });
    expect(back.waitingWorkingMinutes).not.toBeNull();
    expect(await s.events(request.id)).toContain('QUOTATION_REDECISION_REQUESTED');
  });

  it('S9: a new store wins — the selector registers it; the collector raises and confirms (vendor-maintainer SoD passes)', async () => {
    const { request } = await awarded('950.00', [{ quantity: 10, estimate: 95 }], { newStore: 'Xamar Steel S9' });
    const supplierId = request.award!.supplier!.id;
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } })).createdBy).toBe(env.userIds.selector);
    expect(request.quotes[0].store).toMatchObject({ supplierId, registered: true, name: 'Xamar Steel S9' });

    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
    expect((await poOf(purchaseOrderId)).status).toBe('OPEN');

    // Re-deciding and re-awarding the same store does not register it twice.
    const mr2 = await awarded('950.00', [{ quantity: 10, estimate: 95 }], { newStore: 'Xamar Steel S9 B' });
    await svc.orders.requestRedecision(env.as('collector'), mr2.request.id, 'Re-check');
    await svc.awards.award(env.as('selector'), mr2.request.id, { quoteId: mr2.winning.id, paymentPath: 'BUYER_CASH' });
    expect(await prisma.supplier.count({ where: { organizationId: env.orgId, name: 'Xamar Steel S9 B' } })).toBe(1);
  });

  describe('with PO and award governance bindings active', () => {
    beforeAll(async () => {
      await addTransitionBinding(prisma, env.orgId, {
        entityType: 'PurchaseOrder',
        transactionType: WorkflowTransactionType.PURCHASE_ORDER,
        fromState: 'DRAFT',
        toState: 'SUBMITTED',
      });
    });
    afterAll(async () => {
      await prisma.workflowTriggerBinding.updateMany({ where: { organizationId: env.orgId, entityType: 'PurchaseOrder' }, data: { isActive: false } });
    });

    it('a covered PO confirms without its own approval; its amendment (revision 2) takes the normal gate', async () => {
      const { request } = await awarded('950.00', [{ quantity: 10, estimate: 95 }]);
      const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
      await svc.poService.confirm(env.as('collector'), purchaseOrderId);
      expect(await prisma.approvalInstance.count({ where: { transactionId: purchaseOrderId } })).toBe(0);

      await svc.poService.revise(env.as('collector'), purchaseOrderId, {
        reason: 'Extra tie wire',
        currencyCode: 'USD',
        effectiveFrom: '2026-10-08',
        lines: [
          {
            lineType: 'MATERIAL',
            materialCode: 'REBAR-12',
            description: 'Rebar',
            uomCode: 'TON',
            orderedQuantity: 10,
            unitPrice: 95,
            spendCategoryId: env.spendCategoryId,
          },
        ],
      });
      const gated = await refusal(svc.poService.confirm(env.as('collector'), purchaseOrderId));
      expect(gated.status).toBe(409);
      expect(await prisma.approvalInstance.count({ where: { transactionId: purchaseOrderId } })).toBe(1);
    });

    it('a PO not raised from an award still opens its own approval', async () => {
      const po = await svc.poService.create(env.as('collector'), {
        supplierId: env.supplierId,
        currencyCode: 'USD',
        effectiveFrom: '2026-10-01',
        lines: [
          { lineType: 'MATERIAL', materialCode: 'REBAR-12', description: 'Rebar', uomCode: 'TON', orderedQuantity: 1, unitPrice: 10, spendCategoryId: env.spendCategoryId },
        ],
      });
      expect((await refusal(svc.poService.confirm(env.as('collector'), po!.id))).status).toBe(409);
      expect(await prisma.approvalInstance.count({ where: { transactionId: po!.id } })).toBe(1);
    });

    it('supplier swapped after raising → not covered (normal gate); a draft above the award → 409 PO_EXCEEDS_AWARD', async () => {
      const swapped = await awarded('950.00', [{ quantity: 10, estimate: 95 }]);
      const a = await svc.orders.raiseOrder(env.as('collector'), swapped.request.id, {});
      const other = await prisma.supplier.create({
        data: { organizationId: env.orgId, code: `SW-${Date.now().toString(36)}`, name: 'Swapped', status: 'ACTIVE' },
      });
      await prisma.purchaseOrder.update({ where: { id: a.purchaseOrderId }, data: { supplierId: other.id } });
      expect((await refusal(svc.poService.confirm(env.as('collector'), a.purchaseOrderId))).status).toBe(409);
      expect(await prisma.approvalInstance.count({ where: { transactionId: a.purchaseOrderId } })).toBe(1);

      const over = await awarded('950.00', [{ quantity: 10, estimate: 95 }]);
      const b = await svc.orders.raiseOrder(env.as('collector'), over.request.id, {});
      const line = (await poOf(b.purchaseOrderId)).revisions[0].lines[0];
      await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { unitPrice: new Decimal('95.01') } });
      expect(await refusal(svc.poService.confirm(env.as('collector'), b.purchaseOrderId))).toEqual({
        status: 409,
        code: 'PO_EXCEEDS_AWARD',
      });
      expect(await prisma.approvalInstance.count({ where: { transactionId: b.purchaseOrderId } })).toBe(0);
    });
  });

  describe('MR allocation hardening (wireAllocations)', () => {
    const allocate = (mrLineId: string) =>
      svc.poService.create(env.as('collector'), {
        supplierId: env.supplierId,
        currencyCode: 'USD',
        effectiveFrom: '2026-10-01',
        lines: [
          {
            lineType: 'MATERIAL',
            materialCode: 'REBAR-12',
            description: 'Rebar',
            uomCode: 'TON',
            orderedQuantity: 1,
            unitPrice: 10,
            spendCategoryId: env.spendCategoryId,
            mrLineAllocations: [{ materialRequestLineId: mrLineId, allocatedQuantity: 1 }],
          },
        ],
      });

    it("refuses a SUBMITTED MR's line and another organization's line", async () => {
      const submitted = await createApprovedMr(prisma, env, { status: 'SUBMITTED' });
      await expect(allocate(submitted.lines[0].id)).rejects.toThrow(/not approved/);

      const other = await createQuotationEnv(prisma);
      try {
        const foreign = await createApprovedMr(prisma, other);
        await expect(allocate(foreign.lines[0].id)).rejects.toThrow(/not found/);
      } finally {
        await cleanupQuotationEnv(prisma, other);
      }
    });
  });
});
