/** ADR-045 spec steps: an awarded request with an issued (OPEN) purchase order, receiving, bands. */
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { createApprovedMr, type MrLineSpec } from '../../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';
import { steps } from '../../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { seedBandSet, seedBuyerAdvanceBands } from '../../../../../platform/workflows/seeders/acco-workflows.seed.js';
import { accoSupplierPaymentBands } from '../../../../../platform/workflows/seeders/acco-value-bands.js';
import type { PaymentServices } from './build-payment-services.js';
import type { PaymentTestEnv } from './payment-fixture.js';

export function awardSteps(prisma: PrismaClient, env: PaymentTestEnv, svc: PaymentServices) {
  const s = steps(prisma, env, svc);

  /**
   * An AWARDED request (registered supplier, `total`) on a one-line MR (qty 10), its order raised
   * by the collector and confirmed (covered by the award) → PO OPEN, ordered = total.
   */
  async function awardedOrder(
    opts: { total?: string; path?: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER'; lines?: MrLineSpec[]; extraCollector?: boolean; effectiveFrom?: string } = {},
  ) {
    const total = opts.total ?? '1000.00';
    const lines = opts.lines ?? [{ quantity: 10, estimate: new Decimal(total).div(10).toNumber() }];
    const mr = await createApprovedMr(prisma, env, { lines });
    const opened = await svc.collect.open(env.as('collector'), mr.id);
    await s.addQuote(opened.request.id, { supplierId: env.supplierId });
    await s.addQuote(opened.request.id, { storeName: `Other A ${mr.id.slice(-6)}` }, { persona: opts.extraCollector ? 'collector2' : 'collector' });
    await s.addQuote(opened.request.id, { storeName: `Other B ${mr.id.slice(-6)}` });
    const sent = await svc.collect.send(env.as('collector'), opened.request.id);
    const [a, b, c] = sent.quotes;
    await svc.selection.enterTotal(env.as('selector'), sent.id, a.id, total);
    await svc.selection.enterTotal(env.as('selector'), sent.id, b.id, new Decimal(total).add(100).toFixed(2));
    await svc.selection.enterTotal(env.as('selector'), sent.id, c.id, new Decimal(total).add(200).toFixed(2));
    await svc.awards.award(env.as('selector'), sent.id, { quoteId: a.id, paymentPath: opts.path ?? 'BUYER_CASH' });
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), sent.id, {});
    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
    // The order's effective date is the award date (the real clock); pin it so the payment dates
    // the specs use (from 2026-10-01) are on or after it (QA LOW: no payment before the order).
    await prisma.purchaseOrderRevision.updateMany({
      where: { purchaseOrderId },
      data: { effectiveFrom: new Date(opts.effectiveFrom ?? '2026-10-01') },
    });
    return { requestId: sent.id, poId: purchaseOrderId, mrId: mr.id };
  }

  /** The PO's active-revision lines. */
  const poLines = async (poId: string) =>
    (
      await prisma.purchaseOrderRevision.findFirstOrThrow({
        where: { purchaseOrderId: poId, status: 'ACTIVE' },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      })
    ).lines;

  /** The receiver posts a GRN accepting `fraction` (default all) of every line. */
  async function receive(poId: string, fraction = 1) {
    const lines = await poLines(poId);
    const grn = await svc.grnService.create(env.receiver, {
      purchaseOrderId: poId,
      deliveryDate: '2026-10-08',
      lines: lines.map((l) => {
        const qty = new Decimal(l.orderedQuantity.toString()).mul(fraction).toNumber();
        return { purchaseOrderLineId: l.id, receivedQuantity: qty, acceptedQuantity: qty, qualityStatus: 'ACCEPTED' as const };
      }),
    });
    await svc.grnService.post(env.receiver, grn!.id);
    return grn;
  }

  /** Seeds the supplier-payment + buyer-advance bands and switches them all on (or off). */
  async function setPaymentBandsActive(isActive: boolean) {
    const log = console.log;
    console.log = () => undefined;
    try {
      await seedBandSet(prisma, env.orgId, {
        entityType: 'SupplierPayment',
        fromState: 'DRAFT',
        toState: 'APPROVED',
        transactionType: 'SUPPLIER_PAYMENT' as never,
        bands: accoSupplierPaymentBands(),
      });
      await seedBuyerAdvanceBands(prisma, env.orgId);
    } finally {
      console.log = log;
    }
    const bindings = await prisma.workflowTriggerBinding.findMany({
      where: { organizationId: env.orgId, entityType: { in: ['SupplierPayment', 'BuyerAdvance'] } },
      select: { id: true, workflowDefinitionId: true },
    });
    await prisma.workflowTriggerBinding.updateMany({ where: { id: { in: bindings.map((b) => b.id) } }, data: { isActive } });
    await prisma.workflowDefinition.updateMany({
      where: { id: { in: bindings.map((b) => b.workflowDefinitionId) } },
      data: { isActive },
    });
  }

  const release = (
    requestId: string,
    over: Partial<{ amount: string; recipient: string; bankAccountId: string; advancedAt: string; key: string; applyToBillId: string; method: 'CASH' | 'MOBILE_MONEY' | 'BANK' }> = {},
    as = env.as('selector'),
  ) =>
    svc.advances.release(as, {
      idempotencyKey: over.key ?? randomUUID(),
      quotationRequestId: requestId,
      recipientUserId: over.recipient ?? env.userIds.collector,
      amount: over.amount ?? '1000.00',
      bankAccountId: over.bankAccountId ?? env.bank.cashBoxId,
      paymentMethod: over.method ?? 'CASH',
      advancedAt: over.advancedAt ?? '2026-10-08',
      applyToBillId: over.applyToBillId,
    });

  return { ...s, awardedOrder, poLines, receive, setPaymentBandsActive, release };
}
