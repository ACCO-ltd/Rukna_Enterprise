import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type Db = Prisma.TransactionClient | ReturnType<TenancyService['getClient']>;

export interface OpeningItem {
  organizationId: string;
  partyId: string;
  /** The date the balance is owed as of; the item falls due `termsDays` after it. */
  openingDate: Date;
  termsDays: number;
  amount: Decimal;
  batchReference: string;
  createdBy: string;
}

/**
 * Step 5 — the import's own reads and writes: whether opening balances are still open, and the
 * open AR and AP items a balance becomes. Suppliers and clients themselves are written by their
 * owning services.
 */
@Injectable()
export class SetupImportRepository {
  constructor(private readonly tenancy: TenancyService) {}

  db() {
    return this.tenancy.getClient();
  }

  /** The opening-balance journal is posted once; after that, balances come in by journal only. */
  async openingJournalPosted(db: Db, organizationId: string): Promise<boolean> {
    const count = await db.journalEntry.count({ where: { organizationId, sourceDocumentType: 'OPENING_BALANCE' }, take: 1 });
    return count > 0;
  }

  /** The highest number already used in `SUP-000123` style codes, so generated codes never collide. */
  async highestSupplierNumber(db: Db, organizationId: string): Promise<number> {
    const rows = await db.supplier.findMany({ where: { organizationId, code: { startsWith: 'SUP-' } }, select: { code: true } });
    return rows.reduce((max, r) => {
      const n = /^SUP-(\d+)$/.exec(r.code)?.[1];
      return n ? Math.max(max, Number(n)) : max;
    }, 0);
  }

  /**
   * An open supplier balance: an approved bill in OPENING_BALANCE status, exactly as the
   * opening-balance wizard records one, so the AP tie-out counts it.
   */
  async createOpeningBill(tx: Prisma.TransactionClient, item: OpeningItem, reference: string): Promise<void> {
    await tx.supplierBill.create({
      data: {
        organizationId: item.organizationId,
        supplierId: item.partyId,
        supplierInvoiceNumber: reference,
        supplierInvoiceNumberNorm: reference.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        billDate: item.openingDate,
        dueDate: addDays(item.openingDate, item.termsDays),
        currencyCode: 'USD',
        subtotal: item.amount,
        totalAmount: item.amount,
        outstandingAmount: item.amount,
        documentStatus: 'APPROVED',
        postingStatus: 'OPENING_BALANCE',
        migrationBatchId: item.batchReference,
        createdBy: item.createdBy,
      },
    });
  }

  /** An open client balance: an approved invoice in OPENING_BALANCE status, as the wizard records one. */
  async createOpeningInvoice(tx: Prisma.TransactionClient, item: OpeningItem, reference: string): Promise<void> {
    await tx.clientInvoice.create({
      data: {
        organizationId: item.organizationId,
        clientId: item.partyId,
        sourceIpcId: null,
        invoiceDate: item.openingDate,
        dueDate: addDays(item.openingDate, item.termsDays),
        currencyCode: 'USD',
        subtotal: item.amount,
        totalAmount: item.amount,
        outstandingAmount: item.amount,
        billingAddressSnapshot: { migratedFrom: 'SPREADSHEET_IMPORT', invoiceRef: reference },
        documentStatus: 'APPROVED',
        postingStatus: 'OPENING_BALANCE',
        migrationBatchId: item.batchReference,
        createdBy: item.createdBy,
      },
    });
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
