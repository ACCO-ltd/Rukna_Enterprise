import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { grantQuotationPermissions } from '../../../../../prisma/seeds/quotation-permissions.js';
import { grantQuotationGovernance } from '../../../../../prisma/seeds/quotation-governance.js';
import { accoQuotationAwardBands } from '../../../../platform/workflows/seeders/acco-value-bands.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';

/**
 * ADR-044 Q1 (live DB): the migration's constraints and the targeted live-tenant seeds.
 *
 *  - SCHEMA-01: one LIVE quotation request per MR (partial unique index); a CANCELLED one does not block.
 *  - SCHEMA-02: a quote names a supplier XOR a new store (CHECK constraint).
 *  - SEED-01: the permission grant links exactly the four role/permission pairs, once.
 *  - SEED-02: the governance seed adds the two SoD rules (active) and the four award bands (inactive), once.
 *  - SEED-03: a tenant without the governance policy / roles is reported, nothing written.
 */
describe('ADR-044 Q1 — schema constraints and seeds', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  const newRequest = (mrId: string, number: string, status: 'COLLECTING' | 'CANCELLED' = 'COLLECTING') =>
    prisma.quotationRequest.create({
      data: {
        organizationId: env.orgId,
        number,
        materialRequestId: mrId,
        currencyCode: 'USD',
        status,
        createdBy: env.userIds.collector,
      },
    });

  it('SCHEMA-01: two live requests on one MR violate the index; a cancelled one does not', async () => {
    const mr = await createApprovedMr(prisma, env);
    await newRequest(mr.id, `QR-S1-${mr.id.slice(-8)}`, 'CANCELLED');
    await newRequest(mr.id, `QR-S2-${mr.id.slice(-8)}`);
    await expect(newRequest(mr.id, `QR-S3-${mr.id.slice(-8)}`)).rejects.toMatchObject({ code: 'P2002' });
    // Another cancelled one is still fine.
    await expect(newRequest(mr.id, `QR-S4-${mr.id.slice(-8)}`, 'CANCELLED')).resolves.toBeTruthy();
  });

  it('SCHEMA-02: a quote must name a supplier or a store, not both and not neither', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await newRequest(mr.id, `QR-X-${mr.id.slice(-8)}`);
    const quote = (data: Partial<Prisma.QuoteUncheckedCreateInput>) =>
      prisma.quote.create({
        data: {
          organizationId: env.orgId,
          quotationRequestId: request.id,
          storeKey: 'k',
          uploadedBy: env.userIds.collector,
          clientRef: randomUUID(),
          ...data,
        },
      });
    await expect(quote({ supplierId: env.supplierId, storeName: 'Both' })).rejects.toThrow();
    await expect(quote({})).rejects.toThrow();
    await expect(quote({ supplierId: env.supplierId })).resolves.toBeTruthy();
    await expect(quote({ storeName: 'Hodan Hardware' })).resolves.toBeTruthy();
  });

  describe('targeted seeds', () => {
    const roleNames = ['Procurement Manager', 'Finance Officer', 'CFO', 'CEO', 'Construction Director'];
    let roleIds: Record<string, string>;

    const grantsOf = async (roleId: string) =>
      (
        await prisma.rolePermission.findMany({
          where: { roleId },
          select: { permission: { select: { action: true, resource: true } } },
        })
      )
        .map((g) => `${g.permission.action}:${g.permission.resource}`)
        .sort();

    beforeAll(async () => {
      roleIds = {};
      for (const name of roleNames) {
        const role = await prisma.role.create({ data: { organizationId: env.orgId, name } });
        roleIds[name] = role.id;
      }
    });

    it('SEED-01: grants collect to the Procurement Manager and award to FO/CFO/CEO, idempotently', async () => {
      const first = await grantQuotationPermissions(prisma, env.orgId);
      expect(first.map((r) => r.status)).toEqual(['granted', 'granted', 'granted', 'granted']);
      expect(await grantsOf(roleIds['Procurement Manager'])).toEqual(['collect:quotation']);
      for (const name of ['Finance Officer', 'CFO', 'CEO']) {
        expect(await grantsOf(roleIds[name])).toEqual(['award:quotation']);
      }
      expect(await grantsOf(roleIds['Construction Director'])).toEqual([]);

      const second = await grantQuotationPermissions(prisma, env.orgId);
      expect(second.map((r) => r.status)).toEqual([
        'already-granted',
        'already-granted',
        'already-granted',
        'already-granted',
      ]);
      expect(await grantsOf(roleIds['Procurement Manager'])).toEqual(['collect:quotation']);
    });

    it('SEED-02: adds the SoD rules (active) and the award bands (inactive), idempotently', async () => {
      await prisma.workflowPolicyVersion.create({
        data: {
          organizationId: env.orgId,
          policyKey: 'ACCO_GOVERNANCE',
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2026-08-17'),
        },
      });
      const first = await grantQuotationGovernance(prisma, env.orgId);
      expect(first).toMatchObject({
        status: 'ok',
        created: ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT'],
        alreadyPresent: [],
        awardBandsBefore: 0,
        awardBandsAfter: 4,
      });
      const rules = await prisma.segregationOfDutiesRule.findMany({
        where: { organizationId: env.orgId },
        select: { code: true, isActive: true },
        orderBy: { code: 'asc' },
      });
      expect(rules).toEqual([
        { code: 'QUOTE_UPLOADER_CANNOT_SELECT', isActive: true },
        { code: 'REQUESTER_CANNOT_SELECT', isActive: true },
      ]);
      const bindings = await prisma.workflowTriggerBinding.findMany({
        where: { organizationId: env.orgId, entityType: 'QuotationRequest' },
        include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
        orderBy: { minAmount: { sort: 'asc', nulls: 'first' } },
      });
      expect(bindings.map((b) => [b.fromState, b.toState, b.transactionType, b.isActive, b.definition.isActive])).toEqual(
        Array(4).fill(['AWAITING_DECISION', 'AWARDED', 'QUOTATION_AWARD', false, false]),
      );
      expect(bindings.map((b) => b.definition.name)).toEqual(accoQuotationAwardBands().map((b) => b.name));
      expect(bindings[2].definition.steps.map((s) => s.roleRequired)).toEqual([
        'Construction Director',
        'Finance Officer',
        'CFO',
      ]);

      // An admin switched a rule off — a re-run leaves it alone and creates nothing.
      await prisma.segregationOfDutiesRule.update({
        where: { organizationId_code: { organizationId: env.orgId, code: 'REQUESTER_CANNOT_SELECT' } },
        data: { isActive: false },
      });
      const second = await grantQuotationGovernance(prisma, env.orgId);
      expect(second).toMatchObject({
        status: 'ok',
        created: [],
        alreadyPresent: ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT'],
        awardBandsBefore: 4,
        awardBandsAfter: 4,
      });
      expect(
        (await prisma.segregationOfDutiesRule.findUniqueOrThrow({
          where: { organizationId_code: { organizationId: env.orgId, code: 'REQUESTER_CANNOT_SELECT' } },
        })).isActive,
      ).toBe(false);
      expect(await prisma.workflowDefinition.count({ where: { organizationId: env.orgId } })).toBe(4);
    });

    it('SEED-03: an org without the policy or the roles is reported and nothing is written', async () => {
      const orgId = `qseed-empty-${randomUUID().slice(0, 8)}`;
      await prisma.organization.create({ data: { id: orgId, name: orgId, slug: orgId, status: 'ACTIVE' } });
      try {
        expect(await grantQuotationGovernance(prisma, orgId)).toEqual({ status: 'policy-missing' });
        expect((await grantQuotationPermissions(prisma, orgId)).every((r) => r.status === 'role-missing')).toBe(true);
        expect(await prisma.segregationOfDutiesRule.count({ where: { organizationId: orgId } })).toBe(0);
        expect(await prisma.workflowDefinition.count({ where: { organizationId: orgId } })).toBe(0);
      } finally {
        await prisma.organization.delete({ where: { id: orgId } });
      }
    });
  });
});
