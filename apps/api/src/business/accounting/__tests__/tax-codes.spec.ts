/**
 * TX — ADR-041 client invoice tax from configured tax codes, against Postgres.
 *
 *   TX-01  no default sales tax → 409 TAX_NOT_CONFIGURED (no fallback rate)
 *   TX-02  omitted → the default; the invoice snapshots its code and rate, and tax = subtotal × rate
 *   TX-03  another code than the default: refused without manage:accounting (403), allowed with it;
 *          "No tax" (0%) raises an invoice with no tax
 *   TX-04  inactive, INPUT, or not-yet-in-force codes are refused (422); a broken default is 409
 *   TX-05  changing the default never changes an invoice already raised
 *   TX-06  the default cannot be deactivated (409); only an ACTIVE OUTPUT code can be the default
 *   TX-07  create validates code, rate and uniqueness, and every change is audited
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { TaxCodeRepository } from '../accounting-core/infrastructure/tax-code.repository';
import { TaxCodeService } from '../accounting-core/application/tax-code.service';
import { buildServices } from './helpers/build-services';

const prisma = new PrismaClient();
const tenancy = { getClient: () => prisma } as never;
const taxCodes = new TaxCodeService(tenancy, new TaxCodeRepository());

const orgs: string[] = [];

async function makeOrg(permissions: string[] = ['*']): Promise<{ finance: RequestIdentity; preparer: RequestIdentity; clientId: string }> {
  const suffix = `tx${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({ data: { id: orgId, name: `Tax ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' } });
  const user = await prisma.user.create({
    data: { email: `tax-${suffix}@tx.test`, passwordHash: 'x', firstName: 'Tax', lastName: 'TX', organizationId: orgId },
  });
  const client = await prisma.client.create({ data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Hodan Water' } });
  orgs.push(orgId);
  const base = { userId: user.id, activeOrganizationId: orgId, tenantSlug: `test-${suffix}`, roles: ['finance'] };
  return {
    finance: { ...base, permissions },
    // Raises invoices (manage:receivable) but is not Finance (no manage:accounting).
    preparer: { ...base, permissions: ['manage:receivable', 'view:accounting'] },
    clientId: client.id,
  };
}

async function cleanup(orgId: string) {
  await prisma.auditLog.deleteMany({ where: { orgId } });
  await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
  await prisma.taxPolicy.deleteMany({ where: { organizationId: orgId } });
  await prisma.taxCode.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

afterAll(async () => {
  for (const orgId of orgs) await cleanup(orgId);
  await prisma.$disconnect();
});

const create = (who: RequestIdentity, code: string, ratePercent: string, extra: Partial<{ direction: 'OUTPUT' | 'INPUT'; effectiveFrom: string }> = {}) =>
  taxCodes.create(who, { code, name: `${code} ${ratePercent}%`, ratePercent, direction: extra.direction ?? 'OUTPUT', effectiveFrom: extra.effectiveFrom ?? '2026-01-01' });

const idOf = async (orgId: string, code: string) =>
  (await prisma.taxCode.findUniqueOrThrow({ where: { organizationId_code: { organizationId: orgId, code } } })).id;

function raise(who: RequestIdentity, clientId: string, subtotal: string, taxCodeId?: string, invoiceDate = '2026-10-01') {
  const { clientInvoiceService } = buildServices(prisma);
  return clientInvoiceService.generateStandaloneCharge(who, {
    clientId,
    projectId: undefined as never,
    contractId: undefined as never,
    currencyCode: 'USD',
    subtotal,
    label: 'Extra scope',
    invoiceDate,
    dueDate: '2026-10-31',
    ...(taxCodeId !== undefined ? { taxCodeId } : {}),
  });
}

describe('ADR-041 — client invoice tax codes', () => {
  it('TX-01: no default sales tax → 409 TAX_NOT_CONFIGURED', async () => {
    const { finance, clientId } = await makeOrg();
    await expect(raise(finance, clientId, '1000.00')).rejects.toMatchObject({
      status: 409, response: { errorCode: 'TAX_NOT_CONFIGURED' },
    });
    expect(await prisma.clientInvoice.count({ where: { organizationId: finance.activeOrganizationId } })).toBe(0);
  });

  it('TX-02: omitted → the default; the invoice snapshots code and rate', async () => {
    const { finance, preparer, clientId } = await makeOrg();
    await create(finance, 'VAT5_OUT', '5');
    await taxCodes.setDefaultOutput(finance, await idOf(finance.activeOrganizationId, 'VAT5_OUT'));

    const invoice = await raise(preparer, clientId, '33.33');

    expect(invoice.taxCodeId).toBe(await idOf(finance.activeOrganizationId, 'VAT5_OUT'));
    expect(invoice.taxRate.toString()).toBe('5');
    expect(invoice.vatAmount.toString()).toBe('1.67'); // 33.33 × 5% = 1.6665 → 1.67
    expect(invoice.totalAmount.toString()).toBe('35');
    // Asking for the default by id is not an override.
    await expect(raise(preparer, clientId, '100.00', invoice.taxCodeId!)).resolves.toMatchObject({ vatAmount: expect.anything() });
  });

  it('TX-03: another code is Finance only; "No tax" raises an invoice without tax', async () => {
    const { finance, preparer, clientId } = await makeOrg();
    await create(finance, 'VAT5_OUT', '5');
    await create(finance, 'EXEMPT', '0');
    await taxCodes.setDefaultOutput(finance, await idOf(finance.activeOrganizationId, 'VAT5_OUT'));
    const exempt = await idOf(finance.activeOrganizationId, 'EXEMPT');

    await expect(raise(preparer, clientId, '1000.00', exempt)).rejects.toMatchObject({
      status: 403, response: { errorCode: 'TAX_CODE_OVERRIDE_FORBIDDEN' },
    });
    const financeOnly = { ...finance, permissions: ['manage:accounting', 'manage:receivable'] };
    const invoice = await raise(financeOnly, clientId, '1000.00', exempt);
    expect(invoice.taxRate.toString()).toBe('0');
    expect(invoice.vatAmount.toString()).toBe('0');
    expect(invoice.totalAmount.toString()).toBe('1000');
  });

  it('TX-04: inactive, INPUT and not-yet-in-force codes are refused; a broken default is 409', async () => {
    const { finance, clientId } = await makeOrg();
    const orgId = finance.activeOrganizationId;
    await create(finance, 'VAT5_OUT', '5');
    await create(finance, 'VAT5_IN', '5', { direction: 'INPUT' });
    await create(finance, 'VAT6_OUT', '6', { effectiveFrom: '2027-01-01' });
    await create(finance, 'OLD10', '10');
    await taxCodes.setDefaultOutput(finance, await idOf(orgId, 'VAT5_OUT'));
    await taxCodes.setActive(finance, await idOf(orgId, 'OLD10'), false);

    for (const code of ['VAT5_IN', 'VAT6_OUT', 'OLD10']) {
      await expect(raise(finance, clientId, '100.00', await idOf(orgId, code))).rejects.toMatchObject({
        status: 422, response: { errorCode: 'TAX_CODE_NOT_APPLICABLE' },
      });
    }
    // The 6% code applies from its start date.
    await expect(raise(finance, clientId, '100.00', await idOf(orgId, 'VAT6_OUT'), '2027-02-01')).resolves.toMatchObject({});

    // A default that is not in force on the invoice date is a configuration problem, not the user's.
    await prisma.taxCode.update({ where: { id: await idOf(orgId, 'VAT5_OUT') }, data: { effectiveFrom: new Date('2030-01-01') } });
    await expect(raise(finance, clientId, '100.00')).rejects.toMatchObject({
      status: 409, response: { errorCode: 'TAX_NOT_CONFIGURED' },
    });
  });

  it('TX-05: changing the default never changes an invoice already raised', async () => {
    const { finance, clientId } = await makeOrg();
    const orgId = finance.activeOrganizationId;
    await create(finance, 'VAT5_OUT', '5');
    await create(finance, 'VAT10_OUT', '10');
    await taxCodes.setDefaultOutput(finance, await idOf(orgId, 'VAT5_OUT'));
    const before = await raise(finance, clientId, '1000.00');

    await taxCodes.setDefaultOutput(finance, await idOf(orgId, 'VAT10_OUT'));
    const after = await raise(finance, clientId, '1000.00');

    const reread = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: before.id } });
    expect([reread.taxRate.toString(), reread.vatAmount.toString()]).toEqual(['5', '50']);
    expect([after.taxRate.toString(), after.vatAmount.toString()]).toEqual(['10', '100']);
  });

  it('TX-06: the default cannot be deactivated; only an ACTIVE OUTPUT code can be the default', async () => {
    const { finance } = await makeOrg();
    const orgId = finance.activeOrganizationId;
    await create(finance, 'VAT5_OUT', '5');
    await create(finance, 'VAT5_IN', '5', { direction: 'INPUT' });
    await taxCodes.setDefaultOutput(finance, await idOf(orgId, 'VAT5_OUT'));

    await expect(taxCodes.setActive(finance, await idOf(orgId, 'VAT5_OUT'), false)).rejects.toMatchObject({
      status: 409, response: { errorCode: 'TAX_CODE_IS_DEFAULT' },
    });
    await expect(taxCodes.setDefaultOutput(finance, await idOf(orgId, 'VAT5_IN'))).rejects.toMatchObject({
      status: 422, response: { errorCode: 'TAX_CODE_NOT_APPLICABLE' },
    });
    const view = await taxCodes.list(finance);
    expect(view.codes.filter((c) => c.isDefault).map((c) => c.code)).toEqual(['VAT5_OUT']);
  });

  it('TX-07: create validates code, rate and uniqueness; every change is audited', async () => {
    const { finance } = await makeOrg();
    const orgId = finance.activeOrganizationId;
    await expect(create(finance, 'VAT 5', '5')).rejects.toMatchObject({ response: { errorCode: 'TAX_CODE_INVALID' } });
    await expect(create(finance, 'BAD', '101')).rejects.toMatchObject({ response: { errorCode: 'TAX_RATE_INVALID' } });
    await expect(create(finance, 'BAD', '-1')).rejects.toMatchObject({ response: { errorCode: 'TAX_RATE_INVALID' } });

    await create(finance, 'vat12.5_o', '12.5');
    expect((await taxCodes.list(finance)).codes.map((c) => [c.code, c.ratePercent])).toEqual([['VAT12.5_O', '12.5']]);
    await expect(create(finance, 'VAT12.5_O', '12.5')).rejects.toMatchObject({ status: 409, response: { errorCode: 'TAX_CODE_TAKEN' } });

    const id = await idOf(orgId, 'VAT12.5_O');
    await taxCodes.setDefaultOutput(finance, id);
    await create(finance, 'EXEMPT', '0');
    await taxCodes.setActive(finance, await idOf(orgId, 'EXEMPT'), false);
    await taxCodes.setActive(finance, await idOf(orgId, 'EXEMPT'), true);

    const actions = (await prisma.auditLog.findMany({ where: { orgId, resource: 'tax-code' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual([
      'TAX_CODE_CREATED', 'TAX_DEFAULT_OUTPUT_CHANGED', 'TAX_CODE_CREATED', 'TAX_CODE_DEACTIVATED', 'TAX_CODE_REACTIVATED',
    ]);
  });
});
