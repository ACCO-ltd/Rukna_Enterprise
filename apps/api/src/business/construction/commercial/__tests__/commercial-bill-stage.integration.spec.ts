import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { DocumentSequenceRepository } from '../../../accounting/accounting-core/infrastructure/document-sequence.repository.js';
import type { PostingAccountResolver } from '../../../accounting/accounting-core/application/posting-account-resolver.service.js';
import type { IAccountingPostingPort } from '../../../accounting/accounting-core/application/ports/accounting-posting.port.js';
import type { InvoiceDocumentService } from '../../../accounting/accounts-receivable/application/invoice-document.service.js';
import type { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { ClientInvoiceRepository } from '../../../accounting/accounts-receivable/infrastructure/client-invoice.repository.js';
import { ClientInvoiceService } from '../../../accounting/accounts-receivable/application/client-invoice.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../../variations/application/variation-order.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';

/**
 * ADR-030 CONST-COM-028 / S-VB-5..9 (Commercial redesign P1) — live-DB proof of the "bill this stage"
 * orchestrator and the Billing-Package read model, through `CommercialBillingService`.
 *
 * The orchestrator composes REAL services: the AR `ClientInvoiceService` (draft-only, so its posting
 * deps are inert mocks), the variation billing ledger via the REAL `VariationOrderService`, and a
 * single transaction with one package-level audit event (the outbox is mocked to dodge the audit FK).
 *
 * Fixture (one org, MILESTONE contract, base 500,000, one 30% installment = 150,000): an ADDITION VO
 * (net +2,000, CLIENT_APPROVED) and an OMISSION VO (net −3,000, CLIENT_APPROVED). A second installment
 * (also 30%) is billed with the omission; a further installment is used for the already-invoiced case.
 */
describe('CommercialBillingService.billStage (CONST-COM-028)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `cbs-org-${suffix}`;

  let service: CommercialBillingService;
  let identity: RequestIdentity;
  let identityNoFin: RequestIdentity;
  let contractId: string;
  let contractValueBefore: string;
  // Installments (all 30% of base 500,000 = 150,000 each).
  let instAddition: string; // billed with the addition VO
  let instExcluded: string; // billed with the addition VO EXCLUDED
  let instOmission: string; // billed with the omission VO
  let instAlreadyInvoiced: string; // milestone invoiced first, then omission attempted
  let additionVoId: string;
  let omissionVoId: string;
  let omissionVo2Id: string; // second omission, for the already-invoiced case

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = {
      record: async () => undefined,
    } as unknown as TransactionalAuditOutboxService;

    // AR posting deps are inert — billing only CREATES DRAFT invoices and never posts.
    const sequenceRepo = {} as unknown as DocumentSequenceRepository;
    const resolver = {} as unknown as PostingAccountResolver;
    const postingPort = {} as unknown as IAccountingPostingPort;
    // Commercial round-3: document generation is exercised in ClientInvoiceService's own spec —
    // billStage never calls getOrGenerateDocument, so inert stubs satisfy the constructor.
    const documentService = {} as unknown as InvoiceDocumentService;
    const files = {} as unknown as PlatformFileService;

    const clientInvoiceService = new ClientInvoiceService(
      tenancy,
      new ClientInvoiceRepository(),
      sequenceRepo,
      resolver,
      postingPort,
      documentService,
      files,
    );
    const variationRepo = new VariationOrderPrismaRepository();
    const variationService = new VariationOrderService(
      tenancy,
      variationRepo,
      projectAccess,
      auditOutbox,
    );

    service = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      variationRepo,
      variationService,
      clientInvoiceService,
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `cbs-${suffix}`,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.receivablesManage,
        PERMISSIONS.financialPositionView,
      ],
    };
    identityNoFin = {
      ...identity,
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.receivablesManage],
    };

    await seed();
  });

  async function seed() {
    await prisma.organization.create({
      data: { id: orgId, name: `Org ${suffix}`, slug: `cbs-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: { organizationId: orgId, code: `CBS-${suffix.slice(-6)}`, name: 'CBS project', currency: 'USD', createdBy: 'u1' },
    });
    const boq = await prisma.boq.create({
      data: { organizationId: orgId, projectId: project.id, currency: 'USD' },
    });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Client' },
    });
    contractValueBefore = '500000.00';
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-${suffix.slice(-6)}`,
        contractValue: new Decimal(contractValueBefore),
        baseContractValue: new Decimal(contractValueBefore),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;

    const makeInstallment = (name: string, sortOrder: number) =>
      prisma.contractPaymentInstallment.create({
        data: {
          contractId: contract.id,
          name,
          sortOrder,
          percentage: new Decimal('0.3000'), // 30% × 500,000 = 150,000
          triggerType: 'MILESTONE',
          milestoneLabel: name,
        },
      });
    instAddition = (await makeInstallment('Milestone A', 0)).id;
    instExcluded = (await makeInstallment('Milestone B', 1)).id;
    instOmission = (await makeInstallment('Milestone C', 2)).id;
    instAlreadyInvoiced = (await makeInstallment('Milestone D', 3)).id;

    const makeVo = (reference: string, title: string, amount: string) =>
      prisma.variationOrder.create({
        data: {
          organizationId: orgId,
          contractId: contract.id,
          reference,
          status: 'CLIENT_APPROVED',
          title,
          createdBy: 'u1',
          lines: {
            create: [
              {
                description: title,
                quantity: new Decimal('1'),
                unitRate: new Decimal(amount),
                amount: new Decimal(amount),
                sortOrder: 0,
              },
            ],
          },
        },
      });
    additionVoId = (await makeVo('VO-001', 'Extra scope', '2000')).id;
    omissionVoId = (await makeVo('VO-002', 'Descoped work', '-3000')).id;
    omissionVo2Id = (await makeVo('VO-003', 'More descope', '-1000')).id;
  }

  afterAll(async () => {
    await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.$executeRaw`DELETE FROM variation_order_lines WHERE variation_order_id IN (SELECT id FROM variation_orders WHERE organization_id = ${orgId})`;
    await prisma.variationOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('bills a stage with an ADDITION included: two invoices + one INVOICE allocation, VO fully realized', async () => {
    const pkg = await service.billStage(identity, {
      installmentId: instAddition,
      invoiceDate: '2026-06-05',
      dueDate: '2026-07-05',
      variations: [{ variationId: additionVoId, include: true }],
    });

    // The milestone invoice: 30% × 500,000 = 150,000, VAT 7,500, total 157,500.
    expect(pkg.installmentId).toBe(instAddition);
    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.milestoneInvoice!.subtotal).toBe('150000.00');
    expect(pkg.milestoneInvoice!.totalAmount).toBe('157500.00');

    // One VO line, the addition, with its own standalone invoice (subtotal 2,000, total 2,100).
    expect(pkg.variationLines).toHaveLength(1);
    const line = pkg.variationLines[0]!;
    expect(line.variationId).toBe(additionVoId);
    expect(line.treatment).toBe('INVOICE');
    expect(line.allocationAmount).toBe('2000.00');
    expect(line.invoice).not.toBeNull();
    expect(line.invoice!.subtotal).toBe('2000.00');
    expect(line.invoice!.totalAmount).toBe('2100.00');

    // presentedTotal = milestone total (157,500) + addition invoice total (2,100) = 159,600.
    expect(pkg.presentedTotal).toBe('159600.00');

    // Persistence: exactly two invoices for this installment path (milestone + VO), one allocation.
    const milestoneInvoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, sourceInstallmentId: instAddition },
    });
    expect(milestoneInvoices).toHaveLength(1);

    const allocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, variationId: additionVoId },
    });
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.treatment).toBe('INVOICE');
    expect((allocs[0]!.amount as Decimal).toFixed(2)).toBe('2000.00');
    expect(allocs[0]!.installmentId).toBe(instAddition);
    expect(allocs[0]!.clientInvoiceId).toBe(line.invoice!.id);
  });

  it('bills a stage with the VO EXCLUDED: one invoice only; the VO stays billable', async () => {
    const pkg = await service.billStage(identity, {
      installmentId: instExcluded,
      invoiceDate: '2026-06-05',
      dueDate: '2026-07-05',
      // additionVoId is already fully realized on Milestone A; naming a fresh VO but excluding it
      // (include:false) proves the defer path writes nothing.
      variations: [{ variationId: omissionVoId, include: false }],
    });

    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.milestoneInvoice!.subtotal).toBe('150000.00');
    expect(pkg.variationLines).toHaveLength(0);

    // The omission VO has no allocation and remains billable.
    const allocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, variationId: omissionVoId },
    });
    expect(allocs).toHaveLength(0);
  });

  it('getBillingPackages groups the milestone + VO invoices; presentedTotal is their sum', async () => {
    const res = await service.getBillingPackages(identity, contractId);
    const pkg = res.packages.find((p) => p.installmentId === instAddition);
    expect(pkg).toBeDefined();
    expect(pkg!.milestoneInvoice!.totalAmount).toBe('157500.00');
    expect(pkg!.variationLines).toHaveLength(1);
    expect(pkg!.variationLines[0]!.invoice!.totalAmount).toBe('2100.00');

    const sum = new Decimal(pkg!.milestoneInvoice!.totalAmount!).plus(
      pkg!.variationLines.reduce(
        (s, l) => s.plus(new Decimal(l.invoice?.totalAmount ?? '0')),
        new Decimal(0),
      ),
    );
    expect(sum.toFixed(2)).toBe(pkg!.presentedTotal);
  });

  it('bills a stage with an OMISSION: milestone subtotal = pct×base − omission; STAGE_REDUCTION links the milestone invoice', async () => {
    const pkg = await service.billStage(identity, {
      installmentId: instOmission,
      invoiceDate: '2026-06-05',
      dueDate: '2026-07-05',
      variations: [{ variationId: omissionVoId, include: true }],
    });

    // 150,000 − 3,000 = 147,000; VAT 7,350; total 154,350.
    expect(pkg.milestoneInvoice!.subtotal).toBe('147000.00');
    expect(pkg.milestoneInvoice!.totalAmount).toBe('154350.00');

    // The omission line: −3,000 STAGE_REDUCTION, no separate invoice (it lives on the milestone).
    expect(pkg.variationLines).toHaveLength(1);
    const line = pkg.variationLines[0]!;
    expect(line.variationId).toBe(omissionVoId);
    expect(line.treatment).toBe('STAGE_REDUCTION');
    expect(line.allocationAmount).toBe('-3000.00');
    expect(line.invoice).toBeNull();

    // presentedTotal = milestone total only (154,350) — the omission is NOT counted again.
    expect(pkg.presentedTotal).toBe('154350.00');

    const allocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, variationId: omissionVoId },
    });
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.treatment).toBe('STAGE_REDUCTION');
    expect((allocs[0]!.amount as Decimal).toFixed(2)).toBe('-3000.00');
    expect(allocs[0]!.clientInvoiceId).toBe(pkg.milestoneInvoice!.id);
    expect(allocs[0]!.installmentId).toBe(instOmission);
  });

  it('refuses an OMISSION against an ALREADY-INVOICED stage (credit note required)', async () => {
    // First bill the stage plainly (no variations) → milestone invoice exists.
    await service.billStage(identity, {
      installmentId: instAlreadyInvoiced,
      invoiceDate: '2026-06-05',
      dueDate: '2026-07-05',
      variations: [],
    });
    // Now attempt an omission against that already-invoiced stage → rejected.
    await expect(
      service.billStage(identity, {
        installmentId: instAlreadyInvoiced,
        invoiceDate: '2026-06-05',
        dueDate: '2026-07-05',
        variations: [{ variationId: omissionVo2Id, include: true }],
      }),
    ).rejects.toThrow(/already invoiced.*credit note/i);

    // The omission VO was NOT allocated (the whole tx rolled back / never ran the write).
    const allocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, variationId: omissionVo2Id },
    });
    expect(allocs).toHaveLength(0);
  });

  it('is exactly-once: re-running bill-stage for the same included ADDITION creates no second invoice/allocation', async () => {
    const invoicesBefore = await prisma.clientInvoice.count({ where: { organizationId: orgId } });
    const allocsBefore = await prisma.variationBillingAllocation.count({
      where: { organizationId: orgId, variationId: additionVoId },
    });

    await service.billStage(identity, {
      installmentId: instAddition,
      invoiceDate: '2026-06-05',
      dueDate: '2026-07-05',
      variations: [{ variationId: additionVoId, include: true }],
    });

    const invoicesAfter = await prisma.clientInvoice.count({ where: { organizationId: orgId } });
    const allocsAfter = await prisma.variationBillingAllocation.count({
      where: { organizationId: orgId, variationId: additionVoId },
    });
    expect(invoicesAfter).toBe(invoicesBefore);
    expect(allocsAfter).toBe(allocsBefore);
  });

  it('enforces the DB unique index: a duplicate allocation for the same (variation, installment) is rejected', async () => {
    // additionVoId already carries an INVOICE allocation on instAddition (billed in the first test).
    // A second allocation for the same (variation, installment) — the concurrent double-submit shape the
    // orchestrator's read-then-write guard cannot catch under a race — must fail on the unique index
    // (migration 20260915130000), which is the exactly-once backstop. Proven here by a direct insert.
    await expect(
      prisma.variationBillingAllocation.create({
        data: {
          organizationId: orgId,
          variationId: additionVoId,
          amount: new Decimal('1.00'),
          treatment: 'INVOICE',
          installmentId: instAddition,
          createdBy: 'u1',
        },
      }),
    ).rejects.toThrow(/Unique constraint|P2002/i);
  });

  it('leaves the contract entitlement (contractValue) unchanged by billing', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect((contract.contractValue as Decimal).toFixed(2)).toBe(contractValueBefore);
  });

  it('redacts money without financialPositionView, but still returns the package structure', async () => {
    const res = await service.getBillingPackages(identityNoFin, contractId);
    expect(res.financialsVisible).toBe(false);
    // The addition package is still present, with structure but nulled money.
    const pkg = res.packages.find((p) => p.installmentId === instAddition);
    expect(pkg).toBeDefined();
    expect(pkg!.milestoneInvoice).not.toBeNull();
    expect(pkg!.milestoneInvoice!.subtotal).toBeNull();
    expect(pkg!.milestoneInvoice!.totalAmount).toBeNull();
    expect(pkg!.presentedTotal).toBeNull();
    expect(pkg!.variationLines).toHaveLength(1);
    expect(pkg!.variationLines[0]!.allocationAmount).toBeNull();
    expect(pkg!.variationLines[0]!.invoice!.totalAmount).toBeNull();
  });
});
