import { Decimal } from '@prisma/client/runtime/library';

import { ClientInvoiceService } from './client-invoice.service.js';
import { fakeTaxCodes } from '../../__tests__/helpers/fake-tax-codes.js';

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
        sourceIpcId: null,
        sourceInstallmentId: null,
        sourceBoqNodeId: null,
        retentionAmount: new Decimal(0),
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
      fakeTaxCodes() as never,
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

/**
 * Phase 0 H2 — reversing releases the invoice's unique source tag so the stage can be billed again,
 * unless variation billing lines hang off it (those are undone by a credit note).
 */
describe('ClientInvoiceService.reverse — source release', () => {
  async function reverseStageInvoice(hasVariationBilling: boolean) {
    const prisma = {
      clientReceiptAllocation: { count: jest.fn().mockResolvedValue(0) },
      creditNote: { count: jest.fn().mockResolvedValue(0) },
      journalEntry: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'je1', lines: [] }) },
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
        sourceIpcId: null,
        sourceInstallmentId: 'st-1',
        sourceBoqNodeId: null,
        retentionAmount: new Decimal(0),
      }),
      hasVariationBilling: jest.fn().mockResolvedValue(hasVariationBilling),
    };
    const service = new ClientInvoiceService(
      { getClient: () => prisma } as never,
      repo as never,
      {} as never,
      {} as never,
      { post: jest.fn().mockResolvedValue({ journalEntryId: 'je2' }) } as never,
      {} as never,
      {} as never,
      fakeTaxCodes() as never,
    );
    await service.reverse(
      { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never,
      'inv1',
      { reversalDate: '2026-10-27', reason: 'Issued in error' },
    );
    expect(repo.hasVariationBilling).toHaveBeenCalledWith(prisma, 'o1', 'inv1', 'st-1');
    return prisma.clientInvoice.update.mock.calls[0]![0].data as Record<string, unknown>;
  }

  it('releases the stage so it can be billed again', async () => {
    const data = await reverseStageInvoice(false);
    expect(data).toMatchObject({ postingStatus: 'REVERSED', sourceInstallmentId: null, sourceIpcId: null, sourceBoqNodeId: null });
  });

  it('keeps the stage on an invoice that carries variation billing lines', async () => {
    const data = await reverseStageInvoice(true);
    expect(data.postingStatus).toBe('REVERSED');
    expect(data).not.toHaveProperty('sourceInstallmentId');
  });
});
