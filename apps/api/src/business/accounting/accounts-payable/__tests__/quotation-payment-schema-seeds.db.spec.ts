import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { grantQuotationPaymentGovernance } from '../../../../../prisma/seeds/quotation-payment-governance.js';
import { accoSupplierPaymentBands } from '../../../../platform/workflows/seeders/acco-value-bands.js';
import {
  seedBandSet,
  seedBuyerAdvanceBands,
} from '../../../../platform/workflows/seeders/acco-workflows.seed.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { isSupportedPolicyTransition } from '../../../../platform/workflows/application/policy-transition-registry.js';
import {
  cleanupQuotationEnv,
  createQuotationEnv,
  type QuotationTestEnv,
} from '../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';

/**
 * ADR-045 P1 (live DB): the migration's constraints and the seeds.
 *
 *  - SCHEMA-01: one buyer advance / supplier payment per (org, idempotency key); null keys repeat freely.
 *  - SCHEMA-02: a store document's client ref is unique per org.
 *  - SEED-01: the targeted seed adds the SoD rule (active), the BuyerAdvance bindings on the
 *    supplier-payment band definitions (coupled to their state) and STAFF_ADVANCE → 13100, once.
 *  - SEED-02: the full governance seed is idempotent for the new bands (run twice).
 *  - SEED-03: an org without the governance policy is reported, nothing written.
 *  - SOD-01 / REG-01: the new SoD action and the registry fix.
 */
describe('ADR-045 P1 — schema constraints and seeds', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let poId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: env.orgId, supplierId: env.supplierId, poNumber: `PO-S-${Date.now()}`, createdBy: env.identity.userId },
    });
    poId = po.id;
    const gl = await prisma.account.create({
      data: { organizationId: env.orgId, code: '10900', normalBalance: 'DEBIT', createdBy: env.identity.userId },
    });
    const bank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: gl.id,
        bankName: 'Cash box',
        accountName: 'Cash box',
        accountNumber: `CASH-${Date.now()}`,
        currencyCode: 'USD',
        createdBy: env.identity.userId,
      },
    });
    bankAccountId = bank.id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM store_documents WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM workflow_trigger_bindings WHERE organization_id = ${env.orgId}`;
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  const advance = (idempotencyKey: string | null) =>
    prisma.buyerAdvance.create({
      data: {
        organizationId: env.orgId,
        purchaseOrderId: poId,
        recipientUserId: env.userIds.collector,
        amount: new Decimal('10'),
        currencyCode: 'USD',
        paymentMethod: 'CASH',
        disbursementBankAccountId: bankAccountId,
        advancedAt: new Date('2026-10-08'),
        createdBy: env.userIds.selector,
        idempotencyKey,
      },
    });

  const payment = (idempotencyKey: string | null) =>
    prisma.supplierPayment.create({
      data: {
        organizationId: env.orgId,
        supplierId: env.supplierId,
        bankAccountId,
        paymentDate: new Date('2026-10-08'),
        accountingDate: new Date('2026-10-08'),
        currencyCode: 'USD',
        totalAmount: new Decimal('10'),
        unallocatedAmount: new Decimal('10'),
        paymentMethod: 'BANK',
        createdBy: env.userIds.selector,
        idempotencyKey,
      },
    });

  it('SCHEMA-01: a repeated idempotency key is refused per org; null keys repeat freely', async () => {
    const key = randomUUID();
    await advance(key);
    await expect(advance(key)).rejects.toMatchObject({ code: 'P2002' });
    await advance(null);
    await expect(advance(null)).resolves.toBeTruthy();

    await payment(key); // the same key on another table is unrelated
    await expect(payment(key)).rejects.toMatchObject({ code: 'P2002' });
    await payment(null);
    await expect(payment(null)).resolves.toBeTruthy();
  });

  it('SCHEMA-02: a store document client ref is unique per org', async () => {
    const clientRef = randomUUID();
    const doc = (number: string) =>
      prisma.storeDocument.create({
        data: {
          organizationId: env.orgId,
          number,
          purchaseOrderId: poId,
          kind: 'RECEIPT',
          clientRef,
          uploadedBy: env.userIds.collector,
        },
      });
    await doc(`SD-A-${clientRef.slice(0, 6)}`);
    await expect(doc(`SD-B-${clientRef.slice(0, 6)}`)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('SOD-01: ADVANCE_RECIPIENT_CANNOT_RELEASE bars releasing cash to yourself', () => {
    const sod = new SegregationOfDutiesService({ getClient: () => prisma } as never);
    const codes = new Set(['ADVANCE_RECIPIENT_CANNOT_RELEASE']);
    const base = { organizationId: env.orgId, action: 'RELEASE_BUYER_ADVANCE' as const, actorUserId: 'u1' };
    expect(sod.violation(codes, { ...base, advanceRecipientUserId: 'u1' })).toBe('ADVANCE_RECIPIENT_CANNOT_RELEASE');
    expect(sod.violation(codes, { ...base, advanceRecipientUserId: 'u2' })).toBeNull();
    expect(sod.violation(new Set(), { ...base, advanceRecipientUserId: 'u1' })).toBeNull();
  });

  it('REG-01: the supplier-payment policy transition the service evaluates is now authorable', () => {
    expect(isSupportedPolicyTransition('SUPPLIER_PAYMENT' as never, 'DRAFT', 'APPROVED')).toBe(true);
    expect(isSupportedPolicyTransition('SUPPLIER_PAYMENT' as never, 'DRAFT', 'SUBMITTED')).toBe(true);
  });

  describe('targeted seed', () => {
    beforeAll(async () => {
      // The chart: 13100 Staff advances (ASSET).
      const acct = await prisma.account.create({
        data: { organizationId: env.orgId, code: '13100', normalBalance: 'DEBIT', createdBy: env.identity.userId },
      });
      await prisma.accountVersion.create({
        data: {
          accountId: acct.id,
          versionNumber: 1,
          name: 'Staff advances',
          accountClass: 'ASSET',
          accountSubtype: 'OTHER_CURRENT_ASSET',
          isPostingAllowed: true,
          effectiveFrom: new Date('2025-01-01'),
          changedBy: env.identity.userId,
        },
      });
      await prisma.workflowPolicyVersion.create({
        data: { organizationId: env.orgId, policyKey: 'ACCO_GOVERNANCE', version: 1, status: 'ACTIVE', effectiveFrom: new Date('2026-08-17') },
      });
    });

    it('SEED-01: rule (active), coupled advance bindings, STAFF_ADVANCE profile — once', async () => {
      // A tenant seeded before ADR-045: the supplier-payment bands exist, switched ON by ACCO.
      const log = console.log;
      console.log = () => undefined;
      try {
        await seedBandSet(prisma, env.orgId, {
          entityType: 'SupplierPayment',
          fromState: 'DRAFT',
          toState: 'APPROVED',
          transactionType: 'SUPPLIER_PAYMENT' as never,
          bands: accoSupplierPaymentBands(),
        });
      } finally {
        console.log = log;
      }
      const paymentBindings = await prisma.workflowTriggerBinding.findMany({
        where: { organizationId: env.orgId, entityType: 'SupplierPayment' },
      });
      expect(paymentBindings).toHaveLength(3);
      await prisma.workflowTriggerBinding.updateMany({ where: { id: { in: paymentBindings.map((b) => b.id) } }, data: { isActive: true } });

      const first = await grantQuotationPaymentGovernance(prisma, env.orgId);
      expect(first).toMatchObject({
        status: 'ok',
        sodCreated: ['ADVANCE_RECIPIENT_CANNOT_RELEASE'],
        sodAlreadyPresent: [],
        advanceBindingsBefore: 0,
        advanceBindingsAfter: 3,
        staffAdvanceProfile: 'created',
      });
      const bindings = await prisma.workflowTriggerBinding.findMany({
        where: { organizationId: env.orgId, entityType: 'BuyerAdvance' },
        include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
        orderBy: { minAmount: { sort: 'asc', nulls: 'first' } },
      });
      expect(bindings.map((b) => [b.fromState, b.toState, b.transactionType, b.isActive])).toEqual(
        Array(3).fill(['DRAFT', 'APPROVED', 'SUPPLIER_PAYMENT', true]),
      );
      // The same band definitions (one chain) as the supplier payments.
      expect(bindings.map((b) => b.definition.name)).toEqual(accoSupplierPaymentBands().map((b) => b.name));
      expect(new Set(bindings.map((b) => b.workflowDefinitionId))).toEqual(
        new Set(paymentBindings.map((b) => b.workflowDefinitionId)),
      );
      expect(bindings[1].definition.steps.map((s) => s.roleRequired)).toEqual(['Finance Officer', 'CFO']);
      const profile = await prisma.postingProfile.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: env.orgId, code: 'STAFF_ADVANCE' } },
        include: { versions: true },
      });
      expect(profile.versions.map((v) => [v.accountId, v.effectiveFrom.toISOString().slice(0, 10)])).toEqual([
        [`${(await prisma.account.findUniqueOrThrow({ where: { organizationId_code: { organizationId: env.orgId, code: '13100' } } })).id}`, '2025-01-01'],
      ]);

      const second = await grantQuotationPaymentGovernance(prisma, env.orgId);
      expect(second).toMatchObject({
        status: 'ok',
        sodCreated: [],
        sodAlreadyPresent: ['ADVANCE_RECIPIENT_CANNOT_RELEASE'],
        advanceBindingsBefore: 3,
        advanceBindingsAfter: 3,
        staffAdvanceProfile: 'already-present',
      });
    });

    it('SEED-02: the band seed (used by the full governance seed) run twice adds the advance bands once', async () => {
      const log = console.log;
      console.log = () => undefined;
      try {
        await seedBuyerAdvanceBands(prisma, env.orgId);
        await seedBuyerAdvanceBands(prisma, env.orgId);
      } finally {
        console.log = log;
      }
      expect(await prisma.workflowTriggerBinding.count({ where: { organizationId: env.orgId, entityType: 'BuyerAdvance' } })).toBe(3);
      expect(await prisma.workflowDefinition.count({ where: { organizationId: env.orgId } })).toBe(3);
    });

    it('SEED-03: an org without the policy is reported and nothing is written', async () => {
      const orgId = `qpay-empty-${randomUUID().slice(0, 8)}`;
      await prisma.organization.create({ data: { id: orgId, name: orgId, slug: orgId, status: 'ACTIVE' } });
      try {
        expect(await grantQuotationPaymentGovernance(prisma, orgId)).toEqual({ status: 'policy-missing' });
        expect(await prisma.segregationOfDutiesRule.count({ where: { organizationId: orgId } })).toBe(0);
        expect(await prisma.postingProfile.count({ where: { organizationId: orgId } })).toBe(0);
      } finally {
        await prisma.organization.delete({ where: { id: orgId } });
      }
    });
  });
});
