import { Injectable } from '@nestjs/common';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type Db = ReturnType<TenancyService['getClient']>;

/** Step 6 — the reads behind the month-end close checklist, and its one setting. */
@Injectable()
export class CloseChecklistRepository {
  constructor(private readonly tenancy: TenancyService) {}

  db(): Db {
    return this.tenancy.getClient();
  }

  periods(db: Db, organizationId: string) {
    return db.accountingPeriod.findMany({
      where: { organizationId },
      orderBy: { startDate: 'desc' },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });
  }

  /** Documents dated in the period that are not posted yet, by queue. */
  async unposted(db: Db, organizationId: string, from: Date, to: Date) {
    const [invoices, receipts, bills, payments] = await Promise.all([
      db.clientInvoice.count({
        where: { organizationId, invoiceDate: { gte: from, lte: to }, OR: [{ documentStatus: 'DRAFT' }, { documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }] },
      }),
      db.paymentReceipt.count({
        where: { organizationId, accountingDate: { gte: from, lte: to }, postingStatus: 'NOT_POSTED', documentStatus: { notIn: ['CANCELLED', 'REJECTED'] } },
      }),
      db.supplierBill.count({
        where: { organizationId, billDate: { gte: from, lte: to }, OR: [{ documentStatus: { in: ['DRAFT', 'SUBMITTED'] } }, { documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }] },
      }),
      db.supplierPayment.count({
        where: { organizationId, accountingDate: { gte: from, lte: to }, postingStatus: 'NOT_POSTED', documentStatus: { in: ['DRAFT', 'APPROVED', 'RELEASED'] } },
      }),
    ]);
    return { invoices, receipts, bills, payments };
  }

  async requireBankReconciliation(db: Db, organizationId: string): Promise<boolean> {
    const policy = await db.bankingPolicy.findUnique({ where: { organizationId }, select: { requireBankReviewBeforeClose: true } });
    return policy?.requireBankReviewBeforeClose ?? false;
  }

  setRequireBankReconciliation(db: Db, organizationId: string, value: boolean, userId: string) {
    return db.bankingPolicy.upsert({
      where: { organizationId },
      create: { organizationId, requireBankReviewBeforeClose: value, updatedBy: userId },
      update: { requireBankReviewBeforeClose: value, updatedBy: userId },
    });
  }
}
