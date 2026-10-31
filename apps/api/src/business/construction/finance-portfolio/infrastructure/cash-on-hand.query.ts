import { Decimal } from '@prisma/client/runtime/library';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type Prisma = ReturnType<TenancyService['getClient']>;

/**
 * What the organisation holds in its bank and cash accounts today: the posted balance of every
 * active CASH_AND_BANK account, in the ledger's single currency (ADR-024). The company-wide
 * forecast starts from it, so its running total is the cash expected on hand.
 */
export async function findCashOnHand(prisma: Prisma, organizationId: string, asOf: Date): Promise<Decimal> {
  const accounts = await prisma.account.findMany({
    where: { organizationId, versions: { some: { effectiveTo: null, accountSubtype: 'CASH_AND_BANK' } } },
    select: { id: true },
  });
  if (accounts.length === 0) return new Decimal(0);
  const sums = await prisma.journalLine.aggregate({
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      entry: { organizationId, status: 'POSTED', accountingDate: { lte: asOf } },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return new Decimal(sums._sum.debitAmount?.toString() ?? 0).minus(sums._sum.creditAmount?.toString() ?? 0);
}
