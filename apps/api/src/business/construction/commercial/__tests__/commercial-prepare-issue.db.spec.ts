import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { InvoiceDocumentService } from '../../../accounting/accounts-receivable/application/invoice-document.service.js';
import type { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import type { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import type { CollectionEventsService } from '../../../accounting/accounts-receivable/application/collection-events.service.js';
import { DocumentSequenceRepository } from '../../../accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { ClientInvoiceRepository } from '../../../accounting/accounts-receivable/infrastructure/client-invoice.repository.js';
import { ClientInvoiceService } from '../../../accounting/accounts-receivable/application/client-invoice.service.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../../variations/application/variation-order.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';
import { CommercialService } from '../application/commercial.service.js';
import { CommercialWorkspaceService } from '../application/commercial-workspace.service.js';
import { linkVerifiedMilestones } from './verified-milestones.fixture.js';

/**
 * Commercial redesign D1 (2026-09-28) — prepare → issue → delete, live DB.
 *
 * Fixture: ACTIVE MILESTONE contract, base 500,000 USD, four stages:
 *   stA 40% (200,000) — prepared with VO-ADD (+10,000) and VO-OMIT (−5,000), then issued
 *   stB 30% (150,000) — prepared with VO-DEL (+4,000), then deleted, then re-prepared
 *   stC 20% (100,000) — prepared, milestone un-verified, issue refused
 *   stD 10% ( 50,000) — MILESTONE with no link: prepare refused
 * Plus one SEPARATE_CHARGE BOQ leaf (8,000) drafted through AR and issued alone.
 */
describe('Commercial redesign D1 — prepare / issue / delete (DB)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `prep-org-${suffix}`;

  let billing: CommercialBillingService;
  let workspace: CommercialWorkspaceService;
  let clientInvoiceService: ClientInvoiceService;
  let identity: RequestIdentity;
  let projectId: string;
  let contractId: string;
  let boqId: string;
  let versionId: string;
  const st: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
  const vo: Record<'ADD' | 'OMIT' | 'DEL', string> = { ADD: '', OMIT: '', DEL: '' };

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;
    const postingPort = {
      post: async (
        data: {
          journalCategory: string;
          entryPurpose: string;
          documentDate: Date;
          accountingDate: Date;
          description: string;
          currencyCode: string;
          sourceDocumentType?: string;
          sourceDocumentId?: string;
          createdBy: string;
        },
        tx: PrismaClient,
      ) => {
        const je = await tx.journalEntry.create({
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
    const resolver = { resolveByCodeOrRole: async () => ({ id: `acc-${randomUUID().slice(0, 8)}` }) };

    clientInvoiceService = new ClientInvoiceService(
      tenancy,
      new ClientInvoiceRepository(),
      new DocumentSequenceRepository(),
      resolver as never,
      postingPort as never,
      {} as unknown as InvoiceDocumentService,
      {} as unknown as PlatformFileService,
    );
    const variationRepo = new VariationOrderPrismaRepository();
    const variationService = new VariationOrderService(tenancy, variationRepo, projectAccess, auditOutbox);
    const repo = new CommercialPrismaRepository();
    billing = new CommercialBillingService(
      tenancy,
      projectAccess,
      repo,
      variationRepo,
      variationService,
      clientInvoiceService,
      {} as never,
      auditOutbox,
    );
    const commercial = new CommercialService(
      tenancy,
      projectAccess,
      repo,
      variationRepo,
      {} as unknown as BoqVersioningService,
      {} as unknown as CollectionEventsService,
    );
    const files = {
      getDownloadUrl: async () => ({ url: 'https://signed.example/logo.png' }),
    } as unknown as PlatformFileService;
    workspace = new CommercialWorkspaceService(tenancy, projectAccess, repo, variationRepo, commercial, files);

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `prep-${suffix}`,
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

  async function makeVo(ref: string, amount: string) {
    const row = await prisma.variationOrder.create({
      data: {
        organizationId: orgId,
        contractId,
        reference: ref,
        title: `${ref} title`,
        status: 'CLIENT_APPROVED',
        createdBy: 'u1',
        lines: {
          create: [
            { description: ref, quantity: new Decimal('1'), unitRate: new Decimal(amount), amount: new Decimal(amount), sortOrder: 0 },
          ],
        },
      },
    });
    return row.id;
  }

  async function seed() {
    await prisma.organization.create({
      data: { id: orgId, name: `Prep Org ${suffix}`, slug: `prep-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: { organizationId: orgId, code: `PREP-${suffix.slice(-6)}`, name: 'Prepare project', currency: 'USD', createdBy: 'u1' },
    });
    projectId = project.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Prep Client', address: '1 Client Rd' },
    });
    const boq = await prisma.boq.create({ data: { organizationId: orgId, projectId, currency: 'USD' } });
    boqId = boq.id;
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    versionId = version.id;
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `PREP-${suffix.slice(-6)}-C1`,
        contractValue: new Decimal('500000'),
        baseContractValue: new Decimal('500000'),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        paymentTerms: '30 days',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;
    const inst = (name: string, pct: string, sortOrder: number) =>
      prisma.contractPaymentInstallment.create({
        data: { contractId, name, sortOrder, percentage: new Decimal(pct), triggerType: 'MILESTONE', milestoneLabel: name },
      });
    st.A = (await inst('Stage A', '0.4000', 0)).id;
    st.B = (await inst('Stage B', '0.3000', 1)).id;
    st.C = (await inst('Stage C', '0.2000', 2)).id;
    await linkVerifiedMilestones(prisma, contractId);
    st.D = (await inst('Stage D', '0.1000', 3)).id; // created after linking: stays unlinked

    vo.ADD = await makeVo('VO-ADD', '10000');
    vo.OMIT = await makeVo('VO-OMIT', '-5000');
    vo.DEL = await makeVo('VO-DEL', '4000');
  }

  afterAll(async () => {
    await prisma.clientInvoiceDelivery.deleteMany({ where: { organizationId: orgId } });
    await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.documentNumberSequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
    await prisma.programmeMilestone.deleteMany({ where: { organizationId: orgId } });
    await prisma.variationOrderLine.deleteMany({ where: { variationOrder: { organizationId: orgId } } });
    await prisma.variationOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqNode.deleteMany({ where: { boqId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  const invoicesOf = (ids: string[]) =>
    prisma.clientInvoice.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });

  // ─── Prepare ──────────────────────────────────────────────────────────────────

  it('PR-01: prepare creates drafts only — stage (omission netted) + VO addition, no numbers, no journal', async () => {
    const res = await billing.preparePackage(identity, projectId, st.A, {
      selectedVariationIds: [vo.ADD, vo.OMIT],
      invoiceDate: '2026-09-20',
      notes: 'Stage A billing',
    });
    expect(res.invoiceIds).toHaveLength(2);
    expect(res.invoiceIds[0]).toBe(res.invoiceId);

    const [stage, voInv] = [
      await prisma.clientInvoice.findUniqueOrThrow({ where: { id: res.invoiceId } }),
      await prisma.clientInvoice.findUniqueOrThrow({ where: { id: res.invoiceIds[1]! } }),
    ];
    for (const inv of [stage, voInv]) {
      expect(inv.documentStatus).toBe('DRAFT');
      expect(inv.postingStatus).toBe('NOT_POSTED');
      expect(inv.invoiceNumber).toBeNull();
      expect(inv.postedJournalEntryId).toBeNull();
      expect(inv.notes).toBe('Stage A billing');
      // Due date defaulted from the contract's "30 days".
      expect(inv.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-20');
    }
    expect(stage.subtotal.toString()).toBe('195000'); // 200,000 − 5,000 omission
    expect(voInv.subtotal.toString()).toBe('10000');

    const allocs = await prisma.variationBillingAllocation.findMany({ where: { installmentId: st.A } });
    expect(allocs.map((a) => a.treatment).sort()).toEqual(['INVOICE', 'STAGE_REDUCTION']);

    // D2 — preparing records readiness.
    const inst = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: st.A } });
    expect(inst.readyToBillAt).not.toBeNull();
    expect(inst.readyToBillBy).toBe('u1');
  });

  it('PR-02: prepare refuses a stage that already has a live invoice (STAGE_ALREADY_INVOICED)', async () => {
    await expect(billing.preparePackage(identity, projectId, st.A, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAGE_ALREADY_INVOICED' }),
    });
  });

  it('PR-03: prepare refuses an unlinked work-completion stage (MILESTONE_NOT_LINKED)', async () => {
    await expect(billing.preparePackage(identity, projectId, st.D, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MILESTONE_NOT_LINKED', errorCode: 'MILESTONE_NOT_LINKED' }),
    });
  });

  it('PR-04: prepare refuses an installment of another project (404)', async () => {
    await expect(billing.preparePackage(identity, 'other-project', st.B, {})).rejects.toThrow(/not found/i);
  });

  it('PR-05: the schedule reports the stage draft; the preview refuses an invoiced stage', async () => {
    const built = await workspace.getWorkspace(identity, projectId);
    const todoDraft = built.todo.find((t) => t.kind === 'DRAFT_INVOICE');
    expect(todoDraft?.installmentId).toBe(st.A);
    // One row per package: the VO draft riding on Stage A is folded into the stage's row, and the
    // row's amount is the package total (195,000 + 5% = 204,750, plus 10,000 + 5% = 10,500).
    expect(built.todo.filter((t) => t.kind === 'DRAFT_INVOICE')).toHaveLength(1);
    expect(todoDraft?.amount).toBe('215250.00'); // 204,750 + 10,500
    await expect(workspace.getPreparePreview(identity, projectId, st.A)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAGE_ALREADY_INVOICED' }),
    });
  });

  // ─── Issue ────────────────────────────────────────────────────────────────────

  it('IS-01: issue posts the whole package in one command, numbers + journals, with fresh branding (D8)', async () => {
    const stageInv = await prisma.clientInvoice.findFirstOrThrow({ where: { sourceInstallmentId: st.A } });
    await prisma.organization.update({ where: { id: orgId }, data: { name: `Renamed Org ${suffix}` } });

    const res = await billing.issueInvoice(identity, projectId, stageInv.id);
    expect(res.invoiceIds).toHaveLength(2);
    expect(res.invoiceNumbers.every((n) => /^INV-/.test(n))).toBe(true);

    const docs = await invoicesOf(res.invoiceIds);
    for (const inv of docs) {
      expect(inv.postingStatus).toBe('POSTED');
      expect(inv.documentStatus).toBe('APPROVED');
      expect(inv.postedJournalEntryId).not.toBeNull();
      expect((inv.billingAddressSnapshot as { org: { name: string } }).org.name).toBe(`Renamed Org ${suffix}`);
      // Prepared 2026-09-20 (due 2026-10-20): dated the day it is issued, 30-day terms kept.
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
      expect(inv.invoiceDate.toISOString().slice(0, 10)).toBe(today);
      expect(inv.dueDate?.toISOString().slice(0, 10)).toBe(due);
    }
  });

  it('IS-02: issuing again is idempotent — same documents, no new numbers', async () => {
    const stageInv = await prisma.clientInvoice.findFirstOrThrow({ where: { sourceInstallmentId: st.A } });
    const before = await prisma.documentNumberSequence.findMany({ where: { organizationId: orgId } });
    const res = await billing.issueInvoice(identity, projectId, stageInv.id);
    expect(res.invoiceIds).toHaveLength(2);
    const after = await prisma.documentNumberSequence.findMany({ where: { organizationId: orgId } });
    expect(after).toEqual(before);
  });

  it('IS-03: a posted invoice cannot be deleted (INVOICE_ALREADY_ISSUED)', async () => {
    const stageInv = await prisma.clientInvoice.findFirstOrThrow({ where: { sourceInstallmentId: st.A } });
    await expect(billing.deleteDraftInvoice(identity, projectId, stageInv.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVOICE_ALREADY_ISSUED' }),
    });
  });

  it('IS-04: the document read model shows the issued invoice with lines and lifecycle ISSUED', async () => {
    const stageInv = await prisma.clientInvoice.findFirstOrThrow({ where: { sourceInstallmentId: st.A } });
    const doc = await workspace.getInvoiceDocument(identity, projectId, stageInv.id);
    expect(doc.lifecycle).toBe('ISSUED');
    expect(doc.invoiceNumber).toMatch(/^INV-/);
    expect(doc.issuer.name).toBe(`Renamed Org ${suffix}`);
    expect(doc.lines).toEqual([
      { description: 'Stage A', detail: '40% of contract value', amount: '200000.00' },
      { description: 'VO-OMIT — VO-OMIT title', detail: 'Omission', amount: '-5000.00' },
    ]);
    expect(doc.subtotal).toBe('195000.00');
    expect(doc.taxLabel).toBe('Sales tax 5%');
    expect(doc.paymentTermsDays).toBe(30);
    expect(doc.capabilities).toMatchObject({ canIssue: false, canSend: true, canRecordPayment: true });
  });

  // ─── Delete ───────────────────────────────────────────────────────────────────

  it('DL-01: deleting a VO draft cancels the whole package and releases the VO allocation', async () => {
    const prep = await billing.preparePackage(identity, projectId, st.B, { selectedVariationIds: [vo.DEL] });
    expect(prep.invoiceIds).toHaveLength(2);
    expect(await prisma.variationBillingAllocation.count({ where: { variationId: vo.DEL } })).toBe(1);

    const res = await billing.deleteDraftInvoice(identity, projectId, prep.invoiceIds[1]!);
    expect(res.cancelledInvoiceIds.sort()).toEqual([...prep.invoiceIds].sort());

    const docs = await invoicesOf(prep.invoiceIds);
    for (const inv of docs) {
      expect(inv.documentStatus).toBe('CANCELLED');
      expect(inv.cancelledBy).toBe('u1');
      expect(inv.sourceInstallmentId).toBeNull();
    }
    expect(await prisma.variationBillingAllocation.count({ where: { variationId: vo.DEL } })).toBe(0);

    // The VO reads unbilled again and the stage is ready to prepare again.
    const preview = await workspace.getPreparePreview(identity, projectId, st.B);
    expect(preview.blocker).toBeNull();
    expect(preview.variations.map((v) => v.reference)).toContain('VO-DEL');
    const again = await billing.preparePackage(identity, projectId, st.B, { selectedVariationIds: [vo.DEL] });
    expect(again.invoiceIds).toHaveLength(2);
  });

  // ─── Issue refused when the stage is blocked at post ────────────────────────────

  it('IS-05: issue refuses (and posts nothing) when the linked milestone is no longer verified', async () => {
    const prep = await billing.preparePackage(identity, projectId, st.C, {});
    const inst = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: st.C } });
    await prisma.programmeMilestone.update({ where: { id: inst.programmeMilestoneId! }, data: { status: 'PLANNED' } });

    await expect(billing.issueInvoice(identity, projectId, prep.invoiceId)).rejects.toThrow(/not yet verified/i);
    const inv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: prep.invoiceId } });
    expect(inv.postingStatus).toBe('NOT_POSTED');
    expect(inv.invoiceNumber).toBeNull();
  });

  // ─── Separate charge — no prepare, issued alone ──────────────────────────────

  it('SC-01: a separate-charge draft is issued on its own', async () => {
    const node = await prisma.boqNode.create({
      data: {
        boqId,
        versionId,
        path: `sc-${suffix}`,
        code: 'SC-01',
        description: 'Extra site mobilisation',
        isLeaf: true,
        commercialTreatment: 'SEPARATE_CHARGE',
        quantity: new Decimal('1'),
        unitRate: new Decimal('8000'),
        totalAmount: new Decimal('8000'),
      },
    });
    const draft = await clientInvoiceService.generateFromSeparateCharge(identity, {
      boqNodeId: node.id,
      invoiceDate: '2026-09-21',
      dueDate: '2026-10-21',
    });
    const res = await billing.issueInvoice(identity, projectId, draft.id);
    expect(res.invoiceIds).toEqual([draft.id]);
    const inv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(inv.postingStatus).toBe('POSTED');
    expect(inv.invoiceNumber).toMatch(/^INV-/);
  });

  // ─── Statement ─────────────────────────────────────────────────────────────────

  it('ST-01: the statement lists the posted invoices oldest first with a running balance', async () => {
    const statement = await workspace.getStatement(identity, projectId);
    const posted = await prisma.clientInvoice.findMany({
      where: { contractId, postingStatus: 'POSTED' },
    });
    const total = posted.reduce((s, i) => s.plus(i.totalAmount), new Decimal(0));
    expect(statement.lines).toHaveLength(posted.length);
    expect(statement.lines.every((l) => l.kind === 'INVOICE')).toBe(true);
    expect(statement.closingBalance).toBe(total.toFixed(2));
  });
});
