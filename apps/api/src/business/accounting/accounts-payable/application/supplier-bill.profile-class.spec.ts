/**
 * Review M1 — a supplier bill line may only debit a cost or expense account. A profile that
 * resolves to INCOME (e.g. INC_42100, PROJECT_REVENUE) is refused at create/update with
 * 400 POSTING_PROFILE_NOT_EXPENSE. The post path is proven against Postgres in __tests__/setup.spec.ts.
 */
import { SupplierBillService } from './supplier-bill.service.js';

const identity = { activeOrganizationId: 'o1', userId: 'u1' } as never;

function build(accountClass: string | null) {
  const client = {
    postingProfile: {
      findFirst: jest.fn().mockResolvedValue(accountClass === null ? null : { id: 'pp1', code: 'X' }),
    },
    postingProfileVersion: { findFirst: jest.fn().mockResolvedValue({ accountId: 'acc1' }) },
  };
  const accountRepo = {
    findById: jest.fn().mockResolvedValue({ code: '42100', versions: [{ accountClass }] }),
  };
  const repo = {
    findBySupplierInvoiceNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'b-new' }),
  };
  const svc = new SupplierBillService(
    { getClient: () => client } as never,
    repo as never,
    accountRepo as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { svc, repo };
}

const dto = (code: string) => ({
  supplierId: 's1', supplierInvoiceNumber: 'INV-1', billDate: '2026-09-01', dueDate: '2026-10-01',
  currencyCode: 'USD', billId: 'x', apAccountCode: '20000', projectId: undefined,
  lines: [{ description: 'hire', netAmount: 100, vatAmount: 0, expenseProfileCode: code }],
  // A PO-less bill with no project needs no cost target — keeps the test on the profile rule.
}) as never;

describe('SupplierBillService — expense profile class (M1)', () => {
  it('refuses a profile that resolves to an INCOME account', async () => {
    const { svc, repo } = build('INCOME');
    await expect(svc.create(identity, dto('INC_42100'))).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'POSTING_PROFILE_NOT_EXPENSE' },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each(['COST_OF_SALES', 'EXPENSE'])('accepts a %s profile', async (cls) => {
    const { svc, repo } = build(cls);
    await expect(svc.create(identity, dto('COST_51100'))).resolves.toEqual({ id: 'b-new' });
    expect(repo.create).toHaveBeenCalled();
  });

  it('an unknown profile is still left to the post-time check', async () => {
    const { svc } = build(null);
    await expect(svc.create(identity, dto('NOPE'))).resolves.toEqual({ id: 'b-new' });
  });
});
