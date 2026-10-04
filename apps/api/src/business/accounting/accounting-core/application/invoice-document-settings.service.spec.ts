import { UnprocessableEntityException } from '@nestjs/common';

import { InvoiceDocumentSettingsService } from './invoice-document-settings.service';
import {
  InvoiceDocumentPolicyRepository,
  resolveInvoiceDocumentSnapshot,
} from '../infrastructure/invoice-document-policy.repository';

const identity = { userId: 'u-1', activeOrganizationId: 'org-1' } as never;

function fakePrisma(over: { policy?: object | null; bank?: object | null; user?: object | null } = {}) {
  const prisma = {
    invoiceDocumentPolicy: {
      findUnique: jest.fn().mockResolvedValue(over.policy ?? null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    bankAccount: { findFirst: jest.fn().mockResolvedValue(over.bank ?? null) },
    user: { findFirst: jest.fn().mockResolvedValue(over.user ?? null) },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

function build(prisma: ReturnType<typeof fakePrisma>) {
  return new InvoiceDocumentSettingsService(
    { getClient: () => prisma } as never,
    new InvoiceDocumentPolicyRepository(),
  );
}

describe('InvoiceDocumentSettingsService', () => {
  it('reads defaults when nothing is configured', async () => {
    const view = await build(fakePrisma()).get(identity);
    expect(view).toMatchObject({ bankAccountId: null, notes: null, signatoryUserId: null, signatoryTitle: null });
    expect(view.defaultNotes.length).toBeGreaterThan(0);
  });

  it('saves a receipts-enabled bank account, trimmed notes and a signatory, with an audit row', async () => {
    const prisma = fakePrisma({
      bank: { status: 'ACTIVE', allowsReceipts: true, accountName: 'Operating' },
      user: { id: 'u-2' },
    });
    await build(prisma).update(identity, {
      bankAccountId: 'bank-1',
      notes: '  Quote the invoice number.  ',
      signatoryUserId: 'u-2',
      signatoryTitle: 'Finance Manager',
    });
    expect(prisma.invoiceDocumentPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: 'org-1',
          bankAccountId: 'bank-1',
          notes: 'Quote the invoice number.',
          signatoryUserId: 'u-2',
          signatoryTitle: 'Finance Manager',
          updatedBy: 'u-1',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a closed or payments-only bank account and an unknown signatory', async () => {
    await expect(
      build(fakePrisma({ bank: { status: 'CLOSED', allowsReceipts: true, accountName: 'Old' } })).update(identity, {
        bankAccountId: 'bank-1',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(build(fakePrisma()).update(identity, { bankAccountId: 'missing' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(build(fakePrisma()).update(identity, { signatoryUserId: 'ghost' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('keeps omitted fields, clears nulls/blanks, and drops the title with the signatory', async () => {
    const prisma = fakePrisma({
      policy: { bankAccountId: 'bank-1', notes: 'Keep me', signatoryUserId: 'u-2', signatoryTitle: 'CFO', updatedAt: new Date() },
    });
    await build(prisma).update(identity, { signatoryUserId: null, notes: '   ' });
    expect(prisma.invoiceDocumentPolicy.upsert.mock.calls[0][0].update).toMatchObject({
      bankAccountId: 'bank-1',
      notes: null,
      signatoryUserId: null,
      signatoryTitle: null,
    });
  });
});

describe('resolveInvoiceDocumentSnapshot', () => {
  it('resolves the configured account and signatory to printable values', async () => {
    const prisma = fakePrisma({
      policy: { bankAccountId: 'bank-1', notes: 'Note', signatoryUserId: 'u-2', signatoryTitle: ' CFO ' },
      bank: { bankName: 'Premier Bank', accountName: 'Operating', accountNumber: '0011223344', swiftCode: null, currencyCode: 'USD' },
      user: { firstName: 'Ahmed', lastName: 'Ali' },
    });
    expect(await resolveInvoiceDocumentSnapshot(prisma as never, 'org-1')).toEqual({
      bank: { bankName: 'Premier Bank', accountName: 'Operating', accountNumber: '0011223344', swiftCode: null, currencyCode: 'USD' },
      notes: 'Note',
      signatory: { name: 'Ahmed Ali', title: 'CFO' },
    });
    // Only an ACTIVE, receipts-enabled account of this organisation is ever printed.
    expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bank-1', organizationId: 'org-1', status: 'ACTIVE', allowsReceipts: true } }),
    );
  });

  it('prints nothing for settings that no longer resolve', async () => {
    const prisma = fakePrisma({ policy: { bankAccountId: 'gone', notes: '  ', signatoryUserId: 'left', signatoryTitle: 'CFO' } });
    expect(await resolveInvoiceDocumentSnapshot(prisma as never, 'org-1')).toEqual({ bank: null, notes: null, signatory: null });
    expect(await resolveInvoiceDocumentSnapshot(fakePrisma() as never, 'org-1')).toEqual({ bank: null, notes: null, signatory: null });
  });
});
