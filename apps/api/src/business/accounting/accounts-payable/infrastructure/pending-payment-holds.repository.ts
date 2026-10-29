import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * AP-1 — what unposted payments are holding on each bill.
 *
 * Raising a payment lowers the bills it settles at once (A16: `outstandingAmount` is what is left
 * to pay, so the same bill cannot be paid twice), but the ledger only moves when the payment
 * posts. Until then the bill is still owed. Every view that states what is OWED — the AP tie-out,
 * the payables aging, the supplier statement — adds these holds back; views that say what is left
 * TO PAY keep reading `outstandingAmount` alone.
 *
 * A hold is an allocation still NOT_POSTED on a payment that is neither rejected nor cancelled.
 */
export async function pendingPaymentHolds(db: Db, organizationId: string, billIds?: string[]): Promise<Map<string, Decimal>> {
  const rows = await db.supplierPaymentAllocation.groupBy({
    by: ['supplierBillId'],
    where: {
      organizationId,
      postingStatus: 'NOT_POSTED',
      payment: { documentStatus: { notIn: ['REJECTED', 'CANCELLED'] }, postingStatus: { in: ['NOT_POSTED', 'FAILED'] } },
      ...(billIds ? { supplierBillId: { in: billIds } } : {}),
    },
    _sum: { allocatedAmount: true },
  });
  return new Map(rows.map((r) => [r.supplierBillId, new Decimal(r._sum.allocatedAmount?.toString() ?? '0')]));
}

/** The sum of every hold — the AP tie-out's correction to Σ outstanding. */
export async function pendingPaymentHoldsTotal(db: Db, organizationId: string): Promise<Decimal> {
  const sum = await db.supplierPaymentAllocation.aggregate({
    where: {
      organizationId,
      postingStatus: 'NOT_POSTED',
      bill: { postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
      payment: { documentStatus: { notIn: ['REJECTED', 'CANCELLED'] }, postingStatus: { in: ['NOT_POSTED', 'FAILED'] } },
    },
    _sum: { allocatedAmount: true },
  });
  return new Decimal(sum._sum.allocatedAmount?.toString() ?? '0');
}
