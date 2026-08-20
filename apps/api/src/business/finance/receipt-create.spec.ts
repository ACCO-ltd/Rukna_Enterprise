import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../platform/tenancy/tenancy.service.js';
import { FinancePrismaRepository } from './infrastructure/finance-prisma.repository.js';
import { FinanceService } from './application/finance.service.js';

/**
 * Regression for the "you cannot record a client payment at all" bug: POST /receipts
 * (FinanceService.create) wrote `amount`/`currency` — fields that do not exist on
 * PaymentReceipt — and omitted the required, no-default columns `unallocatedAmount`
 * and `accountingDate`, so every create failed at the database with a 500.
 */
describe('FinanceService.create — records a client payment (POST /receipts)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `fin-org-${suffix}`;

  let identity: RequestIdentity;
  let clientId: string;
  let service: FinanceService;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `Fin Org ${suffix}`, slug: `fin-${suffix}`, status: 'ACTIVE' },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CLI-${suffix}`, name: 'Fin Client', status: 'ACTIVE' },
    });
    clientId = client.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `fin-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    service = new FinanceService(tenancy, new FinancePrismaRepository());
  });

  afterAll(async () => {
    await prisma.paymentReceipt.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('persists the receipt with unallocatedAmount = totalAmount and allocatedAmount = 0', async () => {
    const receipt = await service.create(identity, {
      clientId,
      receiptDate: '2026-06-15',
      amount: '125000.00',
      currency: 'USD',
    });

    expect(receipt.id).toBeDefined();

    const row = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(row.totalAmount.toString()).toBe('125000');
    expect(row.unallocatedAmount.toString()).toBe('125000');
    expect(row.allocatedAmount.toString()).toBe('0');
    expect(row.currencyCode).toBe('USD');
    expect(row.accountingDate).toBeInstanceOf(Date);
  });
});
