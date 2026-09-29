import { Decimal } from '@prisma/client/runtime/library';

import { ClientInvoiceService } from './client-invoice.service.js';

/**
 * EVT-AR-002 must reverse every dimension the original posting carried. The reversal used to
 * drop `projectId`, so the original revenue credit stayed on the project while the reversing
 * debit landed off it — project revenue, and the project P&L, kept a reversed invoice.
 */
describe('ClientInvoiceService.reverse — dimensions', () => {
  it('carries each original line’s projectId onto its reversing line', async () => {
    const originalLines = [
      { accountId: 'ar', debitAmount: new Decimal(1050), creditAmount: new Decimal(0), projectId: null, clientId: 'c1', contractId: 'k1', description: 'AR', sourceSubledgerType: null },
      { accountId: 'rev', debitAmount: new Decimal(0), creditAmount: new Decimal(1000), projectId: 'p1', clientId: null, contractId: 'k1', description: 'Revenue', sourceSubledgerType: null },
      { accountId: 'vat', debitAmount: new Decimal(0), creditAmount: new Decimal(50), projectId: null, clientId: null, contractId: null, description: 'Tax', sourceSubledgerType: null },
    ];
    const prisma = {
      clientReceiptAllocation: { count: jest.fn().mockResolvedValue(0) },
      // reverse() now also blocks on posted credit notes; no credit note exists in this scenario.
      creditNote: { count: jest.fn().mockResolvedValue(0) },
      journalEntry: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'je1', lines: originalLines }) },
      clientInvoice: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    const repo = {
      findById: jest.fn().mockResolvedValue({
        id: 'inv1',
        postingStatus: 'POSTED',
        reversalJournalEntryId: null,
        postedJournalEntryId: 'je1',
        invoiceNumber: 'INV-1',
        currencyCode: 'USD',
      }),
    };
    const postingPort = { post: jest.fn().mockResolvedValue({ journalEntryId: 'je2' }) };
    const service = new ClientInvoiceService(
      { getClient: () => prisma } as never,
      repo as never,
      {} as never,
      {} as never,
      postingPort as never,
      {} as never,
      {} as never,
    );

    await service
      .reverse(
        { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never,
        'inv1',
        { reversalDate: '2026-09-28', reason: 'Issued in error' },
      )
      .catch(() => undefined); // later bookkeeping in the transaction is not under test here

    const lines = postingPort.post.mock.calls[0]![0].lines as Array<{ accountId: string; projectId?: string; debitAmount: Decimal }>;
    const revenue = lines.find((l) => l.accountId === 'rev')!;
    expect(revenue.projectId).toBe('p1');
    expect(revenue.debitAmount.toString()).toBe('1000');
    expect(lines.find((l) => l.accountId === 'ar')!.projectId).toBeUndefined();
  });
});
