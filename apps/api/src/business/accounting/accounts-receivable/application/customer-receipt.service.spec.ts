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
