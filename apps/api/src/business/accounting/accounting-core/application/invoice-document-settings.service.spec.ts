import { UnprocessableEntityException } from '@nestjs/common';

import { InvoiceDocumentSettingsService, validatePaymentAccounts } from './invoice-document-settings.service';
import {
  InvoiceDocumentPolicyRepository,
  normalizeInvoiceDocumentSnapshot,
  readPaymentAccounts,
  resolveInvoiceDocumentSnapshot,
} from '../infrastructure/invoice-document-policy.repository';

const identity = { userId: 'u-1', activeOrganizationId: 'org-1' } as never;

function fakePrisma(policy: object | null = null) {
  const prisma = {
    invoiceDocumentPolicy: {
      findUnique: jest.fn().mockResolvedValue(policy),
      upsert: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

function build(prisma: ReturnType<typeof fakePrisma>) {
  return new InvoiceDocumentSettingsService({ getClient: () => prisma } as never, new InvoiceDocumentPolicyRepository());
}

const banks = (n: number) => Array.from({ length: n }, (_, i) => ({ bankName: `Bank ${i + 1}`, accountNumber: `${i + 1}000` }));

describe('InvoiceDocumentSettingsService', () => {
  it('reads an empty table and defaults when nothing is configured', async () => {
    const view = await build(fakePrisma()).get(identity);
    expect(view).toMatchObject({ paymentAccounts: [], notes: null, signatoryName: null, signatoryTitle: null });
    expect(view.defaultNotes.length).toBeGreaterThan(0);
  });

  it('saves trimmed bank rows in order, notes and a typed signatory, with an audit row', async () => {
    const prisma = fakePrisma();
    await build(prisma).update(identity, {
      paymentAccounts: [
        { bankName: ' Salaam Bank ', accountNumber: ' 33020045871 ' },
        { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
      ],
      notes: '  Quote the invoice number.  ',
      signatoryName: ' Ahmed Ali ',
      signatoryTitle: 'Finance Manager',
    });
    expect(prisma.invoiceDocumentPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: 'org-1',
          paymentAccounts: [
            { bankName: 'Salaam Bank', accountNumber: '33020045871' },
            { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
          ],
          notes: 'Quote the invoice number.',
          signatoryName: 'Ahmed Ali',
          signatoryTitle: 'Finance Manager',
          updatedBy: 'u-1',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('keeps omitted fields and clears nulls/blanks', async () => {
    const prisma = fakePrisma({
      paymentAccounts: [{ bankName: 'My Bank', accountNumber: '1' }],
      notes: 'Keep me',
      signatoryName: 'Ahmed Ali',
      signatoryTitle: 'CFO',
      updatedAt: new Date(),
    });
    await build(prisma).update(identity, { signatoryTitle: null, notes: '   ' });
    expect(prisma.invoiceDocumentPolicy.upsert.mock.calls[0][0].update).toMatchObject({
      paymentAccounts: [{ bankName: 'My Bank', accountNumber: '1' }],
      notes: null,
      signatoryName: 'Ahmed Ali',
      signatoryTitle: null,
    });
  });

  it('refuses a row missing either field, more than eight rows, and over-long text', async () => {
    const service = build(fakePrisma());
    await expect(
      service.update(identity, { paymentAccounts: [{ bankName: 'Salaam Bank', accountNumber: '  ' }] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.update(identity, { paymentAccounts: banks(9) })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.update(identity, { signatoryName: 'x'.repeat(121) })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(validatePaymentAccounts(banks(8))).toHaveLength(8);
    expect(validatePaymentAccounts([])).toEqual([]);
  });
});

describe('invoice document snapshot', () => {
  it('resolves the policy to printable values', async () => {
    const prisma = fakePrisma({
      paymentAccounts: [{ bankName: 'Dahabshiil Bank', accountNumber: '100-2287' }],
      notes: 'Note',
      signatoryName: 'Ahmed Ali',
      signatoryTitle: ' CFO ',
    });
    expect(await resolveInvoiceDocumentSnapshot(prisma as never, 'org-1')).toEqual({
      paymentAccounts: [{ bankName: 'Dahabshiil Bank', accountNumber: '100-2287' }],
      notes: 'Note',
      signatory: { name: 'Ahmed Ali', title: 'CFO' },
    });
    expect(await resolveInvoiceDocumentSnapshot(fakePrisma() as never, 'org-1')).toEqual({
      paymentAccounts: [],
      notes: null,
      signatory: null,
    });
  });

  it('skips malformed stored rows rather than printing them half-empty', () => {
    expect(readPaymentAccounts('nope')).toEqual([]);
    expect(
      readPaymentAccounts([{ bankName: 'A', accountNumber: '1' }, { bankName: 'B' }, null, { bankName: ' ', accountNumber: '2' }]),
    ).toEqual([{ bankName: 'A', accountNumber: '1' }]);
  });

  it('reads the first template-v2 single-bank snapshot as a one-row table', () => {
    expect(
      normalizeInvoiceDocumentSnapshot({
        bank: { bankName: 'Premier Bank', accountName: 'Ops', accountNumber: '0102', swiftCode: null, currencyCode: 'USD' },
        notes: null,
        signatory: { name: 'Ahmed Ali', title: null },
      }),
    ).toEqual({
      paymentAccounts: [{ bankName: 'Premier Bank', accountNumber: '0102' }],
      notes: null,
      signatory: { name: 'Ahmed Ali', title: null },
    });
    expect(normalizeInvoiceDocumentSnapshot({ bank: null, notes: null, signatory: null }).paymentAccounts).toEqual([]);
  });
});
