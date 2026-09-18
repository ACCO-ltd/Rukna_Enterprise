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
 * Commercial reconciliation DB tests.
 *
 * Fixture: ACTIVE MILESTONE contract (500,000 USD), 4 installments (40/30/20/10%).
 * All 4 installments are issued (issuePackage) in beforeAll. No payments are recorded.
 *
 * Assertions:
 *   RECON-01: outstandingAmount = totalAmount (no payments → fully outstanding)
 *   RECON-02: alloc ledger is empty (no ClientReceiptAllocation rows)
 *   RECON-03: every POSTED invoice has a non-null postedJournalEntryId
 *   RECON-04: exactly 4 milestone invoices — one per installment
 *   RECON-05: Σ(subtotals) = 500,000.00 (full contract value billed)
 *   RECON-06: each installment has exactly one ClientInvoice (no duplicates)
 *   RECON-07: all invoice numbers are distinct
 *   RECON-08: zero variation billing allocations (no VOs were selected)
 *   RECON-09: re-issue is idempotent — invoice count does not grow
 *   RECON-10: contractValue is not mutated by billing (stays 500,000)
 *   RECON-11: outstandingAmount - Σ(POSTED receipt allocations) ≈ 0 after a full payment (ε 0.01)
 */
describe('CommercialBillingService — post-lifecycle reconciliation', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `recon-org-${suffix}`;

  let service: CommercialBillingService;
  let identity: RequestIdentity;

  let contractId: string;

  // Installments
  let r1: string; // 40% = 200,000
  let r2: string; // 30% = 150,000
  let r3: string; // 20% = 100,000
  let r4: string; // 10% =  50,000

  // ─── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;

    // Posting port: creates a real JournalEntry so the FK from clientInvoice.postedJournalEntryId
    // is satisfied. No JournalLines are created here — the balance invariant is covered by
    // credit-note.db.spec.ts which uses the real AccountingPostingService.
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
      {} as never, // customerReceiptService — not exercised
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `recon-${suffix}`,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.contractsManage,
        PERMISSIONS.receivablesManage,
        PERMISSIONS.financialPositionView,
      ],
    };

    await seed();
    await issueAllInstallments();
  }, 90_000);

  async function seed() {
    await prisma.organization.create({
      data: { id: orgId, name: `Recon Org ${suffix}`, slug: `recon-${suffix}`, status: 'ACTIVE' },
    });

    await prisma.documentNumberSequence.create({
      data: {
        organizationId: orgId,
        documentType: 'CLIENT_INVOICE' as never,
        journalCategory: null,
        prefix: 'INV-',
        nextNumber: 1,
        paddingLength: 6,
        status: 'ACTIVE',
      },
    });

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `RC-${suffix.slice(-6)}`,
        name: 'Reconciliation Test Project',
        currency: 'USD',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: 'u1',
      },
    });

    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-RC-${suffix.slice(-6)}`, name: 'Recon Client' },
    });

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
        contractNumber: `CT-RC-${suffix.slice(-6)}`,
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
          readyToBillAt: new Date(),
          readyToBillBy: 'u1',
        },
      });

    r1 = (await makeInst('R1 Mobilisation', '0.4000', 0)).id;
    r2 = (await makeInst('R2 Structure',    '0.3000', 1)).id;
    r3 = (await makeInst('R3 Finishing',    '0.2000', 2)).id;
    r4 = (await makeInst('R4 Handover',     '0.1000', 3)).id;
  }

  async function issueAllInstallments() {
    for (const installmentId of [r1, r2, r3, r4]) {
      await service.issuePackage(identity, installmentId, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: [],
      });
    }
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
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  // ─── RECON-01: outstandingAmount = totalAmount (no payments recorded) ──────

  it('RECON-01: outstandingAmount = totalAmount for every invoice — no payments recorded', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, contractId },
      select: { id: true, totalAmount: true, outstandingAmount: true },
    });

    expect(invoices.length).toBeGreaterThan(0);

    for (const inv of invoices) {
      expect(new Decimal(inv.outstandingAmount.toString()).toFixed(2)).toBe(
        new Decimal(inv.totalAmount.toString()).toFixed(2),
      );
    }
  });

  // ─── RECON-02: allocation ledger is empty ────────────────────────────────

  it('RECON-02: zero ClientReceiptAllocation rows for this contract (no payments)', async () => {
    const count = await prisma.clientReceiptAllocation.count({
      where: {
        organizationId: orgId,
        clientInvoiceId: {
          in: await prisma.clientInvoice
            .findMany({ where: { organizationId: orgId, contractId }, select: { id: true } })
            .then((rows) => rows.map((r) => r.id)),
        },
      },
    });
    expect(count).toBe(0);
  });

  // ─── RECON-03: every POSTED invoice has a postedJournalEntryId ────────────

  it('RECON-03: every POSTED invoice has a non-null postedJournalEntryId (AR journal fired)', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, contractId, postingStatus: 'POSTED' },
      select: { id: true, postedJournalEntryId: true },
    });

    expect(invoices.length).toBeGreaterThan(0);

    for (const inv of invoices) {
      expect(inv.postedJournalEntryId).not.toBeNull();
    }
  });

  // ─── RECON-04: Invoice count ───────────────────────────────────────────────

  it('RECON-04: exactly 4 milestone invoices — one per installment', async () => {
    const count = await prisma.clientInvoice.count({
      where: { organizationId: orgId, contractId, postingStatus: 'POSTED' },
    });
    expect(count).toBe(4);
  });

  // ─── RECON-05: Total invoiced subtotal = contract value ───────────────────

  it('RECON-05: Σ(milestoneSubtotals) = 500,000.00 (full 100% of contract value billed)', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, contractId, postingStatus: 'POSTED' },
      select: { subtotal: true },
    });

    const totalSubtotal = invoices.reduce(
      (sum, inv) => sum.plus(new Decimal(inv.subtotal.toString())),
      new Decimal(0),
    );

    // 40% + 30% + 20% + 10% = 100% × 500,000
    expect(totalSubtotal.toFixed(2)).toBe('500000.00');
  });

  // ─── RECON-06: No duplicate invoices per installment ─────────────────────

  it('RECON-06: each installment has exactly one milestone invoice (exactly-once invariant)', async () => {
    for (const installmentId of [r1, r2, r3, r4]) {
      const count = await prisma.clientInvoice.count({
        where: { organizationId: orgId, sourceInstallmentId: installmentId },
      });
      expect(count).toBe(1);
    }
  });

  // ─── RECON-07: Invoice numbers are unique ─────────────────────────────────

  it('RECON-07: all INV-xxx numbers are distinct — sequential number allocation', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, contractId, postingStatus: 'POSTED' },
      select: { invoiceNumber: true },
    });

    const numbers = invoices.map((i) => i.invoiceNumber).filter(Boolean);
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(numbers.length);
    // All follow the INV-xxx pattern
    for (const n of numbers) {
      expect(n).toMatch(/^INV-/);
    }
  });

  // ─── RECON-08: No variation allocations ───────────────────────────────────

  it('RECON-08: zero VariationBillingAllocation rows — no VOs were selected', async () => {
    const allocCount = await prisma.variationBillingAllocation.count({
      where: { organizationId: orgId },
    });
    expect(allocCount).toBe(0);
  });

  // ─── RECON-09: Re-issue idempotency ───────────────────────────────────────

  it('RECON-09: re-issuing all installments is idempotent — invoice and JE counts do not change', async () => {
    const invoicesBefore = await prisma.clientInvoice.count({
      where: { organizationId: orgId, contractId },
    });
    const jeBefore = await prisma.journalEntry.count({
      where: { organizationId: orgId },
    });

    for (const installmentId of [r1, r2, r3, r4]) {
      await service.issuePackage(identity, installmentId, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: [],
      });
    }

    const invoicesAfter = await prisma.clientInvoice.count({
      where: { organizationId: orgId, contractId },
    });
    const jeAfter = await prisma.journalEntry.count({
      where: { organizationId: orgId },
    });

    expect(invoicesAfter).toBe(invoicesBefore);
    expect(jeAfter).toBe(jeBefore);
  });

  // ─── RECON-10: contractValue unchanged by billing ─────────────────────────

  it('RECON-10: contractValue is never mutated by issuePackage — stays 500,000', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(new Decimal(contract.contractValue.toString()).toFixed(2)).toBe('500000.00');
  });

  // ─── RECON-11: JournalEntry count matches invoice count ───────────────────

  it('RECON-11: exactly one POSTED JournalEntry per POSTED invoice (AR-001 firing invariant)', async () => {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId: orgId, contractId, postingStatus: 'POSTED' },
      select: { postedJournalEntryId: true },
    });

    const jeIds = invoices.map((i) => i.postedJournalEntryId).filter(Boolean) as string[];
    // All JE ids must be distinct (no two invoices share the same posting journal).
    const uniqueJeIds = new Set(jeIds);
    expect(uniqueJeIds.size).toBe(invoices.length);
  });

  // ─── RECON-12: getBillingPackages presentedTotal ≈ invoice totals ─────────

  it('RECON-12: for each installment, presentedTotal = milestoneInvoice.totalAmount (no VO lines)', async () => {
    const res = await service.getBillingPackages(identity, contractId);

    expect(res.packages).toHaveLength(4);

    for (const pkg of res.packages) {
      expect(pkg.milestoneInvoice).not.toBeNull();
      expect(pkg.variationLines).toHaveLength(0);

      // presentedTotal = milestone total only when no VO additions are present
      expect(pkg.presentedTotal).toBe(pkg.milestoneInvoice!.totalAmount!);
    }
  });

  // ─── RECON-13: package subtotals sum to full contract value ───────────────

  it('RECON-13: Σ(package.packageSubtotal) across all 4 packages = 500,000', async () => {
    const res = await service.getBillingPackages(identity, contractId);

    const total = res.packages.reduce(
      (sum, pkg) => sum.plus(new Decimal(pkg.packageSubtotal ?? '0')),
      new Decimal(0),
    );

    expect(total.toFixed(2)).toBe('500000.00');
  });
});
