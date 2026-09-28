import { SupplierBillRepository } from './supplier-bill.repository.js';
import { ClientInvoiceRepository } from '../../accounts-receivable/infrastructure/client-invoice.repository.js';

/** Flow plan PR 4 — Accounting lists can be narrowed to one project. */
describe('project filter on the Accounting lists', () => {
  it('matches a supplier bill coded to the project on its header or on any line', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new SupplierBillRepository().findAll({ supplierBill: { findMany } } as never, 'o1', {
      projectId: 'p1',
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'o1',
      OR: [{ projectId: 'p1' }, { lines: { some: { projectId: 'p1' } } }],
    });
  });

  it('leaves the bill list org-wide without a filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new SupplierBillRepository().findAll({ supplierBill: { findMany } } as never, 'o1');
    expect(findMany.mock.calls[0][0].where).toEqual({ organizationId: 'o1' });
  });

  it('narrows client invoices by project and client together', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new ClientInvoiceRepository().findAll({ clientInvoice: { findMany } } as never, 'o1', {
      clientId: 'c1',
      projectId: 'p1',
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'o1',
      clientId: 'c1',
      projectId: 'p1',
    });
  });
});
