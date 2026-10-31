import { Injectable } from '@nestjs/common';
import type { PrismaClient, ClientInvoice } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateClientInvoiceData {
  organizationId: string;
  clientId: string;
  sourceIpcId?: string | null;
  sourceInstallmentId?: string | null;
  // ADR-029 R-4 — the SEPARATE_CHARGE BOQ leaf a one-off invoice bills (the source tag).
  sourceBoqNodeId?: string | null;
  projectId?: string;
  contractId?: string;
  invoiceDate: Date;
  dueDate: Date;
  currencyCode: string;
  subtotal: Decimal;
  totalAmount: Decimal;
  paymentTerms?: string;
  /** A hand-typed invoice's client PO / job number and note to the client (ADR-048); null = none. */
  clientReference?: string | null;
  notes?: string | null;
  billingAddressSnapshot: object;
  createdBy: string;
  /** ADR-046 §5 — the period breakdown of an IPC invoice (omitted by every other source). */
  certifiedGrossAmount?: Decimal;
  retentionAmount?: Decimal;
  advanceRecoveryAmount?: Decimal;
  otherDeductionsAmount?: Decimal;
  /** ADR-046 §5 — the retention release invoice: its contract and the retention it bills. */
  sourceRetentionContractId?: string;
  retentionReleasedAmount?: Decimal;
}

/** ADR-048 — one priced line of a hand-typed invoice, as stored. */
export interface ManualInvoiceLineData {
  lineNo: number;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  amount: Decimal;
  revenueAccountId: string;
}

/**
 * The four mutually-exclusive source relations, each narrowed to its human reference. Read by
 * the detail and list paths so both can resolve an invoice's `source`; never by the
 * approve/post/reverse guards, which need only the flat entity.
 */
const INVOICE_SOURCE_INCLUDE = {
  sourceInstallment: { select: { id: true, name: true } },
  sourceIpc: {
    select: {
      id: true,
      application: { select: { id: true, applicationRef: true, applicationNumber: true } },
    },
  },
  sourceBoqNode: { select: { id: true, code: true, description: true } },
  sourceRetentionContract: { select: { id: true, contractNumber: true } },
} as const;

@Injectable()
export class ClientInvoiceRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({ where: { id, organizationId } });
  }

  /**
   * Same row, plus the three mutually-exclusive source relations resolved to their human
   * reference — for the detail read path only. Never used by the approve/post/reverse guards,
   * which need just the flat entity `findById` already returns.
   */
  findByIdWithSource(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.clientInvoice.findFirst({
      where: { id, organizationId },
      include: INVOICE_SOURCE_INCLUDE,
    });
  }

  findByIpc(prisma: TenantPrisma, organizationId: string, ipcId: string): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({ where: { sourceIpcId: ipcId, organizationId } });
  }

  /**
   * ADR-046 §5 — the IPC invoices a contract has already raised, with what each billed and the net
   * of its posted credit notes. Drafts count (they will bill when posted); cancelled and reversed
   * invoices billed nothing.
   */
  findEarlierIpcInvoices(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        contractId,
        sourceIpcId: { not: null },
        documentStatus: { not: 'CANCELLED' },
        postingStatus: { not: 'REVERSED' },
      },
      select: {
        id: true,
        certifiedGrossAmount: true,
        subtotal: true,
        retentionAmount: true,
        advanceRecoveryAmount: true,
        otherDeductionsAmount: true,
        creditNotes: { where: { postingStatus: 'POSTED' }, select: { netAmount: true } },
      },
    });
  }

  /**
   * ADR-046 §5 — for the over-billing check: every contract with posted IPC invoices, those
   * invoices (with posted credit notes) and the contract's latest effective certificate (highest
   * application number, then newest — certificates are cumulative).
   */
  async findIpcBillingByContract(prisma: TenantPrisma, organizationId: string) {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId, sourceIpcId: { not: null }, contractId: { not: null }, postingStatus: 'POSTED' },
      select: {
        contractId: true,
        certifiedGrossAmount: true,
        subtotal: true,
        retentionAmount: true,
        advanceRecoveryAmount: true,
        otherDeductionsAmount: true,
        creditNotes: { where: { postingStatus: 'POSTED' }, select: { netAmount: true } },
      },
    });
    const contractIds = [...new Set(invoices.map((inv) => inv.contractId!))];
    if (contractIds.length === 0) return [];

    const [contracts, certificates] = await Promise.all([
      prisma.contract.findMany({
        where: { organizationId, id: { in: contractIds } },
        select: { id: true, contractNumber: true, projectId: true, clientId: true, currency: true },
      }),
      prisma.interimPaymentCertificate.findMany({
        where: { organizationId, isEffective: true, application: { contractId: { in: contractIds } } },
        orderBy: [{ application: { applicationNumber: { sort: 'desc', nulls: 'last' } } }, { createdAt: 'desc' }],
        select: {
          certifiedTotal: true,
          deductions: { select: { amount: true } },
          application: { select: { contractId: true } },
        },
      }),
    ]);

    // Ordered latest-first, so the first certificate seen for a contract is its latest.
    const latestByContract = new Map<string, (typeof certificates)[number]>();
    for (const cert of certificates) {
      if (!latestByContract.has(cert.application.contractId)) {
        latestByContract.set(cert.application.contractId, cert);
      }
    }
    return contracts.map((contract) => ({
      ...contract,
      invoices: invoices.filter((inv) => inv.contractId === contract.id),
      latestCertificate: latestByContract.get(contract.id) ?? null,
    }));
  }

  /**
   * ADR-046 §5 — a contract's retention position, everything a release invoice is checked against:
   *  - `held`: retention on posted IPC invoices (debited to Retention Receivable);
   *  - `pendingWithRetention`: unposted IPC invoices still carrying retention (they must post or be
   *    cancelled first, or a release would leave their retention behind);
   *  - `released`: retention billed on posted release invoices (credited back out), excluding
   *    `exceptInvoiceId` (the invoice being posted);
   *  - `openDraft`: an unposted, uncancelled release invoice, if any.
   * Reversed and cancelled invoices count nowhere.
   */
  async findRetentionPosition(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
    exceptInvoiceId?: string,
  ) {
    const unposted = ['NOT_POSTED', 'PENDING', 'FAILED'] as const;
    const [held, pendingWithRetention, released, openDraft] = await Promise.all([
      prisma.clientInvoice.aggregate({
        where: { organizationId, contractId, sourceIpcId: { not: null }, postingStatus: 'POSTED' },
        _sum: { retentionAmount: true },
      }),
      prisma.clientInvoice.count({
        where: {
          organizationId,
          contractId,
          sourceIpcId: { not: null },
          documentStatus: { not: 'CANCELLED' },
          postingStatus: { in: [...unposted] },
          retentionAmount: { gt: 0 },
        },
      }),
      prisma.clientInvoice.aggregate({
        where: {
          organizationId,
          sourceRetentionContractId: contractId,
          postingStatus: 'POSTED',
          ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}),
        },
        _sum: { retentionReleasedAmount: true },
      }),
      prisma.clientInvoice.findFirst({
        where: {
          organizationId,
          sourceRetentionContractId: contractId,
          documentStatus: { not: 'CANCELLED' },
          postingStatus: { in: [...unposted] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const heldAmount = new Decimal((held._sum.retentionAmount ?? 0).toString());
    const releasedAmount = new Decimal((released._sum.retentionReleasedAmount ?? 0).toString());
    return {
      held: heldAmount,
      released: releasedAmount,
      /** What a release invoice may bill now. */
      due: heldAmount.minus(releasedAmount),
      pendingWithRetention,
      openDraft,
    };
  }

  // ADR-023: one invoice per payment-schedule installment (idempotent milestone billing).
  /**
   * H2 — whether variation billing lines name this invoice, or (for a stage invoice) its stage.
   * Such an invoice keeps its source tag when reversed: the variation lines are undone by a credit
   * note, and the `(variation, installment)` unique would refuse them on a re-billed stage.
   */
  async hasVariationBilling(
    prisma: TenantPrisma,
    organizationId: string,
    invoiceId: string,
    installmentId: string | null,
  ): Promise<boolean> {
    const count = await prisma.variationBillingAllocation.count({
      where: {
        organizationId,
        OR: [{ clientInvoiceId: invoiceId }, ...(installmentId ? [{ installmentId }] : [])],
      },
    });
    return count > 0;
  }

  findByInstallment(
    prisma: TenantPrisma,
    organizationId: string,
    installmentId: string,
  ): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({
      where: { sourceInstallmentId: installmentId, organizationId },
    });
  }

  // ADR-029 R-4: one invoice per SEPARATE_CHARGE BOQ leaf (idempotent one-off billing).
  findByBoqNode(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeId: string,
  ): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({
      where: { sourceBoqNodeId: boqNodeId, organizationId },
    });
  }

  /**
   * ADR-029 R-4: the SEPARATE_CHARGE BOQ leaf being billed, with its version → BOQ → project and that
   * project's main client contract (+ client) — everything generateFromSeparateCharge needs to derive
   * the amount and the client/contract. Scoped to the org through the version → boq relation (BoqNode
   * carries no direct `boq` navigation). Returns null if the node is not a SEPARATE_CHARGE leaf, if the
   * project has no BOQ, or if there is no billable client contract.
   */
  findSeparateChargeForBilling(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeId: string,
  ) {
    return prisma.boqNode.findFirst({
      where: {
        id: boqNodeId,
        isLeaf: true,
        commercialTreatment: 'SEPARATE_CHARGE',
        version: { boq: { organizationId } },
      },
      include: {
        version: {
          include: {
            boq: {
              include: {
                project: {
                  include: {
                    contracts: {
                      where: {
                        contractKind: 'CLIENT_CONTRACT',
                        status: { notIn: ['CANCELLED', 'TERMINATED'] as never[] },
                      },
                      orderBy: { createdAt: 'desc' },
                      take: 1,
                      include: { client: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  // ADR-023: the installment being billed, with its contract (+ client) and linked programme
  // milestone — everything generateFromInstallment needs to derive the amount and apply the
  // CONST-COM-011 gate. Scoped to the org through the contract relation.
  findInstallmentForBilling(prisma: TenantPrisma, organizationId: string, installmentId: string) {
    return prisma.contractPaymentInstallment.findFirst({
      where: { id: installmentId, contract: { organizationId } },
      include: { contract: { include: { client: true } }, programmeMilestone: true },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, filter: { clientId?: string; projectId?: string } = {}) {
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
      },
      include: INVOICE_SOURCE_INCLUDE,
      orderBy: { invoiceDate: 'desc' },
    });
  }

  /**
   * CI-3 — what has settled each invoice, by kind: receipts applied, credit notes, write-offs.
   * Posted rows only; a reversed receipt, credit note or write-off gave its amount back.
   */
  async findSettlementTotals(prisma: TenantPrisma, organizationId: string, invoiceIds: string[]) {
    const totals = new Map<string, { paid: Decimal; credited: Decimal; writtenOff: Decimal }>();
    if (invoiceIds.length === 0) return totals;
    const zero = () => ({ paid: new Decimal(0), credited: new Decimal(0), writtenOff: new Decimal(0) });
    const [paid, credited, writtenOff] = await Promise.all([
      prisma.clientReceiptAllocation.groupBy({
        by: ['clientInvoiceId'],
        where: { organizationId, clientInvoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { allocatedAmount: true },
      }),
      prisma.creditNote.groupBy({
        by: ['invoiceId'],
        where: { organizationId, invoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { totalAmount: true },
      }),
      prisma.receivableWriteOff.groupBy({
        by: ['invoiceId'],
        where: { organizationId, invoiceId: { in: invoiceIds }, status: 'POSTED' },
        _sum: { amount: true },
      }),
    ]);
    const at = (id: string) => totals.get(id) ?? totals.set(id, zero()).get(id)!;
    for (const row of paid) at(row.clientInvoiceId).paid = new Decimal(row._sum.allocatedAmount ?? 0);
    for (const row of credited) at(row.invoiceId).credited = new Decimal(row._sum.totalAmount ?? 0);
    for (const row of writtenOff) at(row.invoiceId).writtenOff = new Decimal(row._sum.amount ?? 0);
    return totals;
  }

  /** CI-3 — the receipts applied to one invoice, oldest first. */
  findPayments(prisma: TenantPrisma, organizationId: string, invoiceId: string) {
    return prisma.clientReceiptAllocation.findMany({
      where: { organizationId, clientInvoiceId: invoiceId, postingStatus: 'POSTED' },
      select: {
        id: true,
        allocatedAmount: true,
        allocationDate: true,
        receipt: { select: { id: true, receiptNumber: true, receiptDate: true, paymentMethod: true, reference: true } },
      },
      orderBy: [{ allocationDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findUnpostedApproved(prisma: TenantPrisma, organizationId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' },
    });
  }

  create(prisma: TenantPrisma, data: CreateClientInvoiceData): Promise<ClientInvoice> {
    return prisma.clientInvoice.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        sourceIpcId: data.sourceIpcId,
        sourceInstallmentId: data.sourceInstallmentId ?? null,
        sourceBoqNodeId: data.sourceBoqNodeId ?? null,
        projectId: data.projectId ?? null,
        contractId: data.contractId ?? null,
        invoiceDate: data.invoiceDate,
        dueDate: data.dueDate,
        currencyCode: data.currencyCode,
        subtotal: data.subtotal,
        totalAmount: data.totalAmount,
        outstandingAmount: data.totalAmount,
        paymentTerms: data.paymentTerms ?? null,
        billingAddressSnapshot: data.billingAddressSnapshot,
        certifiedGrossAmount: data.certifiedGrossAmount ?? null,
        retentionAmount: data.retentionAmount ?? 0,
        advanceRecoveryAmount: data.advanceRecoveryAmount ?? 0,
        otherDeductionsAmount: data.otherDeductionsAmount ?? 0,
        sourceRetentionContractId: data.sourceRetentionContractId ?? null,
        retentionReleasedAmount: data.retentionReleasedAmount ?? 0,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
      },
    });
  }

  /**
   * Cancel one unposted invoice and free its source, so the certificate / charge / release can be
   * billed again. Conditional on still being unposted: a concurrent post makes this a no-op (0).
   */
  async cancelDraft(prisma: TenantPrisma, organizationId: string, id: string, cancelledBy: string, reason: string) {
    const result = await prisma.clientInvoice.updateMany({
      where: {
        id,
        organizationId,
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
        documentStatus: { not: 'CANCELLED' },
      },
      data: {
        documentStatus: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason: reason,
        sourceIpcId: null,
        sourceBoqNodeId: null,
        sourceInstallmentId: null,
      },
    });
    return result.count;
  }

  // ─── ADR-048 — hand-typed (non-contract) invoices ─────────────────────────────

  /**
   * The income accounts a manual invoice line may credit, by code: active, posting-allowed, and
   * of class INCOME in their current version. Anything else (a header, a control account, an
   * expense) is simply absent from the result, so the service can name the bad code.
   */
  async findIncomeAccountsByCode(prisma: TenantPrisma, organizationId: string, codes: string[]) {
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        code: { in: codes },
        status: 'ACTIVE',
        versions: { some: { effectiveTo: null, accountClass: 'INCOME', isPostingAllowed: true, isControlAccount: false } },
      },
      select: { id: true, code: true },
    });
    return new Map(accounts.map((a) => [a.code, a.id]));
  }

  /** Every income account a manual invoice line may credit, by code — the form's choices. */
  async listIncomeAccounts(prisma: TenantPrisma, organizationId: string) {
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        versions: { some: { effectiveTo: null, accountClass: 'INCOME', isPostingAllowed: true, isControlAccount: false } },
      },
      orderBy: { code: 'asc' },
      select: { code: true, versions: { where: { effectiveTo: null }, select: { name: true, accountSubtype: true } } },
    });
    return accounts.map((a) => ({
      code: a.code,
      name: a.versions[0]?.name ?? a.code,
      subtype: a.versions[0]?.accountSubtype ?? null,
    }));
  }

  findClientForInvoice(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true, name: true, status: true, address: true, taxNumber: true, city: true, countryCode: true },
    });
  }

  createManual(
    prisma: TenantPrisma,
    data: CreateClientInvoiceData,
    lines: ManualInvoiceLineData[],
  ): Promise<ClientInvoice> {
    return prisma.clientInvoice.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        isManual: true,
        invoiceDate: data.invoiceDate,
        dueDate: data.dueDate,
        currencyCode: data.currencyCode,
        subtotal: data.subtotal,
        totalAmount: data.totalAmount,
        outstandingAmount: data.totalAmount,
        paymentTerms: data.paymentTerms ?? null,
        clientReference: data.clientReference ?? null,
        notes: data.notes ?? null,
        billingAddressSnapshot: data.billingAddressSnapshot,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
        lines: {
          create: lines.map((l) => ({ ...l, organizationId: data.organizationId, currencyCode: data.currencyCode })),
        },
      },
    });
  }

  /** Rewrite a draft manual invoice's header figures and its whole line set. Run inside a tx. */
  async replaceManual(
    tx: TenantPrisma,
    invoiceId: string,
    header: Pick<
      CreateClientInvoiceData,
      'clientId' | 'invoiceDate' | 'dueDate' | 'currencyCode' | 'subtotal' | 'totalAmount' | 'paymentTerms' | 'clientReference' | 'notes' | 'billingAddressSnapshot'
    >,
    organizationId: string,
    lines: ManualInvoiceLineData[],
  ): Promise<ClientInvoice> {
    await tx.clientInvoiceLine.deleteMany({ where: { invoiceId } });
    return tx.clientInvoice.update({
      where: { id: invoiceId },
      data: {
        clientId: header.clientId,
        invoiceDate: header.invoiceDate,
        dueDate: header.dueDate,
        currencyCode: header.currencyCode,
        subtotal: header.subtotal,
        totalAmount: header.totalAmount,
        outstandingAmount: header.totalAmount,
        paymentTerms: header.paymentTerms ?? null,
        clientReference: header.clientReference ?? null,
        notes: header.notes ?? null,
        billingAddressSnapshot: header.billingAddressSnapshot,
        // A PDF previewed before this edit shows the old draft: drop it so the next view renders anew.
        documentFileId: null,
        revision: { increment: 1 },
        lines: { create: lines.map((l) => ({ ...l, organizationId, currencyCode: header.currencyCode })) },
      },
    });
  }

  findManualLines(prisma: TenantPrisma, organizationId: string, invoiceId: string) {
    return prisma.clientInvoiceLine.findMany({
      where: { invoiceId, organizationId },
      orderBy: { lineNo: 'asc' },
      include: { revenueAccount: { select: { code: true } } },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    invoiceNumber: string,
    postedBy: string,
  ) {
    return prisma.clientInvoice.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        invoiceNumber,
        postedAt: new Date(),
        postedBy,
      },
    });
  }

  markPostingFailed(prisma: TenantPrisma, id: string, errorCode: string) {
    return prisma.clientInvoice.update({
      where: { id },
      data: {
        postingStatus: 'FAILED',
        lastPostingAttemptAt: new Date(),
        lastPostingErrorCode: errorCode,
      },
    });
  }

  approve(prisma: TenantPrisma, id: string, approvedBy: string) {
    return prisma.clientInvoice.update({
      where: { id },
      data: { documentStatus: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  /**
   * Commercial redesign D8 — replace the frozen branding snapshot on a not-yet-posted invoice and drop
   * any draft PDF rendered from the old one (it carried no invoice number either), so the document is
   * regenerated from the issued state. Guarded on NOT posted in the WHERE, so a posted invoice's
   * snapshot can never be rewritten through this path. Returns the number of rows changed (0 or 1).
   */
  async replaceBrandingSnapshotIfUnposted(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
    billingAddressSnapshot: object,
  ): Promise<number> {
    const result = await prisma.clientInvoice.updateMany({
      where: {
        id,
        organizationId,
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
        documentStatus: { not: 'CANCELLED' },
      },
      data: { billingAddressSnapshot, documentFileId: null },
    });
    return result.count;
  }

  updateOutstandingAmount(prisma: TenantPrisma, id: string, outstandingAmount: Decimal) {
    return prisma.clientInvoice.update({ where: { id }, data: { outstandingAmount } });
  }

  /**
   * Compare-and-set the invoice's document file: bind `documentFileId` only if it is still null.
   * Returns true if this call won, false if another concurrent request already set it.
   *
   * This is what makes lazy document generation race-safe. Two first-requests for the same
   * never-documented invoice each render + store their own PDF file; without this guard both would
   * blindly overwrite `documentFileId` (last-write-wins) and the loser's already-stored file would
   * be orphaned forever. With it, only the first `updateMany` matches the `documentFileId: null`
   * predicate; the loser sees `count === 0` and discards its freshly-generated file.
   */
  async bindDocumentFileIdIfUnset(
    prisma: TenantPrisma,
    id: string,
    documentFileId: string,
  ): Promise<boolean> {
    const { count } = await prisma.clientInvoice.updateMany({
      where: { id, documentFileId: null },
      data: { documentFileId },
    });
    return count === 1;
  }
}
