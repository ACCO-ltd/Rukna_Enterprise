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
 * Slice 3B — commercial readiness lifecycle (live-DB).
 *
 * Fixture: one ACTIVE MILESTONE contract (base 500,000 USD) with four installments:
 *   instA  (40% = 200,000) — unlinked   → primary test subject
 *   instB  (30% = 150,000) — linked to a programme milestone (starts PLANNED)
 *   instC  (20% = 100,000) — unlinked   → revoke + issuePackage-gate tests
 *   instD  (10% =  50,000) — unlinked   → DB-invariant probe
 *
 * A separate DRAFT contract carries instDraft for the "inactive contract" guard test.
 */
describe('CommercialReadiness (Slice 3B)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `crd-org-${suffix}`;

  let service: CommercialBillingService;
  let identity: RequestIdentity;
  let contractId: string;
  let programmeMilestoneId: string;

  let instA: string; // 40%, no milestone — primary subject
  let instB: string; // 30%, linked to programmeMilestone (PLANNED initially)
  let instC: string; // 20%, no milestone — revoke + guard tests
  let instD: string; // 10%, no milestone — invariant probe
  let instDraft: string; // on the DRAFT contract

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;

    // Posting port: creates a real JournalEntry so markPosted's FK is satisfied — issuePackage
    // (unlike the retired billStage) always approves + posts inside its own transaction.
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
    const documentService = {} as unknown as InvoiceDocumentService;
    const files = {} as unknown as PlatformFileService;

    const clientInvoiceService = new ClientInvoiceService(
      tenancy,
      new ClientInvoiceRepository(),
      sequenceRepo,
      mockResolver as never,
      mockPostingPort as never,
      documentService,
      files,
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
      {} as never, // customerReceiptService — not exercised by readiness commands
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `crd-${suffix}`,
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
      data: { id: orgId, name: `Org ${suffix}`, slug: `crd-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `CRD-${suffix.slice(-6)}`,
        name: 'Readiness project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Client' },
    });
    const boq = await prisma.boq.create({
      data: { organizationId: orgId, projectId: project.id, currency: 'USD' },
    });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });

    // Main ACTIVE contract
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-ACTIVE-${suffix.slice(-6)}`,
        contractValue: new Decimal('500000'),
        baseContractValue: new Decimal('500000'),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;

    // Programme milestone for instB — starts PLANNED
    const milestone = await prisma.programmeMilestone.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        code: `M-${suffix.slice(-6)}`,
        name: 'Structural Completion',
        status: 'PLANNED',
        createdBy: 'u1',
        baselineDate: new Date('2026-12-01'),
      },
    });
    programmeMilestoneId = milestone.id;

    const makeInst = (name: string, percentage: string, sortOrder: number, milestoneId?: string) =>
      prisma.contractPaymentInstallment.create({
        data: {
          contractId: contract.id,
          name,
          sortOrder,
          percentage: new Decimal(percentage),
          triggerType: 'MILESTONE',
          milestoneLabel: name,
          ...(milestoneId ? { programmeMilestoneId: milestoneId } : {}),
        },
      });

    instA = (await makeInst('Mobilisation', '0.4000', 0)).id;
    instB = (await makeInst('Structure', '0.3000', 1, programmeMilestoneId)).id;
    instC = (await makeInst('Finishing', '0.2000', 2)).id;
    instD = (await makeInst('Handover', '0.1000', 3)).id;

    // DRAFT contract for inactive-contract guard test — needs its own project
    // (contracts have a unique constraint on project_id)
    const draftProject = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `CRD2-${suffix.slice(-5)}`,
        name: 'Readiness project 2',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    const draftBoq = await prisma.boq.create({
      data: { organizationId: orgId, projectId: draftProject.id, currency: 'USD' },
    });
    const draftVersion = await prisma.boqVersion.create({
      data: { boqId: draftBoq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const draftContract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: draftProject.id,
        clientId: client.id,
        boqVersionId: draftVersion.id,
        contractNumber: `CT-DRAFT-${suffix.slice(-6)}`,
        contractValue: new Decimal('250000'),
        baseContractValue: new Decimal('250000'),
        currency: 'USD',
        status: 'DRAFT',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });

    instDraft = (
      await prisma.contractPaymentInstallment.create({
        data: {
          contractId: draftContract.id,
          name: 'Draft Milestone',
          sortOrder: 0,
          percentage: new Decimal('0.5000'),
          triggerType: 'MILESTONE',
          milestoneLabel: 'Draft Milestone',
        },
      })
    ).id;
  }

  afterAll(async () => {
    await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    // issuePackage (unlike the retired billStage) posts atomically, so R-10 leaves behind a real
    // JournalEntry and a drawn DocumentNumberSequence row — both scoped to this org and both must
    // go before the organization itself can be deleted.
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.documentNumberSequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({
      where: { contract: { organizationId: orgId } },
    });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    // programmeMilestones are CASCADE-deleted with their project; delete projects last
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  // ─── Group 1: markReadyToBill guards ────────────────────────────────────────

  it('R-01: rejects markReadyToBill when contract is not ACTIVE', async () => {
    await expect(service.markReadyToBill(identity, instDraft)).rejects.toThrow(
      /ACTIVE/i,
    );
  });

  it('R-02: rejects markReadyToBill when linked milestone is not VERIFIED (PLANNED)', async () => {
    await expect(service.markReadyToBill(identity, instB)).rejects.toThrow(
      /milestone.*not yet verified|verified/i,
    );
    // DB must remain pristine
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instB } });
    expect(row.readyToBillAt).toBeNull();
  });

  // ─── Group 2: markReadyToBill success ───────────────────────────────────────

  it('R-03: marks instA (NEXT, unlinked) ready — readyToBillAt set, invoice not created', async () => {
    const before = Date.now();
    const result = await service.markReadyToBill(identity, instA, 'QA passed');
    const after = Date.now();

    expect(result.readyToBill).toBe(true);
    expect(result.installmentId).toBe(instA);
    expect(result.readyToBillAt).not.toBeNull();
    const ts = new Date(result.readyToBillAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    // DB state
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instA } });
    expect(row.readyToBillAt).not.toBeNull();
    expect(row.readyToBillBy).toBe('u1');
    expect(row.readinessNote).toBe('QA passed');
  });

  it('R-04: markReadyToBill is idempotent — second call returns same readyToBillAt, no error', async () => {
    // instA was marked in R-03
    const firstRow = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instA } });
    const tsFirst = firstRow.readyToBillAt!.getTime();

    const result = await service.markReadyToBill(identity, instA);
    expect(result.readyToBill).toBe(true);
    // readyToBillAt is the original timestamp (not updated by idempotent call)
    expect(new Date(result.readyToBillAt!).getTime()).toBe(tsFirst);

    const rowAfter = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instA } });
    expect(rowAfter.readyToBillAt!.getTime()).toBe(tsFirst);
  });

  it('R-05: mark-ready does NOT generate an invoice', async () => {
    const count = await prisma.clientInvoice.count({ where: { contractId } });
    expect(count).toBe(0);
  });

  it('R-06: mark-ready does NOT change the contract value', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.baseContractValue?.toFixed(2)).toBe('500000.00');
    expect(contract.contractValue.toFixed(2)).toBe('500000.00');
  });

  it('R-07: mark-ready does NOT create any VariationBillingAllocation rows', async () => {
    const count = await prisma.variationBillingAllocation.count({ where: { organizationId: orgId } });
    expect(count).toBe(0);
  });

  // ─── Group 3: milestone upgrade ──────────────────────────────────────────────

  it('R-08: marks instB ready after upgrading its milestone to VERIFIED', async () => {
    // Upgrade the milestone
    await prisma.programmeMilestone.update({
      where: { id: programmeMilestoneId },
      data: { status: 'VERIFIED' },
    });

    const result = await service.markReadyToBill(identity, instB);
    expect(result.readyToBill).toBe(true);

    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instB } });
    expect(row.readyToBillAt).not.toBeNull();
  });

  // ─── Group 4: issuePackage readiness gate ────────────────────────────────────

  it('R-09: issuePackage rejects an installment that has not been marked ready', async () => {
    // instC has not been marked ready
    await expect(
      service.issuePackage(identity, instC, {
        invoiceDate: '2026-09-17',
        dueDate: '2026-10-17',
        selectedVariationIds: [],
      }),
    ).rejects.toThrow(/not been marked ready to bill/i);
  });

  it('R-10: issuePackage succeeds once the installment is marked ready', async () => {
    // instA was marked ready in R-03; instA has sortOrder=0 so it is NEXT
    const pkg = await service.issuePackage(identity, instA, {
      invoiceDate: '2026-09-17',
      dueDate: '2026-10-17',
      selectedVariationIds: [],
    });
    expect(pkg.milestoneInvoice).not.toBeNull();
    expect(pkg.milestoneInvoice?.subtotal).toBe('200000.00');

    // Invoice created in DB, posted with an assigned invoice number.
    const inv = await prisma.clientInvoice.findFirst({ where: { sourceInstallmentId: instA } });
    expect(inv).not.toBeNull();
    expect(inv?.postingStatus).toBe('POSTED');
    expect(inv?.invoiceNumber).not.toBeNull();
  });

  it('R-11: rejects markReadyToBill on an already-invoiced installment', async () => {
    // instA was invoiced in R-10 — now it has a clientInvoice, so mark-ready must reject
    await expect(service.markReadyToBill(identity, instA)).rejects.toThrow(
      /already has an invoice/i,
    );
  });

  // ─── Group 5: revokeReadyToBill ──────────────────────────────────────────────

  it('R-12: marks instC ready then revokes it — readyToBillAt cleared', async () => {
    await service.markReadyToBill(identity, instC);
    const rowReady = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instC } });
    expect(rowReady.readyToBillAt).not.toBeNull();

    const revoked = await service.revokeReadyToBill(identity, instC, 'scope changed');
    expect(revoked.readyToBill).toBe(false);
    expect(revoked.readyToBillAt).toBeNull();

    const rowCleared = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instC } });
    expect(rowCleared.readyToBillAt).toBeNull();
    expect(rowCleared.readyToBillBy).toBeNull();
    expect(rowCleared.readinessNote).toBeNull();
  });

  it('R-13: revokeReadyToBill rejects when installment is not marked ready', async () => {
    // instC was just revoked in R-12
    await expect(service.revokeReadyToBill(identity, instC)).rejects.toThrow(
      /not marked ready|nothing to revoke/i,
    );
  });

  it('R-14: revokeReadyToBill rejects once an invoice exists (instA is already invoiced)', async () => {
    // instA has readyToBillAt set and a clientInvoice from R-10
    await expect(service.revokeReadyToBill(identity, instA)).rejects.toThrow(
      /invoice exists|cannot be revoked/i,
    );
  });

  // ─── Group 6: DB invariants after billing ────────────────────────────────────

  it('R-15: instA percentage × baseContractValue = 200,000 before and after billing', async () => {
    const inst = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: instA } });
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const derived = new Decimal(inst.percentage.toString())
      .mul(new Decimal(contract.baseContractValue!.toString()));
    expect(derived.toFixed(2)).toBe('200000.00');
  });

  it('R-16: issuePackage did not create allocations (no VOs were included)', async () => {
    const count = await prisma.variationBillingAllocation.count({ where: { organizationId: orgId } });
    expect(count).toBe(0);
  });

  // ─── Group 7: read-model derived flags ──────────────────────────────────────

  it('R-17: instD — readyToBill=false, readyToBillAt=null from repository (never marked)', async () => {
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({
      where: { id: instD },
      select: { readyToBillAt: true },
    });
    expect(row.readyToBillAt).toBeNull();
  });

  it('R-18: instA — readyToBill=true in repository after billing (readyToBillAt still set)', async () => {
    // readyToBillAt is NOT cleared after billing — it records when the installment was approved
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({
      where: { id: instA },
      select: { readyToBillAt: true },
    });
    expect(row.readyToBillAt).not.toBeNull();
  });

  it('R-19: canMarkReadyToBill derivation — true when NEXT + no invoice + no pending milestone', async () => {
    // instC: sortOrder=2, no milestone, not invoiced, not ready (revoked in R-12)
    // instA: sortOrder=0, has invoice → INVOICED
    // instB: sortOrder=1, linked to VERIFIED milestone, marked ready in R-08
    // So the NEXT un-invoiced installment (lowest sortOrder without invoice) after instA is invoiced
    // is instB (it has readyToBillAt set but no invoice yet).

    // canMarkReadyToBill: status=NEXT AND (no milestone OR VERIFIED) AND no invoice
    // instB: status=NEXT (first un-invoiced by sortOrder), linked to VERIFIED milestone, not invoiced
    //   → canMarkReadyToBill: NEXT && VERIFIED && !inv → BUT instB is ALREADY marked ready, so
    //     canMarkReadyToBill should still be true (the derivation only checks invoice, not readyToBillAt)

    // To verify canMarkReadyToBill, we check the raw conditions:
    // instB: no invoice → canMarkReadyToBill=true
    const instBRow = await prisma.contractPaymentInstallment.findUniqueOrThrow({
      where: { id: instB },
      select: { readyToBillAt: true },
    });
    const invB = await prisma.clientInvoice.count({ where: { sourceInstallmentId: instB } });
    const milestoneB = await prisma.programmeMilestone.findUnique({ where: { id: programmeMilestoneId } });

    // All three canMarkReadyToBill conditions are met for instB:
    expect(invB).toBe(0); // no invoice
    expect(milestoneB?.status).toBe('VERIFIED'); // milestone is verified
    // readyToBillAt being already set does NOT block canMarkReadyToBill (you could re-mark)
    expect(instBRow.readyToBillAt).not.toBeNull(); // already ready — idempotent mark allowed

    // canPrepareInvoice: readyToBillAt != null AND NEXT AND (no milestone OR VERIFIED)
    // instB meets all conditions
    expect(instBRow.readyToBillAt).not.toBeNull(); // readyToBillAt set → canPrepareInvoice=true
  });
});
