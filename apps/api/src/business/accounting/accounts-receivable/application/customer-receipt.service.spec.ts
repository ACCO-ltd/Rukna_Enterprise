import { BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { CustomerReceiptService } from './customer-receipt.service.js';

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

// A posted receipt with $1,000 unallocated, for client-1, in USD.
const receipt = {
  id: 'r-1',
  postingStatus: 'POSTED',
  clientId: 'client-1',
  currencyCode: 'USD',
  unallocatedAmount: '1000',
  accountingDate: new Date('2026-06-05'),
  receiptDate: new Date('2026-06-05'),
};

const okInvoice = {
  clientId: 'client-1',
  currencyCode: 'USD',
  postingStatus: 'POSTED',
  outstandingAmount: '1000',
};

const dto = {
  receiptId: 'r-1',
  clientInvoiceId: 'inv-1',
  amount: 500,
  arAccountCode: 'AR',
  unappliedAccountCode: 'UN',
};

function build(invoice: unknown) {
  const receiptRepo = { findById: jest.fn().mockResolvedValue(receipt) };
  const invoiceRepo = { findById: jest.fn().mockResolvedValue(invoice) };
  const accountRepo = { findByCode: jest.fn() };
  const resolver = {
    resolveByCodeOrRole: jest.fn().mockResolvedValue({ id: 'acc-role', code: 'ROLE' }),
  };
  const postingPort = { post: jest.fn() };
  const tenancy = { getClient: () => ({}) };
  const service = new CustomerReceiptService(
    tenancy as never,
    receiptRepo as never,
    invoiceRepo as never,
    accountRepo as never,
    resolver as never,
    postingPort as never,
    { ensureSequence: jest.fn(), claimNext: jest.fn().mockResolvedValue({ formattedNumber: 'RCP-000001', rawNumber: 1 }) } as never,
  );
  return { service, accountRepo };
}

// Guards the receipt→invoice allocation (applies to milestone installment invoices and IPC invoices).
describe('receipt→invoice allocation guard (assertAllocatable)', () => {
  it('rejects an invoice belonging to a different client, before touching the GL', async () => {
    const { service, accountRepo } = build({ ...okInvoice, clientId: 'client-2' });
    await expect(service.allocate(identity, dto as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(accountRepo.findByCode).not.toHaveBeenCalled();
  });

  it('rejects a currency mismatch', async () => {
    const { service } = build({ ...okInvoice, currencyCode: 'SOS' });
    await expect(service.allocate(identity, dto as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects allocating to an unposted invoice', async () => {
    const { service } = build({ ...okInvoice, postingStatus: 'NOT_POSTED' });
    await expect(service.allocate(identity, dto as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects allocating more than the invoice outstanding (would go negative)', async () => {
    const { service } = build({ ...okInvoice, outstandingAmount: '300' }); // amount 500 > 300
    await expect(service.allocate(identity, dto as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// C1 — each allocation posts its own GL journal. Keying the journal on the receipt→invoice pair
// made a second allocation of the same pair hit the posting idempotency guard, so the balances
// moved while the GL did not.
describe('subsequent allocation posting', () => {
  function buildPosting(invoiceDate: Date) {
    let allocationSeq = 0;
    const receiptRepo = {
      findById: jest.fn().mockResolvedValue(receipt),
      createAllocation: jest.fn().mockImplementation(() => Promise.resolve({ id: `alloc-${++allocationSeq}` })),
      linkAllocationJournal: jest.fn().mockResolvedValue({}),
    };
    const invoice = { ...okInvoice, id: 'inv-1', invoiceDate };
    const invoiceRepo = { findById: jest.fn().mockResolvedValue(invoice) };
    const resolver = {
      resolveByCodeOrRole: jest.fn().mockResolvedValue({ id: 'acc-role', code: 'ROLE' }),
    };
    const postingPort = {
      post: jest.fn().mockImplementation(() => Promise.resolve({ journalEntryId: `je-${allocationSeq}` })),
    };
    const tx = {
      paymentReceipt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      clientInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)) };
    const service = new CustomerReceiptService(
      { getClient: () => prisma } as never,
      receiptRepo as never,
      invoiceRepo as never,
      { findByCode: jest.fn() } as never,
      resolver as never,
      postingPort as never,
      { ensureSequence: jest.fn(), claimNext: jest.fn() } as never,
    );
    return { service, receiptRepo, postingPort };
  }

  it('keys each allocation journal on its own allocation, so a second partial allocation of the same pair posts', async () => {
    const { service, receiptRepo, postingPort } = buildPosting(new Date('2026-06-01'));

    await service.allocate(identity, { ...dto, amount: 200 } as never);
    await service.allocate(identity, { ...dto, amount: 300 } as never);

    const keys = postingPort.post.mock.calls.map(([command]) => command.sourceDocumentId);
    expect(keys).toEqual(['r-1-alloc-alloc-1', 'r-1-alloc-alloc-2']);
    expect(receiptRepo.linkAllocationJournal).toHaveBeenNthCalledWith(1, expect.anything(), 'alloc-1', 'je-1');
    expect(receiptRepo.linkAllocationJournal).toHaveBeenNthCalledWith(2, expect.anything(), 'alloc-2', 'je-2');
  });

  it('dates the allocation on the later of the invoice date and the receipt date', async () => {
    const later = new Date('2026-08-20'); // invoice raised after the 2026-06-05 receipt
    const { service, receiptRepo, postingPort } = buildPosting(later);

    await service.allocate(identity, dto as never);

    expect(postingPort.post.mock.calls[0][0].accountingDate).toEqual(later);
    expect(receiptRepo.createAllocation.mock.calls[0][1].allocationDate).toEqual(later);
  });

  it('keeps the receipt date when the invoice predates the receipt', async () => {
    const { service, postingPort } = buildPosting(new Date('2026-05-01'));

    await service.allocate(identity, dto as never);

    expect(postingPort.post.mock.calls[0][0].accountingDate).toEqual(receipt.accountingDate);
  });
});
