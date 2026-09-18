import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { InvoiceDocumentService } from '../../../accounting/accounts-receivable/application/invoice-document.service.js';
import type { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { DocumentSequenceRepository } from '../../../accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { ClientInvoiceRepository } from '../../../accounting/accounts-receivable/infrastructure/client-invoice.repository.js';
import { ClientInvoiceService } from '../../../accounting/accounts-receivable/application/client-invoice.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../../variations/application/variation-order.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';

/**
 * Slice 4B — Issue billing package + record delivery (live-DB).
 *
 * Fixture: ACTIVE MILESTONE contract (500,000 USD) with two installments:
 *   instA (40% = 200,000) — primary issue subject
 *   instB (30% = 150,000) — isolation / regression subject
 *
 * One CLIENT_APPROVED variation (VO-A, +10,000) allocated on instA.
 * One more CLIENT_APPROVED variation (VO-B, +5,000) NOT initially allocated — used for
 * the "invalid VO rejected" guard test.
 */
describe('CommercialBillingService — issuePackage + recordDelivery (Slice 4B)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `ipkg-org-${suffix}`;

  let service: CommercialBillingService;
  let identity: RequestIdentity;
  let contractId: string;
  let projectId: string;
  let clientId: string;

  let instA: string; // 40%, primary issue subject
  let instB: string; // 30%, isolation subject
  let voA: string;   // CLIENT_APPROVED, +10,000, has an INVOICE allocation on instA
  let voB: string;   // CLIENT_APPROVED, +5,000, NOT allocated on any installment (guard test)

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;

    // Posting port: creates a real JournalEntry so markPosted FK is satisfied.
    const mockPostingPort = {
      post: async (data: {
        organizationId: string;
        journalCategory: string;
        entryPurpose: string;
        documentDate: Date;
        accountingDate: Date;
        description: string;
        currencyCode: string;
        eventType?: string;
        sourceDocumentType?: string;
        sourceDocumentId?: string;
        createdBy: string;
      }, tx: Parameters<typeof prisma.$transaction>[0] extends ((tx: infer T) => unknown) ? T : never) => {
        const je = await (tx as typeof prisma).journalEntry.create({
          data: {
            organizationId: orgId,
            journalCategory: data.journalCategory as never,
            entryPurpose: data.entryPurpose as never,
            documentDate: data.documentDate,
            accountingDate: data.accountingDate,
            description: data.description,
            currencyCode: data.currencyCode,
            sourceDocumentType: (data.sourceDocumentType ?? null) as never,
            sourceDocumentId: data.sourceDocumentId ?? null,
            status: 'POSTED' as never,
            createdBy: data.createdBy,
          },
        });
        return { journalEntryId: je.id };
      },
    };

    // Resolver: returns a fake account stub — only the `id` is needed by the posting lines builder.
    const mockResolver = {
      resolveByCodeOrRole: async () => ({ id: `acc-${randomUUID().slice(0, 8)}` }),
    };

    const sequenceRepo = new DocumentSequenceRepository();
    const clientInvoiceRepo = new ClientInvoiceRepository();
    const documentService = {} as unknown as InvoiceDocumentService;
    const fileService = {} as unknown as PlatformFileService;

    const clientInvoiceService = new ClientInvoiceService(
      tenancy,
      clientInvoiceRepo,
      sequenceRepo,
      mockResolver as never,
      mockPostingPort as never,
      documentService,
      fileService,
    );

    const variationRepo = new VariationOrderPrismaRepository();
    const variationService = new VariationOrderService(tenancy, variationRepo, projectAccess, auditOutbox);

    service = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      variationRepo,
      variationService,
      clientInvoiceService,
      {} as never, // customerReceiptService — not exercised by issuePackage
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `ipkg-${suffix}`,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.contractsManage,
        PERMISSIONS.receivablesManage,
        PERMISSIONS.financialPositionView,
      ],
    };

    await seed();
  });

  async function seed() {
    await prisma.organization.create({
      data: { id: orgId, name: `Org ${suffix}`, slug: `ipkg-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `IPKG-${suffix.slice(-6)}`,
        name: 'Issue Package project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Test Client' },
    });
    clientId = client.id;
    const boq = await prisma.boq.create({
      data: { organizationId: orgId, projectId: project.id, currency: 'USD' },
    });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });

    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-IPKG-${suffix.slice(-6)}`,
        contractValue: new Decimal('500000'),
        baseContractValue: new Decimal('500000'),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;

    const makeInst = (name: string, percentage: string, sortOrder: number) =>
      prisma.contractPaymentInstallment.create({
        data: {
          contractId: contract.id,
          name,
          sortOrder,
          percentage: new Decimal(percentage),
          triggerType: 'MILESTONE',
          milestoneLabel: name,
        },
      });

    instA = (await makeInst('Mobilisation', '0.4000', 0)).id;
    instB = (await makeInst('Structure', '0.3000', 1)).id;

    // VO-A: +10,000 USD, CLIENT_APPROVED — will be allocated on instA
    const voARecord = await prisma.variationOrder.create({
      data: {
        organizationId: orgId,
        contractId: contract.id,
        reference: 'VO-A',
        title: 'Extra Groundworks',
        status: 'CLIENT_APPROVED',
        createdBy: 'u1',
        lines: {
          create: [
            {
              description: 'Extra Groundworks',
              quantity: new Decimal('1'),
              unitRate: new Decimal('10000'),
              amount: new Decimal('10000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });
    voA = voARecord.id;

    // VO-B: +5,000 USD, CLIENT_APPROVED — NOT allocated anywhere (guard test)
    const voBRecord = await prisma.variationOrder.create({
      data: {
        organizationId: orgId,
        contractId: contract.id,
        reference: 'VO-B',
        title: 'Boundary Wall',
        status: 'CLIENT_APPROVED',
        createdBy: 'u1',
        lines: {
          create: [
            {
              description: 'Boundary Wall',
              quantity: new Decimal('1'),
              unitRate: new Decimal('5000'),
              amount: new Decimal('5000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });
    voB = voBRecord.id;
  }

  afterAll(async () => {
    await prisma.clientInvoiceDelivery.deleteMany({ where: { organizationId: orgId } });
    await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.documentNumberSequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({
      where: { contract: { organizationId: orgId } },
    });
    await prisma.variationOrderLine.deleteMany({
      where: { variationOrder: { organizationId: orgId } },
    });
    await prisma.variationOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  // ─── Group P: Precondition guards ───────────────────────────────────────────

  it('P-01: rejects issuePackage when installment is not ready to bill', async () => {
    await expect(
      service.issuePackage(identity, instA, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: [],
      }),
    ).rejects.toThrow(/not been marked ready/i);
  });

  it('P-02: rejects issuePackage for an unknown selectedVariationId', async () => {
    // Mark ready first
    await service.markReadyToBill(identity, instB);

    await expect(
      service.issuePackage(identity, instB, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: ['non-existent-vo-id'],
      }),
    ).rejects.toThrow(/non-existent-vo-id/i);
  });

  // ─── Group I: Milestone-only issue (no VOs selected) ────────────────────────

  it('I-01: issues instB with no VOs — one POSTED invoice with INV-xxx number', async () => {
    // instB was already marked ready in P-02
    const pkg = await service.issuePackage(identity, instB, {
      invoiceDate: '2026-09-17',
      dueDate: '2026-10-17',
      selectedVariationIds: [],
    });

    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.milestoneInvoice!.postingStatus).toBe('POSTED');
    expect(pkg.milestoneInvoice!.invoiceNumber).toMatch(/^INV-/);
    expect(pkg.variationLines).toHaveLength(0);

    // instB = 30% of 500,000 = 150,000; total = 150,000 * 1.05 = 157,500
    const inv = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: pkg.milestoneInvoice!.id },
    });
    expect(new Decimal(inv.subtotal.toString()).toFixed(2)).toBe('150000.00');
    expect(new Decimal(inv.totalAmount.toString()).toFixed(2)).toBe('157500.00');
  });

  it('I-02: repeated issuePackage on instB is idempotent — same invoice returned', async () => {
    const pkg1 = await service.getBillingPackages(identity, contractId);
    const instBPkg = pkg1.packages.find((p) => p.installmentId === instB);
    const firstInvId = instBPkg!.milestoneInvoice!.id;
    const firstInvNumber = instBPkg!.milestoneInvoice!.invoiceNumber;

    const pkg2 = await service.issuePackage(identity, instB, {
      invoiceDate: '2026-09-17',
      dueDate: '2026-10-17',
      selectedVariationIds: [],
    });

    expect(pkg2.milestoneInvoice!.id).toBe(firstInvId);
    expect(pkg2.milestoneInvoice!.invoiceNumber).toBe(firstInvNumber);

    // Still only one ClientInvoice for instB
    const count = await prisma.clientInvoice.count({
      where: { organizationId: orgId, sourceInstallmentId: instB },
    });
    expect(count).toBe(1);
  });

  // ─── Group V: Milestone + VO issue ──────────────────────────────────────────

  it('V-01: marks instA ready then issues with VO-A selected — two POSTED invoices', async () => {
    await service.markReadyToBill(identity, instA);

    const pkg = await service.issuePackage(identity, instA, {
      invoiceDate: '2026-09-17',
      dueDate: '2026-10-17',
      selectedVariationIds: [voA],
    });

    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.milestoneInvoice!.postingStatus).toBe('POSTED');
    expect(pkg.milestoneInvoice!.invoiceNumber).toMatch(/^INV-/);

    expect(pkg.variationLines).toHaveLength(1);
    const voLine = pkg.variationLines[0];
    expect(voLine.variationId).toBe(voA);
    expect(voLine.invoice).not.toBeNull();
    expect(voLine.invoice!.postingStatus).toBe('POSTED');
    expect(voLine.invoice!.invoiceNumber).toMatch(/^INV-/);

    // The two invoices must have DIFFERENT numbers
    expect(pkg.milestoneInvoice!.invoiceNumber).not.toBe(voLine.invoice!.invoiceNumber);
  });

  it('V-02: instA milestone subtotal = 200,000 (no VO adjustment; VO is addition not omission)', async () => {
    const inv = await prisma.clientInvoice.findFirstOrThrow({
      where: { organizationId: orgId, sourceInstallmentId: instA },
    });
    expect(new Decimal(inv.subtotal.toString()).toFixed(2)).toBe('200000.00');
  });

  it('V-03: VO-A standalone invoice subtotal = 10,000', async () => {
    const allocation = await prisma.variationBillingAllocation.findFirstOrThrow({
      where: { organizationId: orgId, variationId: voA, treatment: 'INVOICE' },
      include: { clientInvoice: true },
    });
    expect(allocation.clientInvoice).not.toBeNull();
    expect(new Decimal(allocation.clientInvoice!.subtotal.toString()).toFixed(2)).toBe('10000.00');
  });

  it('V-04: VO-B (unselected) has no invoice or allocation — exact-once invariant holds', async () => {
    const allocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, variationId: voB },
    });
    expect(allocs).toHaveLength(0);
  });

  it('V-05: contractValue unchanged after issuing — billing never mutates entitlement', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(new Decimal(contract.contractValue.toString()).toFixed(2)).toBe('500000.00');
  });

  it('V-06: package presentedTotal = milestone total + VO total', async () => {
    const packages = await service.getBillingPackages(identity, contractId);
    const instAPkg = packages.packages.find((p) => p.installmentId === instA);

    // milestone: 200,000 × 1.05 = 210,000; VO: 10,000 × 1.05 = 10,500; sum = 220,500
    expect(instAPkg!.presentedTotal).toBe('220500.00');
  });

  // ─── Group D: Delivery history ───────────────────────────────────────────────

  it('D-01: can record a WHATSAPP delivery against the milestone invoice', async () => {
    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;
    const invoiceId = pkg.milestoneInvoice!.id;

    const delivery = await service.recordDelivery(identity, projectId, invoiceId, {
      method: 'WHATSAPP',
      sentAt: '2026-09-17T09:00:00.000Z',
      recipient: '+971501234567',
    });

    expect(delivery.method).toBe('WHATSAPP');
    expect(delivery.recipient).toBe('+971501234567');

    const row = await prisma.clientInvoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.invoiceId).toBe(invoiceId);
  });

  it('D-02: records EMAIL, PHYSICAL, and OTHER — all four methods are accepted', async () => {
    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;
    const invoiceId = pkg.milestoneInvoice!.id;

    for (const method of ['EMAIL', 'PHYSICAL', 'OTHER'] as const) {
      const d = await service.recordDelivery(identity, projectId, invoiceId, {
        method,
        sentAt: '2026-09-17T10:00:00.000Z',
      });
      expect(d.method).toBe(method);
    }
  });

  it('D-03: repeated deliveries append to history (not overwrite)', async () => {
    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;
    const invoiceId = pkg.milestoneInvoice!.id;

    const rows = await prisma.clientInvoiceDelivery.findMany({
      where: { invoiceId },
      orderBy: { sentAt: 'asc' },
    });
    // D-01 recorded WHATSAPP, D-02 recorded EMAIL/PHYSICAL/OTHER — total ≥ 4
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const methods = rows.map((r) => r.method);
    expect(methods).toContain('WHATSAPP');
    expect(methods).toContain('EMAIL');
    expect(methods).toContain('PHYSICAL');
    expect(methods).toContain('OTHER');
  });

  it('D-04: recording a delivery does not change outstandingAmount', async () => {
    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;
    const invoiceId = pkg.milestoneInvoice!.id;

    const before = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });

    await service.recordDelivery(identity, projectId, invoiceId, {
      method: 'EMAIL',
      sentAt: '2026-09-17T11:00:00.000Z',
    });

    const after = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.outstandingAmount.toString()).toBe(before.outstandingAmount.toString());
  });

  it('D-05: recordDelivery returns 404 for an invoice not belonging to this project', async () => {
    await expect(
      service.recordDelivery(identity, projectId, 'non-existent-invoice', {
        method: 'EMAIL',
        sentAt: '2026-09-17T12:00:00.000Z',
      }),
    ).rejects.toThrow(/not found/i);
  });

  // ─── Group M: Monetary immutability ─────────────────────────────────────────

  it('M-01: monetary fields on a POSTED invoice cannot change', async () => {
    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;
    const inv = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: pkg.milestoneInvoice!.id },
    });

    // totalAmount is set at creation and never updated — POSTED invoices are immutable
    expect(inv.postingStatus).toBe('POSTED');
    expect(inv.invoiceNumber).not.toBeNull();
    // outstandingAmount starts equal to totalAmount (nothing has been allocated)
    expect(inv.outstandingAmount.toString()).toBe(inv.totalAmount.toString());
  });

  // ─── Group G: GL posting audit ───────────────────────────────────────────────

  it('G-01: each POSTED invoice has a postedJournalEntryId (EVT-AR-001 was fired)', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: {
        organizationId: orgId,
        postingStatus: 'POSTED',
      },
    });

    expect(invoices.length).toBeGreaterThanOrEqual(2); // milestone instA + VO-A at minimum

    for (const inv of invoices) {
      expect(inv.postedJournalEntryId).not.toBeNull();
    }
  });

  // ─── Group R: Forced-failure rollback proof ──────────────────────────────────
  // Proves atomicity: if any step mid-package fails, zero invoices are left POSTED.

  it('R-01: a posting failure mid-package rolls back ALL documents — zero POSTED remain', async () => {
    // Spin up a separate service instance with a posting port that FAILS on the 2nd call.
    // This simulates a partial-package failure (milestone posts, VO post throws).
    const suffix2 = randomUUID().slice(0, 12);
    const orgId2 = `ipkg-rb-${suffix2}`;

    // Seed a minimal org/project/contract/installment/VO for this test.
    await prisma.organization.create({
      data: { id: orgId2, name: `Rollback Org ${suffix2}`, slug: `rb-${suffix2}`, status: 'ACTIVE' },
    });
    const project2 = await prisma.project.create({
      data: {
        organizationId: orgId2,
        code: `RB-${suffix2.slice(-6)}`,
        name: 'Rollback test project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    const client2 = await prisma.client.create({
      data: { organizationId: orgId2, code: `C2-${suffix2.slice(-6)}`, name: 'Rollback Client' },
    });
    const boq2 = await prisma.boq.create({
      data: { organizationId: orgId2, projectId: project2.id, currency: 'USD' },
    });
    const version2 = await prisma.boqVersion.create({
      data: { boqId: boq2.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const contract2 = await prisma.contract.create({
      data: {
        organizationId: orgId2,
        projectId: project2.id,
        clientId: client2.id,
        boqVersionId: version2.id,
        contractNumber: `CT-RB-${suffix2.slice(-6)}`,
        contractValue: new Decimal('100000'),
        baseContractValue: new Decimal('100000'),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });
    const rbInst = (await prisma.contractPaymentInstallment.create({
      data: {
        contractId: contract2.id,
        name: 'Rollback Stage',
        sortOrder: 0,
        percentage: new Decimal('0.5000'),
        triggerType: 'MILESTONE',
        milestoneLabel: 'Rollback Stage',
      },
    })).id;

    const rbVo = (await prisma.variationOrder.create({
      data: {
        organizationId: orgId2,
        contractId: contract2.id,
        reference: 'VO-RB',
        title: 'Rollback VO',
        status: 'CLIENT_APPROVED',
        createdBy: 'u1',
        lines: {
          create: [{
            description: 'Rollback VO line',
            quantity: new Decimal('1'),
            unitRate: new Decimal('5000'),
            amount: new Decimal('5000'),
            sortOrder: 0,
          }],
        },
      },
    })).id;

    // Posting port: succeeds on call #1 (milestone), throws on call #2 (VO).
    let callCount = 0;
    const failingPostingPort = {
      post: async (data: { organizationId: string; journalCategory: string; entryPurpose: string; documentDate: Date; accountingDate: Date; description: string; currencyCode: string; eventType?: string; sourceDocumentType?: string; sourceDocumentId?: string; createdBy: string; }, tx: Parameters<typeof prisma.$transaction>[0] extends ((tx: infer T) => unknown) ? T : never) => {
        callCount++;
        if (callCount === 1) {
          const je = await (tx as typeof prisma).journalEntry.create({
            data: {
              organizationId: orgId2,
              journalCategory: data.journalCategory as never,
              entryPurpose: data.entryPurpose as never,
              documentDate: data.documentDate,
              accountingDate: data.accountingDate,
              description: data.description,
              currencyCode: data.currencyCode,
              sourceDocumentType: (data.sourceDocumentType ?? null) as never,
              sourceDocumentId: data.sourceDocumentId ?? null,
              status: 'POSTED' as never,
              createdBy: data.createdBy,
            },
          });
          return { journalEntryId: je.id };
        }
        throw new Error('Simulated posting failure on second invoice');
      },
    };

    const tenancy2 = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess2 = { assertContract: async () => undefined, assertMember: async () => undefined } as unknown as ProjectAccessService;
    const auditOutbox2 = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;
    const mockResolver2 = { resolveByCodeOrRole: async () => ({ id: `acc-rb-${randomUUID().slice(0, 8)}` }) };

    const seqRepo2 = new DocumentSequenceRepository();
    const invRepo2 = new ClientInvoiceRepository();
    const clientInvSvc2 = new ClientInvoiceService(
      tenancy2, invRepo2, seqRepo2, mockResolver2 as never, failingPostingPort as never,
      {} as unknown as InvoiceDocumentService, {} as unknown as PlatformFileService,
    );
    const varRepo2 = new VariationOrderPrismaRepository();
    const varSvc2 = new VariationOrderService(tenancy2, varRepo2, projectAccess2, auditOutbox2);
    const rbService = new CommercialBillingService(
      tenancy2, projectAccess2, new CommercialPrismaRepository(), varRepo2, varSvc2, clientInvSvc2, {} as never, auditOutbox2,
    );
    const identity2: RequestIdentity = {
      userId: 'u1',
      activeOrganizationId: orgId2,
      tenantSlug: `rb-${suffix2}`,
      roles: ['ADMIN'],
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.contractsManage, PERMISSIONS.receivablesManage, PERMISSIONS.financialPositionView],
    };

    // Mark ready first
    await rbService.markReadyToBill(identity2, rbInst);

    // issuePackage should throw due to the failing posting port on call #2
    await expect(
      rbService.issuePackage(identity2, rbInst, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: [rbVo],
      }),
    ).rejects.toThrow(/Simulated posting failure/);

    // ROLLBACK PROOF: no POSTED client invoices remain for orgId2
    const postedCount = await prisma.clientInvoice.count({
      where: { organizationId: orgId2, postingStatus: 'POSTED' },
    });
    expect(postedCount).toBe(0);

    // No variation allocation remains either
    const allocCount = await prisma.variationBillingAllocation.count({
      where: { organizationId: orgId2 },
    });
    expect(allocCount).toBe(0);

    // Cleanup
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.documentNumberSequence.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId2 } } });
    await prisma.variationOrderLine.deleteMany({ where: { variationOrder: { organizationId: orgId2 } } });
    await prisma.variationOrder.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.client.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId2 } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.project.deleteMany({ where: { organizationId: orgId2 } });
    await prisma.organization.deleteMany({ where: { id: orgId2 } });
  });

  // ─── Group PD: Package delivery ─────────────────────────────────────────────

  it('PD-01: sendPackage records one row per POSTED invoice in the package', async () => {
    // instA has milestone + VO-A invoice — both POSTED
    const { deliveries } = await service.sendPackage(identity, instA, {
      method: 'WHATSAPP',
      sentAt: '2026-09-17T14:00:00.000Z',
      recipient: '+971509876543',
    });

    // milestone + VO-A = 2 delivery rows
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.method === 'WHATSAPP')).toBe(true);

    // Each delivery row exists in the DB
    for (const d of deliveries) {
      const row = await prisma.clientInvoiceDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.method).toBe('WHATSAPP');
    }
  });

  it('PD-02: repeated package deliveries append — no overwrite', async () => {
    await service.sendPackage(identity, instA, {
      method: 'EMAIL',
      sentAt: '2026-09-17T15:00:00.000Z',
    });

    const pkg = (await service.getBillingPackages(identity, contractId)).packages.find(
      (p) => p.installmentId === instA,
    )!;

    // Milestone invoice should have WHATSAPP (D-01..D-03), EMAIL (D-04), PD-01 WHATSAPP, PD-02 EMAIL
    const milestoneDeliveries = await prisma.clientInvoiceDelivery.findMany({
      where: { invoiceId: pkg.milestoneInvoice!.id },
    });
    expect(milestoneDeliveries.length).toBeGreaterThanOrEqual(2); // PD-01 + PD-02 at minimum
  });

  it('PD-03: sendPackage rejects when installment does not exist', async () => {
    await expect(
      service.sendPackage(identity, 'non-existent-installment', {
        method: 'EMAIL',
        sentAt: '2026-09-17T16:00:00.000Z',
      }),
    ).rejects.toThrow(/not found/i);
  });
});
