import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { CreditNoteService } from './credit-note.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

// ─── Builder helpers ──────────────────────────────────────────────────────────

const POSTED_INVOICE = {
  id: 'inv-1',
  postingStatus: 'POSTED',
  outstandingAmount: new Decimal('105000.00'),
  subtotal: new Decimal('100000.00'),
  vatAmount: new Decimal('5000.00'),
  projectId: 'p-1',
  contractId: 'c-1',
  clientId: 'client-1',
  currencyCode: 'USD',
};

function buildPrisma(overrides: Partial<{
  invoice: unknown;
  creditNoteAggregate: { _sum: { totalAmount: unknown } };
  creditNote: unknown;
  variationOrder: unknown;
  existingCreditNoteForVariation: { _sum: { totalAmount: unknown } };
  $transaction: jest.Mock;
}> = {}) {
  const txPrisma = {
    creditNote: {
      update: jest.fn().mockResolvedValue({ id: 'cn-1', postingStatus: 'POSTED', creditNoteNumber: 'CN-000001' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
    },
    clientInvoice: {
      update: jest.fn().mockResolvedValue(null),
    },
    // $queryRaw used by the SELECT FOR UPDATE lock inside postCreditNote
    $queryRaw: jest.fn().mockResolvedValue([{ outstanding_amount: '105000.00' }]),
  };

  const $transaction = overrides.$transaction ?? jest.fn((fn: (tx: unknown) => unknown) => fn(txPrisma));

  const invoiceReturnValue = Object.prototype.hasOwnProperty.call(overrides, 'invoice')
    ? overrides.invoice
    : POSTED_INVOICE;

  return {
    clientInvoice: {
      findFirst: jest.fn().mockResolvedValue(invoiceReturnValue),
    },
    creditNote: {
      aggregate: jest.fn()
        .mockResolvedValueOnce(overrides.creditNoteAggregate ?? { _sum: { totalAmount: null } })
        .mockResolvedValue(overrides.existingCreditNoteForVariation ?? { _sum: { totalAmount: null } }),
      create: jest.fn().mockResolvedValue(overrides.creditNote ?? { id: 'cn-1', postingStatus: 'NOT_POSTED' }),
      findFirst: jest.fn().mockResolvedValue(
        overrides.creditNote ?? {
          id: 'cn-1',
          postingStatus: 'NOT_POSTED',
          netAmount: new Decimal('10000.00'),
          vatAmount: new Decimal('500.00'),
          totalAmount: new Decimal('10500.00'),
          accountingDate: new Date('2026-09-17'),
          invoiceId: 'inv-1',
        },
      ),
    },
    variationOrder: {
      findFirst: jest.fn().mockResolvedValue(overrides.variationOrder),
    },
    $transaction,
    txPrisma,
  };
}

function buildService(prismaOverrides?: Parameters<typeof buildPrisma>[0]) {
  const prisma = buildPrisma(prismaOverrides);
  const tenancy = { getClient: () => prisma };

  const sequenceRepo = {
    ensureSequence: jest.fn().mockResolvedValue(undefined),
    claimNext: jest.fn().mockResolvedValue({ formattedNumber: 'CN-000001', rawNumber: 1 }),
  };

  const mockArAccount = { id: 'acc-ar' };
  const mockRevAccount = { id: 'acc-rev' };
  const mockVatAccount = { id: 'acc-vat' };
  const resolver = {
    resolveByCodeOrRole: jest.fn()
      .mockResolvedValueOnce(mockArAccount)
      .mockResolvedValueOnce(mockRevAccount)
      .mockResolvedValue(mockVatAccount),
  };

  const postingPort = {
    post: jest.fn().mockResolvedValue({ journalEntryId: 'je-1', journalNumber: 'JE-000001' }),
  };

  const service = new CreditNoteService(
    tenancy as never,
    sequenceRepo as never,
    resolver as never,
    postingPort as never,
  );

  return { service, prisma, postingPort, sequenceRepo, resolver };
}

// ─── createCreditNote ─────────────────────────────────────────────────────────

describe('createCreditNote', () => {
  it('creates a credit note with NOT_POSTED status for a POSTED invoice', async () => {
    const { service, prisma } = buildService();
    const result = await service.createCreditNote(identity, {
      invoiceId: 'inv-1',
      reason: 'OMISSION',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });
    expect(result).toEqual({ id: 'cn-1', postingStatus: 'NOT_POSTED' });
    const createCall = prisma.creditNote.create.mock.calls[0][0];
    expect(createCall.data.postingStatus).toBe('NOT_POSTED');
  });

  it('derives vatAmount from original invoice tax rate (5% example: net 10k → vat 500)', async () => {
    const { service, prisma } = buildService();
    await service.createCreditNote(identity, {
      invoiceId: 'inv-1',
      reason: 'PRICE_ERROR',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });
    const createCall = prisma.creditNote.create.mock.calls[0][0];
    expect(createCall.data.vatAmount.toFixed(2)).toBe('500.00');
    expect(createCall.data.totalAmount.toFixed(2)).toBe('10500.00');
  });

  it('throws BadRequestException for a NOT_POSTED invoice', async () => {
    const { service } = buildService({
      invoice: { ...POSTED_INVOICE, postingStatus: 'NOT_POSTED' },
    });
    await expect(
      service.createCreditNote(identity, {
        invoiceId: 'inv-1',
        reason: 'OMISSION',
        netAmount: '1000.00',
        accountingDate: '2026-09-17',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for a REVERSED invoice', async () => {
    const { service } = buildService({
      invoice: { ...POSTED_INVOICE, postingStatus: 'REVERSED' },
    });
    await expect(
      service.createCreditNote(identity, {
        invoiceId: 'inv-1',
        reason: 'OMISSION',
        netAmount: '1000.00',
        accountingDate: '2026-09-17',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when invoice not found', async () => {
    const { service } = buildService({ invoice: null });
    await expect(
      service.createCreditNote(identity, {
        invoiceId: 'no-such',
        reason: 'OMISSION',
        netAmount: '1000.00',
        accountingDate: '2026-09-17',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws CREDIT_EXCEEDS_OUTSTANDING when new credit + existing credits exceed outstanding', async () => {
    // outstanding = 105,000; existing credited = 100,000; new CN total = 10,500 → exceeds
    const { service } = buildService({
      invoice: { ...POSTED_INVOICE, outstandingAmount: new Decimal('105000.00') },
      creditNoteAggregate: { _sum: { totalAmount: new Decimal('100000.00') } },
    });
    const err = await service.createCreditNote(identity, {
      invoiceId: 'inv-1',
      reason: 'OMISSION',
      netAmount: '10000.00', // total = 10,500; 100,000 + 10,500 = 110,500 > 105,000
      accountingDate: '2026-09-17',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'CREDIT_EXCEEDS_OUTSTANDING',
    });
  });
});

// ─── postCreditNote ────────────────────────────────────────────────────────────

describe('postCreditNote', () => {
  it('throws ConflictException when credit note is already posted', async () => {
    const { service } = buildService({
      creditNote: { id: 'cn-1', postingStatus: 'POSTED' },
    });
    await expect(
      service.postCreditNote(identity, { creditNoteId: 'cn-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when credit note not found', async () => {
    const { service, prisma } = buildService();
    prisma.creditNote.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.postCreditNote(identity, { creditNoteId: 'no-such' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('posts with EVT-AR-007 event type', async () => {
    const { service, postingPort } = buildService();
    await service.postCreditNote(identity, { creditNoteId: 'cn-1' });
    expect(postingPort.post).toHaveBeenCalledTimes(1);
    const postCall = postingPort.post.mock.calls[0][0];
    expect(postCall.eventType).toBe('EVT-AR-007');
  });

  it('posts with REVERSAL entry purpose', async () => {
    const { service, postingPort } = buildService();
    await service.postCreditNote(identity, { creditNoteId: 'cn-1' });
    const postCall = postingPort.post.mock.calls[0][0];
    expect(postCall.entryPurpose).toBe('REVERSAL');
  });

  it('journal has three lines: Dr Revenue, Dr VAT, Cr AR', async () => {
    const { service, postingPort } = buildService();
    await service.postCreditNote(identity, { creditNoteId: 'cn-1' });
    const postCall = postingPort.post.mock.calls[0][0];
    const lines = postCall.lines;
    expect(lines).toHaveLength(3);

    // Revenue debit
    const revLine = lines.find((l: { accountId: string }) => l.accountId === 'acc-rev');
    expect(revLine.debitAmount.toFixed(2)).toBe('10000.00');
    expect(new Decimal(revLine.creditAmount).toFixed(2)).toBe('0.00');

    // VAT debit
    const vatLine = lines.find((l: { accountId: string }) => l.accountId === 'acc-vat');
    expect(vatLine.debitAmount.toFixed(2)).toBe('500.00');
    expect(new Decimal(vatLine.creditAmount).toFixed(2)).toBe('0.00');

    // AR credit
    const arLine = lines.find((l: { accountId: string }) => l.accountId === 'acc-ar');
    expect(new Decimal(arLine.debitAmount).toFixed(2)).toBe('0.00');
    expect(arLine.creditAmount.toFixed(2)).toBe('10500.00');
  });

  it('journal is balanced: sum(debit) === sum(credit)', async () => {
    const { service, postingPort } = buildService();
    await service.postCreditNote(identity, { creditNoteId: 'cn-1' });
    const lines = postingPort.post.mock.calls[0][0].lines;
    const totalDebit = lines.reduce(
      (sum: Decimal, l: { debitAmount: Decimal }) => sum.plus(new Decimal(l.debitAmount)),
      new Decimal(0),
    );
    const totalCredit = lines.reduce(
      (sum: Decimal, l: { creditAmount: Decimal }) => sum.plus(new Decimal(l.creditAmount)),
      new Decimal(0),
    );
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });
});
