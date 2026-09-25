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
      where: {
        organizationId,
        projectId,
        contractKind: 'CLIENT_CONTRACT',
        status: { notIn: ['CANCELLED', 'TERMINATED'] as never[] },
      },
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
          },
        },
      },
    });
  }

  // Slice 3B — readiness persistence helpers. These accept a transaction client so the caller
  // can include them in a broader $transaction alongside the audit outbox write.
  markInstallmentReadyToBill(
    tx: TenantPrisma,
    organizationId: string,
    installmentId: string,
    userId: string,
    note?: string,
  ) {
    return tx.contractPaymentInstallment.update({
      where: { id: installmentId, contract: { organizationId } },
      data: { readyToBillAt: new Date(), readyToBillBy: userId, readinessNote: note ?? null },
      select: { id: true, readyToBillAt: true },
    });
  }

  revokeInstallmentReadiness(tx: TenantPrisma, organizationId: string, installmentId: string) {
    return tx.contractPaymentInstallment.update({
      where: { id: installmentId, contract: { organizationId } },
      data: { readyToBillAt: null, readyToBillBy: null, readinessNote: null },
      select: { id: true },
    });
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
          select: { id: true, code: true, name: true, status: true },
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
        postingStatus: true,
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
  ): Promise<{
    invoices: {
      id: string;
      invoiceNumber: string | null;
      invoiceDate: Date;
      dueDate: Date | null;
      totalAmount: Decimal;
      outstandingAmount: Decimal;
      sourceInstallmentId: string | null;
      deliveryCount: number;
    }[];
    postedCreditNotesSum: Decimal;
    collectedSum: Decimal;
    collectionData: CollectionDataByInvoice;
  }> {
    const rawInvoices = await prisma.clientInvoice.findMany({
      where: { organizationId, projectId, postingStatus: 'POSTED' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        outstandingAmount: true,
        sourceInstallmentId: true,
        _count: { select: { deliveries: true } },
      },
    });

    const invoices = rawInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      totalAmount: new Decimal(inv.totalAmount.toString()),
      outstandingAmount: new Decimal(inv.outstandingAmount.toString()),
      sourceInstallmentId: inv.sourceInstallmentId,
      deliveryCount: inv._count.deliveries,
    }));

    const invoiceIds = invoices.map((i) => i.id);

    if (invoiceIds.length === 0) {
      return {
        invoices,
        postedCreditNotesSum: new Decimal(0),
        collectedSum: new Decimal(0),
        collectionData: new Map(),
      };
    }

    const [cnAggregate, allocationAggregate, collectionData] = await Promise.all([
      prisma.creditNote.aggregate({
        where: { organizationId, invoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { totalAmount: true },
      }),
      prisma.clientReceiptAllocation.aggregate({
        where: { organizationId, clientInvoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { allocatedAmount: true },
      }),
      this.findInvoiceCollectionData(prisma, organizationId, invoiceIds),
    ]);

    return {
      invoices,
      postedCreditNotesSum: new Decimal(cnAggregate._sum.totalAmount?.toString() ?? 0),
      collectedSum: new Decimal(allocationAggregate._sum.allocatedAmount?.toString() ?? 0),
      collectionData,
    };
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
