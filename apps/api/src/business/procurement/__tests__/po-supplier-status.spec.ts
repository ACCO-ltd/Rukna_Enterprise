/**
 * A purchase order can only be raised to an ACTIVE supplier. An inactive supplier is retired
 * from new business; the create is refused with a plain message and nothing is written.
 *
 * Real DB (rukna_test).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ProcurementFixtureFactory, type ProcurementTestEnv } from './helpers/procurement-fixture.factory.js';
import { buildProcurementServices, type ProcurementServices } from './helpers/build-procurement-services.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: ProcurementServices;
let inactiveSupplierId: string;

const order = (supplierId: string) => ({
  supplierId,
  currencyCode: 'USD',
  effectiveFrom: '2026-08-15',
  lines: [
    {
      lineType: 'MATERIAL' as const,
      materialCode: 'REBAR-12',
      description: '12mm Rebar',
      uomCode: 'TON',
      orderedQuantity: 1,
      unitPrice: 100,
      spendCategoryId: env.spendCategoryId,
    },
  ],
});

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  svc = buildProcurementServices(prisma);
  const inactive = await prisma.supplier.create({
    data: { organizationId: env.orgId, code: 'SUP-OLD', name: 'Retired Cement Ltd', status: 'INACTIVE' },
  });
  inactiveSupplierId = inactive.id;
});

afterAll(async () => {
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

describe('PO create — supplier status', () => {
  it('refuses an inactive supplier with a clear 409 and writes nothing', async () => {
    const err = await svc.poService.create(env.identity, order(inactiveSupplierId)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toMatch(/Retired Cement Ltd is inactive/);

    const count = await prisma.purchaseOrder.count({
      where: { organizationId: env.orgId, supplierId: inactiveSupplierId },
    });
    expect(count).toBe(0);
  });

  it('refuses an unknown supplier with 404', async () => {
    await expect(
      svc.poService.create(env.identity, order('00000000-0000-0000-0000-000000000000')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts an active supplier', async () => {
    const po = await svc.poService.create(env.identity, order(env.supplierId));
    expect(po?.status).toBe('DRAFT');
  });
});
