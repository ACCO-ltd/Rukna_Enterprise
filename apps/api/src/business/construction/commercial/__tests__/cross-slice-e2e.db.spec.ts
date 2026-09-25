import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';

import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { ContractPrismaRepository } from '../../contracts/infrastructure/contract-prisma.repository.js';
import { ContractService } from '../../contracts/application/contract.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../../variations/application/variation-order.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';

import {
  AccountingFixtureFactory,
  type AccountingTestEnv,
} from '../../../accounting/__tests__/helpers/fixture.factory.js';
import { buildServices } from '../../../accounting/__tests__/helpers/build-services.js';

/**
 * Cross-slice E2E: verifies the full commercial chain from a DRAFT BOQ through to payment
 * settlement across five slices:
 *
 *   Slice 1  – DRAFT BOQ → ContractService.create() anchors to a SNAPSHOT
 *   Slice 2  – Variation (+2,000) raises contractValue via raiseCurrentValueForVariation
 *   Slice 3B – Installment.readyToBillAt gate passes inside issuePackage
 *   Slice 4B – issuePackage: two POSTED invoices (milestone + VO) in one atomic tx
 *   Slice 5B – recordProjectPayment: full-payment (T6) and partial-payment (T7) scenarios
 *
 * Both scenario installments (inst1, inst2) are seeded with READY_TO_BILL and independent VOs so
 * each test is self-contained.  All GL posting is exercised via real AccountingPostingService
 * wired by buildServices(); document generation is inert (covered in its own spec).
 */
describe('Cross-slice E2E — DRAFT BOQ → Contract Snapshot → Variation → Issue → Deliver → Pay [DB]', () => {
  const prisma = new PrismaClient();

  let env: AccountingTestEnv;
  let contractService: ContractService;
  let billingService: CommercialBillingService;
  let tree: BoqTreeService;
  let identity: RequestIdentity;

  // Seeded entity ids — set once in beforeAll, read by individual it() blocks.
  let projectId: string;
  let contractId: string;
  let vo1Id: string; // 2,000 addition — Task-6 installment
  let vo2Id: string; // 2,000 addition — Task-7 installment
  let inst1Id: string; // 100% milestone, ready-to-bill — Task 6
  let inst2Id: string; // 100% milestone, ready-to-bill — Task 7

  // Computed amounts (known from the hard-coded 5% VAT engine).
  // 100% × 500,000 = 500,000 subtotal → 525,000 total.
  // VO 2,000 subtotal → 2,100 total.
  const MILESTONE_TOTAL = '525000.00';
  const VO_TOTAL = '2100.00';

  beforeAll(async () => {
    env = await AccountingFixtureFactory.create(prisma);
    const services = buildServices(prisma);

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    // Mocked: avoids actorUserId FK and keeps the test focused on commercial logic.
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;
    const attachments = { freezeFor: async () => 0 };
    const gate = {
      gateStateTransition: jest.fn(async () => null as null | { gated: true; approvalInstanceId: string }),
    };

    const boqRepo = new BoqPrismaRepository();
    const versioning = new BoqVersioningService(tenancy, boqRepo, gate as unknown as CommandGovernanceService);
    tree = new BoqTreeService(tenancy, boqRepo);
    contractService = new ContractService(
      tenancy,
      new ContractPrismaRepository(),
      projectAccess,
      auditOutbox,
      attachments as never,
      versioning,
    );

    const variationRepo = new VariationOrderPrismaRepository();
    billingService = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      variationRepo,
      new VariationOrderService(tenancy, variationRepo, projectAccess, auditOutbox),
      services.clientInvoiceService,
      services.customerReceiptService,
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: env.orgId,
      tenantSlug: env.identity.tenantSlug,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.receivablesManage,
        PERMISSIONS.financialPositionView,
      ],
    };

    await seed(versioning);
  }, 60_000);

  async function seed(versioning: BoqVersioningService) {
    // ── 0. VAT_OUTPUT_PAYABLE account (not in AccountingFixtureFactory baseline) ──
    // clientInvoiceService.post() resolves this subtype when vatAmount > 0 (5% engine).
    const vatAccId = `${env.orgId}-VAT-E2E`;
    await prisma.account.create({
      data: { id: vatAccId, organizationId: env.orgId, code: 'VAT-E2E', normalBalance: 'CREDIT' as never, createdBy: 'u1' },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: vatAccId, versionNumber: 1, name: 'VAT Output Payable',
        accountClass: 'LIABILITY' as never, accountSubtype: 'VAT_OUTPUT_PAYABLE' as never,
        isPostingAllowed: true, isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED' as never, controlledSubledgerType: null,
        effectiveFrom: new Date('2025-01-01'), effectiveTo: null, changedBy: 'u1',
      },
    });

    // ── 1. Project ────────────────────────────────────────────────────────────
    const project = await prisma.project.create({
      data: {
        organizationId: env.orgId,
        code: `E2E-${randomUUID().slice(0, 8)}`,
        name: 'Cross-slice E2E project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: 'u1',
      },
    });
    projectId = project.id;

    // ── 2. DRAFT BOQ (500,000 leaf) ────────────────────────────────────────────
    const boq = await versioning.initialize(identity, project.id);
    const operationalVersionId = boq.versions[0]!.id;
    const section = await tree.addNode(identity, project.id, operationalVersionId, {
      code: '01',
      description: 'Construction works',
    });
    await tree.addNode(identity, project.id, operationalVersionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Concrete works',
      isLeaf: true,
      unit: 'm3',
      quantity: '5000.000',
      unitRate: '100.00',
    });

    // ── 3. Contract (against DRAFT BOQ — signing SNAPSHOT created atomically) ──
    const contract = await contractService.create(identity, {
      projectId: project.id,
      clientId: env.clientId,
      currency: 'USD',
    } as never);
    contractId = contract.id;

    // ADR-023 CONST-COM-012 — activate() now requires a MILESTONE contract's payment plan to
    // reconcile to 100% (closing the previously-open zero-installment gap). inst1 alone (100%)
    // satisfies that at the moment of activation; inst2 is added afterward (below), which the
    // guard never re-checks post-activation. The two installments are deliberately independent
    // 100%-of-base-value scenarios, not a single coexisting schedule (see the comment at their
    // creation) — inst1 must exist first only to make activation itself valid.
    const makeInstallment = (name: string, sortOrder: number) =>
      prisma.contractPaymentInstallment.create({
        data: {
          contractId,
          name,
          sortOrder,
          percentage: new Decimal('1.0000'),
          triggerType: 'MILESTONE',
          milestoneLabel: name,
          readyToBillAt: new Date(),
          readyToBillBy: 'u1',
        },
      });
    inst1Id = (await makeInstallment('Handover', 0)).id;

    // Activate the contract (DRAFT → ACTIVE). issuePackage requires ACTIVE status.
    await contractService.transition(identity, contractId, 'activate');

    // ── 4. Two independent VOs (CLIENT_APPROVED, 2,000 each) ──────────────────
    const makeVo = (ref: string, voSuffix: string) =>
      prisma.variationOrder.create({
        data: {
          organizationId: env.orgId,
          contractId,
          reference: ref,
          status: 'CLIENT_APPROVED',
          title: `Extra scope ${voSuffix}`,
          createdBy: 'u1',
          lines: {
            create: [
              {
                description: 'Extra work',
                quantity: new Decimal('1'),
                unitRate: new Decimal('2000'),
                amount: new Decimal('2000'),
                sortOrder: 0,
              },
            ],
          },
        },
      });
    vo1Id = (await makeVo('VO-E2E-1', '1')).id;
    vo2Id = (await makeVo('VO-E2E-2', '2')).id;

    // Raise contractValue for each VO (separate transactions to avoid row contention).
    await prisma.$transaction(async (tx) =>
      contractService.raiseCurrentValueForVariation(tx as never, identity, contractId, {
        id: vo1Id,
        reference: 'VO-E2E-1',
        netDelta: new Decimal('2000'),
      }),
    );
    await prisma.$transaction(async (tx) =>
      contractService.raiseCurrentValueForVariation(tx as never, identity, contractId, {
        id: vo2Id,
        reference: 'VO-E2E-2',
        netDelta: new Decimal('2000'),
      }),
    );

    // ── 5. Second 100% installment (ready-to-bill) ─────────────────────────────
    // 100% × baseContractValue (500,000) = 500,000 milestone subtotal per installment.
    // Having two 100% installments is intentional: each test scenario owns one (inst1 was
    // created pre-activation above; this mirrors it for T7's independent scenario).
    inst2Id = (await makeInstallment('Handover-2', 1)).id;
  }

  afterAll(async () => {
    // Teardown in FK-safe order before AccountingFixtureFactory.cleanup handles the rest.
    await prisma.$executeRaw`DELETE FROM client_invoice_deliveries WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM variation_billing_allocations WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM variation_order_lines
      WHERE variation_order_id IN (SELECT id FROM variation_orders WHERE organization_id = ${env.orgId})`;
    await prisma.$executeRaw`DELETE FROM variation_orders WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM contract_payment_installments
      WHERE contract_id IN (SELECT id FROM contracts WHERE organization_id = ${env.orgId})`;
    await prisma.contractNumberSequence.deleteMany({
      where: { project: { organizationId: env.orgId } },
    });
    await AccountingFixtureFactory.cleanup(prisma, env.orgId);
    await prisma.$disconnect();
  }, 30_000);

  // ── T6: Full-payment chain ────────────────────────────────────────────────────
  //
  // DRAFT BOQ (500k) → contract (SNAPSHOT) → variation +2k → issue package (INV-A milestone +
  // INV-B VO) → deliver → pay full outstanding → both invoices settled.

  it('T6: full chain — DRAFT BOQ → SNAPSHOT contract → variation → 2 POSTED invoices → deliver → full payment → both outstanding = 0', async () => {
    // ── Slice 1: contract anchors to SNAPSHOT ──────────────────────────────────
    const contractRow = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const boqVersion = await prisma.boqVersion.findUniqueOrThrow({
      where: { id: contractRow.boqVersionId },
    });
    expect(boqVersion.status).toBe('SNAPSHOT');
    expect(contractRow.baseContractValue?.toFixed(2)).toBe('500000.00');

    // ── Slice 2: both variations raised contractValue ──────────────────────────
    expect(contractRow.contractValue.toFixed(2)).toBe('504000.00');

    // ── Slice 4B: issue package (milestone + VO) ───────────────────────────────
    const pkg = await billingService.issuePackage(identity, inst1Id, {
      invoiceDate: '2025-01-15',
      dueDate: '2025-02-15',
      selectedVariationIds: [vo1Id],
    });

    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.variationLines).toHaveLength(1);
    expect(pkg.variationLines[0]!.variationId).toBe(vo1Id);
    expect(pkg.variationLines[0]!.invoice).not.toBeNull();

    const milestoneInvId = pkg.milestoneInvoice!.id;
    const voInvId = pkg.variationLines[0]!.invoice!.id;

    // Both invoices are POSTED
    const milestoneRow = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: milestoneInvId } });
    const voRow = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: voInvId } });
    expect(milestoneRow.postingStatus).toBe('POSTED');
    expect(voRow.postingStatus).toBe('POSTED');
    expect(milestoneRow.totalAmount.toFixed(2)).toBe(MILESTONE_TOTAL);
    expect(voRow.totalAmount.toFixed(2)).toBe(VO_TOTAL);

    // ── Slice 4B: deliver the package ─────────────────────────────────────────
    const { deliveries } = await billingService.sendPackage(identity, inst1Id, {
      method: 'EMAIL',
      sentAt: '2025-01-15T12:00:00.000Z',
      recipient: 'client@example.com',
    });
    // sendPackage creates one delivery row per invoice in the package.
    expect(deliveries.length).toBeGreaterThanOrEqual(2);

    // ── Slice 5B: full-payment receipt ────────────────────────────────────────
    const milestoneOutstanding = new Decimal(MILESTONE_TOTAL);
    const voOutstanding = new Decimal(VO_TOTAL);
    const totalOwed = milestoneOutstanding.plus(voOutstanding); // 527,100.00

    const receipt = await billingService.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2025-01-15',
      amount: totalOwed.toFixed(2),
      currency: 'USD',
      allocations: [
        { clientInvoiceId: milestoneInvId, amount: milestoneOutstanding.toNumber() },
        { clientInvoiceId: voInvId, amount: voOutstanding.toNumber() },
      ],
    });

    expect(receipt.amount).toBe(totalOwed.toFixed(2));
    expect(receipt.unallocatedAmount).toBe('0.00');
    expect(receipt.allocations).toHaveLength(2);

    // Both invoices fully settled
    const milestoneAfter = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: milestoneInvId },
      select: { outstandingAmount: true },
    });
    const voAfter = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: voInvId },
      select: { outstandingAmount: true },
    });
    expect((milestoneAfter.outstandingAmount as Decimal).toFixed(2)).toBe('0.00');
    expect((voAfter.outstandingAmount as Decimal).toFixed(2)).toBe('0.00');
  }, 30_000);

  // ── T7: Partial collection ────────────────────────────────────────────────────
  //
  // Same contract/variation setup, second installment + second VO.  Pay 100,000 allocated
  // only to the milestone invoice.  VO invoice is untouched.

  it('T7: partial collection — pay 100k to milestone only; VO invoice outstanding unchanged', async () => {
    // Issue the second package (inst2 + vo2)
    const pkg = await billingService.issuePackage(identity, inst2Id, {
      invoiceDate: '2025-01-20',
      dueDate: '2025-02-20',
      selectedVariationIds: [vo2Id],
    });

    const milestoneInvId = pkg.milestoneInvoice!.id;
    const voInvId = pkg.variationLines[0]!.invoice!.id;

    // Capture pre-payment outstanding
    const voBefore = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: voInvId },
      select: { outstandingAmount: true },
    });
    expect((voBefore.outstandingAmount as Decimal).toFixed(2)).toBe(VO_TOTAL);

    // Partial payment: 100,000 allocated only to the milestone invoice
    const receipt = await billingService.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2025-01-20',
      amount: '100000.00',
      currency: 'USD',
      allocations: [{ clientInvoiceId: milestoneInvId, amount: 100000 }],
    });

    expect(receipt.amount).toBe('100000.00');
    // Remainder 100,000 fully allocated (no unallocated portion) but VO left open
    expect(receipt.allocations).toHaveLength(1);

    // Milestone: 525,000 − 100,000 = 425,000 outstanding
    const milestoneAfter = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: milestoneInvId },
      select: { outstandingAmount: true },
    });
    expect((milestoneAfter.outstandingAmount as Decimal).toFixed(2)).toBe('425000.00');

    // VO invoice: completely untouched by this payment
    const voAfter = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: voInvId },
      select: { outstandingAmount: true },
    });
    expect((voAfter.outstandingAmount as Decimal).toFixed(2)).toBe(VO_TOTAL);
  }, 30_000);
});
