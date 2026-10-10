import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── Collection data types ────────────────────────────────────────────────────

export interface CollectionFollowUpRow {
  id: string;
  method: string;
  contactPerson: string | null;
  note: string | null;
  occurredAt: Date;
  recordedAt: Date;
  recordedBy: string;
}

export interface CollectionPromiseRow {
  id: string;
  promisedDate: Date;
  promisedAmount: Decimal | null;
  outstandingAtPromise: Decimal;
  note: string | null;
  recordedAt: Date;
  recordedBy: string;
}

export interface CollectionDisputeRow {
  id: string;
  disputedAmount: Decimal | null;
  reason: string;
  note: string | null;
  openedAt: Date;
  openedBy: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface CollectionCreditNoteRow {
  id: string;
  creditNoteNumber: string | null;
  reason: string;
  netAmount: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  accountingDate: Date;
  postingStatus: string;
  note: string | null;
  createdAt: Date;
}

export interface CollectionAllocationRow {
  allocatedAmount: Decimal;
  allocationDate: Date;
}

export interface InvoiceCollectionData {
  followUps: CollectionFollowUpRow[];
  promises: CollectionPromiseRow[];
  openDispute: CollectionDisputeRow | null;
  disputes: CollectionDisputeRow[];
  creditNotes: CollectionCreditNoteRow[];
  /** Posted allocations with allocationDate >= any promise recordedAt (for fulfillment derivation) */
  allocationsForPromises: CollectionAllocationRow[];
}

export type CollectionDataByInvoice = Map<string, InvoiceCollectionData>;

/** One project's posted receivables — see `findPostedReceivablesByProject`. */
export interface PostedReceivables {
  invoices: {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: Date;
    dueDate: Date | null;
    currencyCode: string;
    subtotal: Decimal;
    totalAmount: Decimal;
    outstandingAmount: Decimal;
    sourceInstallmentId: string | null;
    deliveryCount: number;
  }[];
  postedCreditNotesSum: Decimal;
  /** The same credit notes before sales tax. */
  postedCreditNotesNetSum: Decimal;
  collectedSum: Decimal;
}

/**
 * A project's live client contract: the CLIENT_CONTRACT that is not cancelled or terminated (the
 * newest wins). One rule for `findMainContract` and the Finance portfolio's batched read.
 */
export function mainContractWhere(organizationId: string, projectId: string | { in: string[] }) {
  return {
    organizationId,
    projectId,
    contractKind: 'CLIENT_CONTRACT' as const,
    status: { notIn: ['CANCELLED', 'TERMINATED'] as never[] },
  };
}

/**
 * Read-only aggregation for the Commercial workspace. Construction reads AR data
 * (ClientInvoice, ClientReceiptAllocation) — construction → accounting, allowed by
 * ARCH-BOUNDARY-001. Everything is set-based: one query per collection, no N+1.
 */
@Injectable()
export class CommercialPrismaRepository {
  /** The effective (non-terminal) main client contract for a project, with its terms. */
  findMainContract(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.contract.findFirst({
      where: mainContractWhere(organizationId, projectId),
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        retentionTerms: true,
        advanceTerms: true,
        guarantees: { orderBy: { expiryDate: 'asc' } },
        deliverables: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  /**
   * The version number behind `Contract.boqVersionId`.
   *
   * A separate lookup because `boqVersionId` is a bare column with no Prisma relation — the
   * BOQ is its own aggregate and the contract references it by id rather than owning it. One
   * extra query beats declaring a relation the domain model does not have.
   */
  async findBoqVersionNumber(prisma: TenantPrisma, boqVersionId: string): Promise<number | null> {
    const version = await prisma.boqVersion.findUnique({
      where: { id: boqVersionId },
      select: { versionNumber: true },
    });
    return version?.versionNumber ?? null;
  }

  /** ADR-029 R-4 — the SEPARATE_CHARGE BOQ leaves on a contract's BOQ version, with their one-off invoice. */
  findSeparateChargeBoqLeaves(prisma: TenantPrisma, boqVersionId: string) {
    return prisma.boqNode.findMany({
      where: {
        versionId: boqVersionId,
        commercialTreatment: 'SEPARATE_CHARGE',
        isLeaf: true,
        isActive: true,
      },
      include: {
        separateChargeInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            postingStatus: true,
            invoiceDate: true,
            dueDate: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * The second origin of a one-off invoice (B11 unification): a client-approved VO addition
   * billed STANDALONE inside a milestone billing package (`issuePackage` → `generateStandaloneCharge`).
   * The allocation row and its invoice are created atomically, so `clientInvoice` is never null here
   * for a row this query returns real data for.
   */
  findVariationBillingInvoiceAllocations(prisma: TenantPrisma, contractId: string) {
    return prisma.variationBillingAllocation.findMany({
      where: {
        treatment: 'INVOICE',
        variation: { contractId },
      },
      include: {
        variation: { select: { id: true, reference: true, title: true } },
        clientInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            postingStatus: true,
            invoiceDate: true,
            dueDate: true,
            totalAmount: true,
            currencyCode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** All effective certificates for a contract — the only ones that count (CONST-COM-003). */
  findEffectiveCertificates(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.interimPaymentCertificate.findMany({
      where: {
        organizationId,
        isEffective: true,
        application: { contractId },
      },
      select: {
        id: true,
        applicationId: true,
        certifiedTotal: true,
        currency: true,
        // `deductionType` as well as the amount: retention held and advance recovered are the
        // RETENTION / ADVANCE_RECOVERY slices of this same set, and deriving them here means
        // they can never disagree with the certified-net figure computed beside them.
        deductions: { select: { amount: true, deductionType: true } },
      },
    });
  }

  /** All IPAs for a contract with their certificates (effective + superseded counts). */
  findApplicationsWithCertificates(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ) {
    return prisma.interimPaymentApplication.findMany({
      where: { organizationId, contractId },
      orderBy: [{ applicationNumber: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: { select: { periodAmount: true } },
        certificates: {
          select: {
            id: true,
            status: true,
            isEffective: true,
            certifiedTotal: true,
            deductions: { select: { amount: true } },
          },
        },
      },
    });
  }

  /**
   * How many applications have reached the client.
   *
   * DRAFT and PENDING_INTERNAL_APPROVAL are internal working states — counting them would
   * tell a commercial manager they have submitted more than they have.
   */
  countSubmittedApplications(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.interimPaymentApplication.count({
      where: {
        organizationId,
        contractId,
        status: { in: ['APPROVED_FOR_SUBMISSION', 'SUBMITTED'] as never[] },
      },
    });
  }

  /**
   * ADR-030 CONST-COM-028 (Commercial redesign P1) — the single installment the billing
   * orchestrator is billing, with its owning contract and its already-generated milestone invoice (if
   * any). Org-scoped through `contract.organizationId`. Carries exactly what `issuePackage` needs to
   * derive the stage amount, resolve VOs, and route the milestone-invoice / omission handling:
   *   - the contract's client/project/currency/billing-model/status and both value columns (the
   *     schedule spreads `baseContractValue ?? contractValue`);
   *   - the installment percentage + its linked programme milestone status (the CONST-COM-011 gate);
   *   - the existing `clientInvoice` (the milestone invoice) so an already-invoiced stage is detected.
   * Returns null when the installment is not found in this org (404).
   *
   * Slice 3B: also carries `readyToBillAt` / `readyToBillById` so the billing gate can be enforced
   * and the revoke guard can check when the status was set (for the idempotency key).
   */
  findInstallmentWithContract(
    prisma: TenantPrisma,
    organizationId: string,
    installmentId: string,
  ) {
    return prisma.contractPaymentInstallment.findFirst({
      where: { id: installmentId, contract: { organizationId } },
      select: {
        id: true,
        name: true,
        percentage: true,
        sortOrder: true,
        triggerType: true,
        programmeMilestoneId: true,
        programmeMilestone: { select: { id: true, code: true, name: true, status: true } },
        readyToBillAt: true,
        readyToBillBy: true,
        clientInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            vatAmount: true,
            totalAmount: true,
            outstandingAmount: true,
            dueDate: true,
            invoiceDate: true,
            documentStatus: true,
            postingStatus: true,
            deliveries: {
              orderBy: { sentAt: 'asc' },
              select: { id: true, method: true, recipient: true, note: true, sentAt: true, sentBy: true },
            },
          },
        },
        contract: {
          select: {
            id: true,
            organizationId: true,
            projectId: true,
            clientId: true,
            currency: true,
            billingModel: true,
            status: true,
            contractNumber: true,
            baseContractValue: true,
            contractValue: true,
            paymentTerms: true,
          },
        },
      },
    });
  }

  // Slice 3B — readiness persistence helpers. These accept a transaction client so the caller
  // can include them in a broader $transaction alongside the audit outbox write.

  /**
   * Row-lock one installment for the rest of the transaction (`SELECT … FOR UPDATE`). Mark ready,
   * undo ready and prepare all take it first, so they serialise per stage: an undo cannot slip in
   * beside a prepare, and two marks cannot both write. Returns false when the row is not in this org.
   */
  async lockInstallment(tx: TenantPrisma, organizationId: string, installmentId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT i.id FROM contract_payment_installments i
      JOIN contracts c ON c.id = i.contract_id
      WHERE i.id = ${installmentId} AND c.organization_id = ${organizationId}
      FOR UPDATE OF i`;
    return rows.length > 0;
  }

  /** Readiness + the stage's live (non-cancelled) invoice, read under the caller's lock. */
  async findReadinessForUpdate(tx: TenantPrisma, organizationId: string, installmentId: string) {
    const [row, invoice] = await Promise.all([
      tx.contractPaymentInstallment.findFirst({
        where: { id: installmentId, contract: { organizationId } },
        select: { readyToBillAt: true },
      }),
      tx.clientInvoice.findFirst({
        where: { organizationId, sourceInstallmentId: installmentId, documentStatus: { not: 'CANCELLED' } },
        select: { id: true },
      }),
    ]);
    return { readyToBillAt: row?.readyToBillAt ?? null, hasLiveInvoice: invoice !== null };
  }

  /**
   * Set readiness only while it is unset (conditional — `readyToBillAt IS NULL` in the WHERE).
   * Returns the timestamp written, or null when another mark already set it (no-op).
   */
  async markInstallmentReadyToBill(
    tx: TenantPrisma,
    organizationId: string,
    installmentId: string,
    userId: string,
    note?: string,
  ): Promise<Date | null> {
    const at = new Date();
    const { count } = await tx.contractPaymentInstallment.updateMany({
      where: { id: installmentId, contract: { organizationId }, readyToBillAt: null },
      data: { readyToBillAt: at, readyToBillBy: userId, readinessNote: note ?? null },
    });
    return count > 0 ? at : null;
  }

  /** Clear readiness only while it is set. Returns the number of rows changed (0 or 1). */
  async revokeInstallmentReadiness(tx: TenantPrisma, organizationId: string, installmentId: string) {
    const { count } = await tx.contractPaymentInstallment.updateMany({
      where: { id: installmentId, contract: { organizationId }, readyToBillAt: { not: null } },
      data: { readyToBillAt: null, readyToBillBy: null, readinessNote: null },
    });
    return count;
  }

  /**
   * ADR-030 S-VB-7 — all payment installments of a contract with their milestone invoice (if any), in
   * plan order, for the Billing-Package read model. Org-scoped through `contract.organizationId`.
   * Distinct from `findPaymentInstallments` (the cycle read, which carries the milestone link but not
   * the invoice) so neither read carries fields the other never uses.
   *
   * Slice 4B: carries `vatAmount`, `outstandingAmount`, `dueDate`, and `deliveries` on the nested
   * `clientInvoice` so the `documents[]` shape and package aggregates can be built without a
   * second round-trip.
   */
  findInstallmentsWithInvoiceForContract(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ) {
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId, contract: { organizationId } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        readyToBillAt: true,
        clientInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            vatAmount: true,
            totalAmount: true,
            outstandingAmount: true,
            dueDate: true,
            documentStatus: true,
            postingStatus: true,
            deliveries: {
              orderBy: { sentAt: 'asc' },
              select: { id: true, method: true, recipient: true, note: true, sentAt: true, sentBy: true },
            },
          },
        },
      },
    });
  }

  /**
   * ADR-030 S-VB-7 — every variation-billing allocation recorded against a contract's variations, with
   * the linked standalone invoice (for INVOICE additions) and the variation's reference/title, so the
   * Billing-Package read can group VO lines under their installment. Org-scoped; ordered oldest-first.
   *
   * Slice 4B: carries `vatAmount`, `outstandingAmount`, `dueDate`, and `deliveries` on `clientInvoice`
   * so the VO document entries in `documents[]` have the full shape without extra queries.
   */
  findVariationAllocationsForContract(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ) {
    return prisma.variationBillingAllocation.findMany({
      where: { organizationId, variation: { contractId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        variationId: true,
        amount: true,
        treatment: true,
        installmentId: true,
        clientInvoiceId: true,
        variation: { select: { reference: true, title: true } },
        clientInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            vatAmount: true,
            totalAmount: true,
            outstandingAmount: true,
            dueDate: true,
            documentStatus: true,
            postingStatus: true,
            deliveries: {
              orderBy: { sentAt: 'asc' },
              select: { id: true, method: true, recipient: true, note: true, sentAt: true, sentBy: true },
            },
          },
        },
      },
    });
  }

  /** ADR-023: the payment-schedule installments for a MILESTONE contract, in plan order. */
  findPaymentInstallments(prisma: TenantPrisma, contractId: string) {
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId },
      orderBy: { sortOrder: 'asc' },
      // CONST-COM-011: the linked programme milestone is carried so the read model can show
      // whether the installment's evidence gate is satisfied, and the UI can block invoicing
      // when the milestone is not yet verified.
      include: {
        programmeMilestone: {
          // Commercial redesign D4/D5: the dates behind a stage's expected date and "released by".
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            baselineDate: true,
            forecastDate: true,
            actualDate: true,
            verifiedAt: true,
          },
        },
      },
    });
  }

  /** Posted-or-pending client invoices for a contract, with their posted receipt allocations. */
  findInvoices(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, contractId },
      select: {
        id: true,
        sourceIpcId: true,
        sourceInstallmentId: true,
        invoiceNumber: true,
        documentStatus: true,
        postingStatus: true,
        totalAmount: true,
        // Carried so the Receivables panel can list what is still owed and when it was due,
        // without a second round trip. `outstandingAmount` is maintained by the AR allocation
        // path — it is the settlement truth ADR-017 nominates.
        outstandingAmount: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        allocations: {
          where: { postingStatus: 'POSTED' },
          select: { allocatedAmount: true },
        },
      },
    });
  }

  /**
   * Every client invoice raised under a contract, with the detail Billing & Collection needs:
   * the tax split, the settlement balance, the source document that produced it, and the posted
   * allocations behind what has been collected.
   *
   * Deliberately separate from `findInvoices` (the narrow summary read). Widening that one would
   * have made every summary request carry allocation ids and installment names it never uses.
   */
  findInvoicesForBilling(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, contractId },
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        subtotal: true,
        vatAmount: true,
        totalAmount: true,
        outstandingAmount: true,
        documentStatus: true,
        postingStatus: true,
        createdAt: true,
        // The mutually-exclusive provenance links (ADR-023 installment/IPC; ADR-029 R-4 separate
        // charge). Names, not ids, are what a reader recognises, so each carries the human reference
        // of its source document.
        sourceInstallmentId: true,
        sourceInstallment: { select: { id: true, name: true, sortOrder: true } },
        sourceIpcId: true,
        sourceIpc: {
          select: {
            id: true,
            application: { select: { id: true, applicationRef: true, applicationNumber: true } },
          },
        },
        // ADR-029 R-4 — the SEPARATE_CHARGE BOQ leaf a one-off invoice bills; its code/description is
        // the human reference the read model surfaces.
        sourceBoqNodeId: true,
        sourceBoqNode: { select: { id: true, code: true, description: true } },
        allocations: {
          where: { postingStatus: 'POSTED' },
          orderBy: { allocationDate: 'desc' },
          select: {
            id: true,
            allocatedAmount: true,
            allocationDate: true,
            paymentReceiptId: true,
          },
        },
        // Slice 5B: the first delivery timestamp enables the "sent 7+ days ago, not paid"
        // attention filter in the Collection tab. One row is enough — ascending order, take 1.
        deliveries: {
          orderBy: { sentAt: 'asc' as const },
          take: 1,
          select: { sentAt: true },
        },
      },
    });
  }

  /**
   * The receipts that have actually landed against this contract.
   *
   * A `PaymentReceipt` belongs to a client, not a project — only an allocation ties one to a
   * contract. So "this project's receipts" is exactly "receipts with a posted allocation against
   * an invoice of this contract", and saying that in the query is more honest than filtering by
   * client and hoping the money was for this job.
   */
  findReceiptsForContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.paymentReceipt.findMany({
      where: {
        organizationId,
        clientAllocations: {
          some: { postingStatus: 'POSTED', invoice: { contractId } },
        },
      },
      orderBy: { receiptDate: 'desc' },
      select: {
        id: true,
        receiptDate: true,
        currencyCode: true,
        totalAmount: true,
        allocatedAmount: true,
        unallocatedAmount: true,
        paymentMethod: true,
        reference: true,
        bankReference: true,
        receiptNumber: true,
        postingStatus: true,
        // Commercial redesign 2026-09-28 — the deposit account the payment landed in.
        bankAccount: { select: { bankName: true, accountNumber: true, currencyCode: true } },
        clientAllocations: {
          where: { postingStatus: 'POSTED' },
          orderBy: { allocationDate: 'desc' },
          select: {
            id: true,
            allocatedAmount: true,
            allocationDate: true,
            clientInvoiceId: true,
            invoice: { select: { id: true, invoiceNumber: true, contractId: true } },
          },
        },
      },
    });
  }

  /**
   * Unapplied cash sitting on this client's posted receipts.
   *
   * Client-scoped on purpose and reported as such: an unallocated receipt has not been
   * attributed to any contract, which is the whole reason it needs allocating. Scoping it to a
   * project would mean inventing an attribution the data does not carry.
   */
  async sumClientUnappliedReceipts(
    prisma: TenantPrisma,
    organizationId: string,
    clientId: string,
  ): Promise<Decimal> {
    const result = await prisma.paymentReceipt.aggregate({
      where: { organizationId, clientId, postingStatus: 'POSTED' },
      _sum: { unallocatedAmount: true },
    });
    return new Decimal(result._sum.unallocatedAmount?.toString() ?? 0);
  }

  /**
   * Slice 6B — set-based collection event lookup for a batch of invoices. One query per
   * collection type — never N+1. Returns a Map keyed by invoiceId.
   */
  async findInvoiceCollectionData(
    prisma: TenantPrisma,
    organizationId: string,
    invoiceIds: string[],
  ): Promise<CollectionDataByInvoice> {
    if (invoiceIds.length === 0) return new Map();

    const [followUpsRaw, promisesRaw, disputesRaw, creditNotesRaw, allocationsRaw] =
      await Promise.all([
        prisma.invoiceFollowUp.findMany({
          where: { organizationId, invoiceId: { in: invoiceIds } },
          orderBy: { occurredAt: 'desc' },
          select: {
            id: true,
            invoiceId: true,
            method: true,
            contactPerson: true,
            note: true,
            occurredAt: true,
            recordedAt: true,
            recordedBy: true,
          },
        }),
        prisma.invoicePaymentPromise.findMany({
          where: { organizationId, invoiceId: { in: invoiceIds } },
          orderBy: { recordedAt: 'desc' },
          select: {
            id: true,
            invoiceId: true,
            promisedDate: true,
            promisedAmount: true,
            outstandingAtPromise: true,
            note: true,
            recordedAt: true,
            recordedBy: true,
          },
        }),
        prisma.invoiceDispute.findMany({
          where: { organizationId, invoiceId: { in: invoiceIds } },
          orderBy: { openedAt: 'desc' },
          select: {
            id: true,
            invoiceId: true,
            disputedAmount: true,
            reason: true,
            note: true,
            openedAt: true,
            openedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            resolutionNote: true,
          },
        }),
        prisma.creditNote.findMany({
          where: { organizationId, invoiceId: { in: invoiceIds } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            invoiceId: true,
            creditNoteNumber: true,
            reason: true,
            netAmount: true,
            vatAmount: true,
            totalAmount: true,
            accountingDate: true,
            postingStatus: true,
            note: true,
            createdAt: true,
          },
        }),
        // Allocations for promise fulfillment derivation — all POSTED allocations on these invoices
        prisma.clientReceiptAllocation.findMany({
          where: {
            organizationId,
            clientInvoiceId: { in: invoiceIds },
            postingStatus: 'POSTED',
          },
          select: {
            clientInvoiceId: true,
            allocatedAmount: true,
            allocationDate: true,
          },
        }),
      ]);

    // Build the result map — one entry per invoiceId
    const result: CollectionDataByInvoice = new Map(
      invoiceIds.map((id) => [
        id,
        {
          followUps: [] as CollectionFollowUpRow[],
          promises: [] as CollectionPromiseRow[],
          openDispute: null as CollectionDisputeRow | null,
          disputes: [] as CollectionDisputeRow[],
          creditNotes: [] as CollectionCreditNoteRow[],
          allocationsForPromises: [] as CollectionAllocationRow[],
        },
      ]),
    );

    for (const r of followUpsRaw) {
      result.get(r.invoiceId)?.followUps.push({
        id: r.id,
        method: r.method,
        contactPerson: r.contactPerson,
        note: r.note,
        occurredAt: r.occurredAt,
        recordedAt: r.recordedAt,
        recordedBy: r.recordedBy,
      });
    }

    for (const r of promisesRaw) {
      result.get(r.invoiceId)?.promises.push({
        id: r.id,
        promisedDate: r.promisedDate,
        promisedAmount: r.promisedAmount,
        outstandingAtPromise: r.outstandingAtPromise,
        note: r.note,
        recordedAt: r.recordedAt,
        recordedBy: r.recordedBy,
      });
    }

    for (const r of disputesRaw) {
      const row: CollectionDisputeRow = {
        id: r.id,
        disputedAmount: r.disputedAmount,
        reason: r.reason,
        note: r.note,
        openedAt: r.openedAt,
        openedBy: r.openedBy,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy,
        resolutionNote: r.resolutionNote,
      };
      const entry = result.get(r.invoiceId);
      if (entry) {
        entry.disputes.push(row);
        if (!r.resolvedAt && !entry.openDispute) {
          entry.openDispute = row;
        }
      }
    }

    for (const r of creditNotesRaw) {
      result.get(r.invoiceId)?.creditNotes.push({
        id: r.id,
        creditNoteNumber: r.creditNoteNumber,
        reason: r.reason,
        netAmount: r.netAmount,
        vatAmount: r.vatAmount,
        totalAmount: r.totalAmount,
        accountingDate: r.accountingDate,
        postingStatus: r.postingStatus,
        note: r.note,
        createdAt: r.createdAt,
      });
    }

    for (const r of allocationsRaw) {
      result.get(r.clientInvoiceId)?.allocationsForPromises.push({
        allocatedAmount: r.allocatedAmount,
        allocationDate: r.allocationDate,
      });
    }

    return result;
  }

  /**
   * Slice 7 — Efficient project-scoped aggregation for the Commercial Overview read model.
   *
   * Returns all POSTED invoices for the project (with delivery count for ISSUED_NOT_SENT
   * derivation), the aggregated POSTED credit-note total, the aggregated POSTED allocation
   * total, and the per-invoice collection data. Four queries total — no N+1.
   *
   * Financial guarantee: outstandingAmount on each invoice is already reduced atomically
   * by postCreditNote() and receipt-allocation posting, so Σ outstandingAmount is the
   * canonical outstanding and satisfies netBilled − collected = outstanding.
   */
  async findProjectOverviewData(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<PostedReceivables & {
    collectionData: CollectionDataByInvoice;
    /** Live invoices not yet posted (draft or approved) — raised, but not billed yet. */
    draftInvoiceCount: number;
  }> {
    const draftInvoiceCount = await prisma.clientInvoice.count({
      where: {
        organizationId,
        projectId,
        documentStatus: { in: ['DRAFT', 'APPROVED'] },
        postingStatus: { in: ['NOT_POSTED', 'PENDING', 'FAILED'] },
      },
    });
    const receivables = (await this.findPostedReceivablesByProject(prisma, organizationId, [projectId])).get(
      projectId,
    ) ?? {
      invoices: [],
      postedCreditNotesSum: new Decimal(0),
      postedCreditNotesNetSum: new Decimal(0),
      collectedSum: new Decimal(0),
    };
    const invoiceIds = receivables.invoices.map((i) => i.id);
    const collectionData: CollectionDataByInvoice =
      invoiceIds.length === 0 ? new Map() : await this.findInvoiceCollectionData(prisma, organizationId, invoiceIds);

    return { ...receivables, collectionData, draftInvoiceCount };
  }

  /**
   * The posted receivables of several projects in four queries — the one definition behind the
   * Commercial Overview (one project) and the Finance portfolio (ADR-043, many projects).
   *
   * Per project: every POSTED invoice, the POSTED credit-note total against them and the POSTED
   * receipt-allocation total against them. A project with no posted invoice is absent from the map.
   */
  async findPostedReceivablesByProject(
    prisma: TenantPrisma,
    organizationId: string,
    projectIds: string[],
  ): Promise<Map<string, PostedReceivables>> {
    const result = new Map<string, PostedReceivables>();
    if (projectIds.length === 0) return result;

    const rawInvoices = await prisma.clientInvoice.findMany({
      where: { organizationId, projectId: { in: projectIds }, postingStatus: 'POSTED' },
      select: {
        id: true,
        projectId: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        subtotal: true,
        totalAmount: true,
        outstandingAmount: true,
        sourceInstallmentId: true,
        _count: { select: { deliveries: true } },
      },
    });
    if (rawInvoices.length === 0) return result;

    const projectOfInvoice = new Map<string, string>();
    for (const inv of rawInvoices) {
      if (!inv.projectId) continue;
      projectOfInvoice.set(inv.id, inv.projectId);
      const entry = result.get(inv.projectId) ?? {
        invoices: [],
        postedCreditNotesSum: new Decimal(0),
        postedCreditNotesNetSum: new Decimal(0),
        collectedSum: new Decimal(0),
      };
      entry.invoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        currencyCode: inv.currencyCode,
        subtotal: new Decimal(inv.subtotal.toString()),
        totalAmount: new Decimal(inv.totalAmount.toString()),
        outstandingAmount: new Decimal(inv.outstandingAmount.toString()),
        sourceInstallmentId: inv.sourceInstallmentId,
        deliveryCount: inv._count.deliveries,
      });
      result.set(inv.projectId, entry);
    }

    const invoiceIds = [...projectOfInvoice.keys()];
    const [creditNotes, allocations] = await Promise.all([
      prisma.creditNote.groupBy({
        by: ['invoiceId'],
        where: { organizationId, invoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { totalAmount: true, netAmount: true },
      }),
      prisma.clientReceiptAllocation.groupBy({
        by: ['clientInvoiceId'],
        where: { organizationId, clientInvoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { allocatedAmount: true },
      }),
    ]);
    for (const row of creditNotes) {
      const entry = result.get(projectOfInvoice.get(row.invoiceId) ?? '');
      if (!entry) continue;
      entry.postedCreditNotesSum = entry.postedCreditNotesSum.plus(row._sum.totalAmount?.toString() ?? 0);
      entry.postedCreditNotesNetSum = entry.postedCreditNotesNetSum.plus(row._sum.netAmount?.toString() ?? 0);
    }
    for (const row of allocations) {
      const entry = result.get(projectOfInvoice.get(row.clientInvoiceId) ?? '');
      if (entry) entry.collectedSum = entry.collectedSum.plus(row._sum.allocatedAmount?.toString() ?? 0);
    }
    return result;
  }

  /**
   * The live client contract of each project — the same rule as `findMainContract` (newest
   * CLIENT_CONTRACT that is not cancelled or terminated), for many projects in one query.
   */
  async findMainContractsByProject(prisma: TenantPrisma, organizationId: string, projectIds: string[]) {
    const contracts = await prisma.contract.findMany({
      where: mainContractWhere(organizationId, { in: projectIds }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        status: true,
        currency: true,
        contractValue: true,
        baseContractValue: true,
        paymentTerms: true,
        client: { select: { name: true } },
      },
    });
    const byProject = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) if (!byProject.has(c.projectId)) byProject.set(c.projectId, c);
    return byProject;
  }

  /**
   * Payment-schedule stages marked ready to bill on the given contracts, with the stage's invoice
   * (if any) so the caller can apply the live-invoice rule, and the facts
   * `installmentBillingBlocker` reads (trigger + linked milestone) plus the stage's label.
   */
  findReadyToBillInstallments(prisma: TenantPrisma, contractIds: string[]) {
    if (contractIds.length === 0) return Promise.resolve([]);
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId: { in: contractIds }, readyToBillAt: { not: null } },
      select: {
        id: true,
        contractId: true,
        name: true,
        percentage: true,
        triggerType: true,
        milestoneLabel: true,
        programmeMilestoneId: true,
        programmeMilestone: { select: { status: true, name: true, verifiedAt: true } },
        clientInvoice: { select: { id: true, documentStatus: true, postingStatus: true } },
      },
    });
  }

  /**
   * The stage ids of the given contracts in schedule order (`sortOrder`, as `findPaymentInstallments`
   * reads it), so a caller can name a stage by its 1-based position.
   */
  findInstallmentOrder(prisma: TenantPrisma, contractIds: string[]) {
    if (contractIds.length === 0) return Promise.resolve([]);
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, contractId: true },
    });
  }

  /**
   * Every POSTED client invoice still carrying a balance — the unpaid side of
   * `findPostedReceivablesByProject` (same posting filter), across the organisation or, given
   * `projectIds`, across those projects only. `null` = organisation-wide, including invoices not
   * tied to any project. Behind the Dashboard's receivables figures and overdue to-dos.
   */
  findOpenPostedInvoices(prisma: TenantPrisma, organizationId: string, projectIds: string[] | null) {
    if (projectIds !== null && projectIds.length === 0) return Promise.resolve([]);
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        postingStatus: 'POSTED',
        outstandingAmount: { gt: 0 },
        ...(projectIds !== null ? { projectId: { in: projectIds } } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        projectId: true,
        dueDate: true,
        currencyCode: true,
        totalAmount: true,
        outstandingAmount: true,
        client: { select: { name: true } },
      },
    });
  }

  /**
   * Every payment-schedule stage of the given contracts with what the cash-flow forecast (ADR-043
   * Phase 4) needs to date it — the schedule's own expected-date facts (`deriveExpectedDate`) and
   * the stage's invoice (for `deriveInvoiceState`).
   */
  findScheduleStagesForForecast(prisma: TenantPrisma, contractIds: string[]) {
    if (contractIds.length === 0) return Promise.resolve([]);
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: [{ contractId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        contractId: true,
        percentage: true,
        triggerType: true,
        dueDate: true,
        readyToBillAt: true,
        programmeMilestone: {
          select: { id: true, code: true, name: true, status: true, baselineDate: true, forecastDate: true },
        },
        clientInvoice: { select: { id: true, documentStatus: true, postingStatus: true } },
      },
    });
  }

  // ─── Commercial tab redesign (2026-09-28) ──────────────────────────────────────

  /** The project's code (the prefix a contract number is built from) and currency. Org-scoped. */
  findProjectHeader(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { code: true, currency: true },
    });
  }

  /** A contract's number, org-scoped (an invoice carries only the bare `contractId`). */
  /** A draft's dates, read inside the issue transaction. */
  findDraftDates(prisma: TenantPrisma, organizationId: string, invoiceId: string) {
    return prisma.clientInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { invoiceDate: true, dueDate: true },
    });
  }

  /** Re-date a draft at issue (still NOT_POSTED — a posted invoice's dates are frozen). */
  redateDraft(prisma: TenantPrisma, organizationId: string, invoiceId: string, invoiceDate: Date, dueDate: Date | null) {
    return prisma.clientInvoice.updateMany({
      where: { id: invoiceId, organizationId, postingStatus: 'NOT_POSTED' },
      data: { invoiceDate, dueDate },
    });
  }

  /** Same lookup `recordProjectPayment` guards on: a payment needs an ACTIVE contract on the project. */
  async hasActiveContract(prisma: TenantPrisma, organizationId: string, projectId: string): Promise<boolean> {
    const contract = await prisma.contract.findFirst({
      where: { organizationId, projectId, status: 'ACTIVE' },
      select: { id: true },
    });
    return contract !== null;
  }

  async findContractNumber(prisma: TenantPrisma, organizationId: string, contractId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: { contractNumber: true },
    });
    return contract?.contractNumber ?? null;
  }

  /**
   * The live BOQ version recording a contract will snapshot — the same pointer `recordSigned` reads
   * (`currentVersionId ?? currentDraftVersionId`), with its number.
   */
  async findLiveBoqVersion(prisma: TenantPrisma, organizationId: string, projectId: string) {
    const boq = await prisma.boq.findFirst({
      where: { projectId, organizationId },
      select: { currentVersionId: true, currentDraftVersionId: true },
    });
    const versionId = boq?.currentVersionId ?? boq?.currentDraftVersionId ?? null;
    if (!versionId) return null;
    const version = await prisma.boqVersion.findUnique({
      where: { id: versionId },
      select: { id: true, versionNumber: true },
    });
    return version ? { versionId: version.id, versionNumber: version.versionNumber } : null;
  }

  /** The most recently attached evidence file on the contract — the signed agreement, if uploaded. */
  async findSignedAgreement(prisma: TenantPrisma, contractId: string) {
    const attachment = await prisma.contractAttachment.findFirst({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
      select: { platformFile: { select: { id: true, originalName: true } } },
    });
    return attachment
      ? { fileId: attachment.platformFile.id, fileName: attachment.platformFile.originalName }
      : null;
  }

  /**
   * One project invoice with what the issue / delete commands decide on: its states, its source tags,
   * and the stage it rides with when it is a variation invoice (via its INVOICE allocation). Scoped by
   * org AND project — an invoice id from another project is "not found".
   */
  findInvoiceHeader(prisma: TenantPrisma, organizationId: string, projectId: string, invoiceId: string) {
    return prisma.clientInvoice.findFirst({
      where: { id: invoiceId, organizationId, projectId },
      select: {
        id: true,
        invoiceNumber: true,
        contractId: true,
        documentStatus: true,
        postingStatus: true,
        sourceInstallmentId: true,
        sourceBoqNodeId: true,
        sourceIpcId: true,
        variationBillingAllocations: {
          where: { treatment: 'INVOICE' },
          select: { installmentId: true },
        },
      },
    });
  }

  /**
   * Every invoice of one stage's billing package: the stage invoice (sourceInstallmentId) plus each
   * variation invoice billed with it (INVOICE allocation on the stage). Omission rows point at the
   * stage invoice itself, so they add nothing.
   */
  async findPackageInvoices(prisma: TenantPrisma, organizationId: string, installmentId: string) {
    const select = { id: true, documentStatus: true, postingStatus: true, invoiceNumber: true } as const;
    const [stage, allocations] = await Promise.all([
      prisma.clientInvoice.findFirst({
        where: { organizationId, sourceInstallmentId: installmentId },
        select,
      }),
      prisma.variationBillingAllocation.findMany({
        where: { organizationId, installmentId, treatment: 'INVOICE', clientInvoiceId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { clientInvoice: { select } },
      }),
    ]);
    const vos = allocations.flatMap((a) => (a.clientInvoice ? [a.clientInvoice] : []));
    return { stage, vos };
  }

  /** Set the free-text notes on freshly-created drafts (prepare-package). */
  setDraftNotes(prisma: TenantPrisma, organizationId: string, invoiceIds: string[], notes: string) {
    return prisma.clientInvoice.updateMany({
      where: { organizationId, id: { in: invoiceIds }, postingStatus: 'NOT_POSTED' },
      data: { notes },
    });
  }

  /**
   * Cancel unposted drafts. The unique source tags (`sourceInstallmentId`, `sourceBoqNodeId`) are
   * released so the stage / separate charge can be prepared again (one live invoice per source); the
   * cancelled row keeps its `billingAddressSnapshot.description` and the audit event records the
   * original source. Guarded on unposted in the WHERE — a posted invoice is never cancelled here.
   * Returns the number of rows cancelled.
   */
  async cancelDraftInvoices(
    prisma: TenantPrisma,
    organizationId: string,
    invoiceIds: string[],
    cancelledBy: string,
    reason: string,
  ): Promise<number> {
    const result = await prisma.clientInvoice.updateMany({
      where: {
        organizationId,
        id: { in: invoiceIds },
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
        documentStatus: { not: 'CANCELLED' },
      },
      data: {
        documentStatus: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason: reason,
        sourceInstallmentId: null,
        sourceBoqNodeId: null,
      },
    });
    return result.count;
  }

  /** The organisation's current invoice branding (drafts render with it). */
  findOrgBranding(prisma: TenantPrisma, organizationId: string) {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        logoFileId: true,
        legalAddress: true,
        taxRegistrationNumber: true,
        invoiceFooterNote: true,
      },
    });
  }

  /** One invoice as a document: header, amounts, snapshot, source, deliveries, and its VO lines. */
  findInvoiceDocument(prisma: TenantPrisma, organizationId: string, projectId: string, invoiceId: string) {
    return prisma.clientInvoice.findFirst({
      where: { id: invoiceId, organizationId, projectId },
      select: {
        id: true,
        projectId: true,
        contractId: true,
        clientId: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        subtotal: true,
        vatAmount: true,
        taxRate: true,
        totalAmount: true,
        outstandingAmount: true,
        documentStatus: true,
        postingStatus: true,
        postedJournalEntryId: true,
        billingAddressSnapshot: true,
        createdAt: true,
        createdBy: true,
        sourceInstallmentId: true,
        sourceInstallment: { select: { id: true, name: true, sortOrder: true, percentage: true } },
        sourceIpcId: true,
        sourceIpc: {
          select: {
            id: true,
            application: { select: { id: true, applicationRef: true, applicationNumber: true } },
          },
        },
        sourceBoqNodeId: true,
        sourceBoqNode: { select: { id: true, code: true, description: true } },
        client: { select: { name: true, address: true } },
        deliveries: {
          orderBy: { sentAt: 'asc' },
          select: { id: true, method: true, recipient: true, note: true, sentAt: true, sentBy: true },
        },
        variationBillingAllocations: {
          orderBy: { createdAt: 'asc' },
          select: {
            amount: true,
            treatment: true,
            variation: { select: { reference: true, title: true } },
          },
        },
      },
    });
  }

  /** Display name for a user id, or null. */
  async findUserName(prisma: TenantPrisma, organizationId: string, userId: string): Promise<string | null> {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { firstName: true, lastName: true },
    });
    return user ? `${user.firstName} ${user.lastName}`.trim() || null : null;
  }

  /**
   * The client statement's source rows for one contract: its posted invoices, the posted credit notes
   * against them, and the posted receipt allocations against them.
   */
  async findStatementData(prisma: TenantPrisma, organizationId: string, contractId: string) {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId, contractId, postingStatus: 'POSTED' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        billingAddressSnapshot: true,
      },
    });
    const ids = invoices.map((i) => i.id);
    if (ids.length === 0) return { invoices, creditNotes: [], allocations: [] };
    const [creditNotes, allocations] = await Promise.all([
      prisma.creditNote.findMany({
        where: { organizationId, invoiceId: { in: ids }, postingStatus: 'POSTED' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          invoiceId: true,
          creditNoteNumber: true,
          accountingDate: true,
          totalAmount: true,
          reason: true,
        },
      }),
      prisma.clientReceiptAllocation.findMany({
        where: { organizationId, clientInvoiceId: { in: ids }, postingStatus: 'POSTED' },
        orderBy: { allocationDate: 'asc' },
        select: {
          id: true,
          clientInvoiceId: true,
          allocatedAmount: true,
          allocationDate: true,
          receipt: { select: { receiptNumber: true, reference: true, bankReference: true } },
        },
      }),
    ]);
    return { invoices, creditNotes, allocations };
  }

  /**
   * Recent commercial audit activity. Child mutations are audited by child id (CONST-COM-005),
   * so the caller passes the full set of relevant resource ids (contract + guarantees +
   * advance terms + deliverables + certificates) gathered from the already-loaded aggregate.
   */
  async findRecentActivity(prisma: TenantPrisma, organizationId: string, resourceIds: string[]) {
    if (resourceIds.length === 0) return [];
    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        resource: {
          in: [
            'Contract',
            'ContractGuarantee',
            'ContractAdvanceTerm',
            'ContractRetentionTerms',
            'ContractDeliverable',
            // Historical events audited before the ContractMilestone → ContractDeliverable rename
            // (P0) keep the old resource type. Include both so the activity feed still surfaces them.
            'ContractMilestone',
            'InterimPaymentCertificate',
            // The settlement half of the story. Without these the feed reports certification
            // and contract terms and then falls silent exactly where a commercial manager is
            // watching — an invoice posting, a receipt landing against it.
            'InterimPaymentApplication',
            'ClientInvoice',
            'PaymentReceipt',
            'ClientReceiptAllocation',
          ],
        },
        resourceId: { in: resourceIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        sourceCommand: true,
        createdAt: true,
        resourceId: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
