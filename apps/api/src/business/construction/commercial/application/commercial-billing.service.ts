import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type BillingPackageDocumentSource,
  type ClientInvoiceDocStatus,
  type ArPostingStatus,
  type CommercialBillStageResult,
  type CommercialBillingPackage,
  type CommercialBillingPackageDocument,
  type CommercialBillingPackageInvoice,
  type CommercialBillingPackageLine,
  type CommercialBillingPackagesResponse,
  type CommercialDeliveryRecord,
  type DepositAccountOption,
  type InvoiceDeliveryMethod,
  type InstallmentReadinessResult,
  type RecordProjectPaymentAllocationResult,
  type RecordProjectPaymentResult,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../../variations/application/variation-order.service.js';
import { netPrice as computeNetPrice } from '../../variations/domain/variation-order.policy.js';
import { VariationBillingAllocationPolicy } from '../../variations/domain/variation-billing-allocation.policy.js';
import { ClientInvoiceService } from '../../../accounting/accounts-receivable/application/client-invoice.service.js';
import { CustomerReceiptService } from '../../../accounting/accounts-receivable/application/customer-receipt.service.js';

const ZERO = new Decimal(0);

/** The shape of a ClientInvoice the read model surfaces (selected in the AR/commercial repos). */
interface InvoiceLike {
  id: string;
  invoiceNumber: string | null;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  outstandingAmount: Decimal;
  dueDate?: Date | null;
  documentStatus: string;
  postingStatus: string;
  deliveries?: Array<{
    id: string;
    method: string;
    recipient: string | null;
    note: string | null;
    sentAt: Date;
    sentBy: string;
  }>;
}

export interface RecordProjectPaymentInput {
  bankAccountId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  /** Exact allocations confirmed by the user — never recomputed server-side. */
  allocations: Array<{ clientInvoiceId: string; amount: number }>;
  /** Optional client-generated key — if a receipt with this key already exists, return it
   *  instead of creating a duplicate (safe network-retry protection). */
  idempotencyKey?: string;
}

export interface BillStageInput {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
  /** Positive selection: only these CLIENT_APPROVED variation IDs are included. */
  selectedVariationIds: string[];
}

/**
 * ADR-030 CONST-COM-028 / S-VB-5..9 (Commercial redesign P1) — the "bill this stage" orchestrator and
 * the Billing-Package read model.
 *
 * This is Commercial's ONE thin variation-billing WRITE path; the rest of Commercial stays read-only.
 * Orchestration crosses construction → accounting, allowed by ARCH-BOUNDARY-001 (Accounting never
 * imports Variations — the ordering/authorization lives here). It composes existing capabilities:
 *   - the milestone invoice via {@link ClientInvoiceService.generateFromInstallment} (with an omission
 *     `subtotalAdjustment` when this un-invoiced stage nets included omissions);
 *   - one standalone invoice per included ADDITION via
 *     {@link ClientInvoiceService.generateStandaloneCharge};
 *   - the exactly-once billing ledger via {@link VariationOrderService.allocateVariationBilling}.
 * All of it runs inside a single transaction so the package commits or rolls back as a whole, with one
 * package-level audit event. Entitlement (contract value / %-schedule) is never touched — realization
 * is a separate layer (CONST-COM-027).
 */
@Injectable()
export class CommercialBillingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: CommercialPrismaRepository,
    private readonly variationRepo: VariationOrderPrismaRepository,
    private readonly variationService: VariationOrderService,
    private readonly clientInvoiceService: ClientInvoiceService,
    private readonly customerReceiptService: CustomerReceiptService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  // ─── S-VB-5..9 — Prepare this stage (creates DRAFT invoices) ────────────────────

  async billStage(
    identity: RequestIdentity,
    dto: BillStageInput,
  ): Promise<CommercialBillStageResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // 1. Load the installment + contract, org-scoped through contract.organizationId.
    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, dto.installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${dto.installmentId} not found`);
    }
    const contract = installment.contract;
    // Tenancy + membership: the contract must be reachable by this member.
    await this.projectAccess.assertContract(identity, contract.id);

    // Slice 3B — commercial readiness gate. Commercial must explicitly mark the installment ready
    // before billing can proceed, regardless of the programme milestone status.
    if (!installment.readyToBillAt) {
      throw new BadRequestException(
        `Installment "${installment.name}" has not been marked ready to bill.`,
      );
    }

    // 2. Resolve the eligible (CLIENT_APPROVED) variations and their remaining headroom.
    // Positive selection: only the explicitly listed variation IDs are considered.
    const vos = await this.variationRepo.findByContract(prisma, orgId, contract.id);
    const selectedSet = new Set(dto.selectedVariationIds);

    interface Eligible {
      id: string;
      reference: string;
      title: string;
      remaining: Decimal;
    }
    const additions: Eligible[] = [];
    const omissions: Eligible[] = [];
    for (const vo of vos) {
      if (vo.status !== 'CLIENT_APPROVED') continue;
      if (!selectedSet.has(vo.id)) continue; // deferred (or not named) → no-op
      const net = computeNetPrice(vo.lines.map((l) => ({ amount: l.amount as Decimal })));
      const existing = await this.variationRepo.findAllocationsByVariation(prisma, orgId, vo.id);
      const remaining = VariationBillingAllocationPolicy.remainingUnallocated(net, existing);
      if (remaining.isZero()) continue; // already fully realized → idempotent skip
      const e: Eligible = { id: vo.id, reference: vo.reference, title: vo.title, remaining };
      if (remaining.greaterThan(ZERO)) additions.push(e);
      else omissions.push(e);
    }

    // 4a. Milestone-invoice handling — S-VB-9: an already-invoiced stage cannot absorb an omission.
    const alreadyInvoiced = installment.clientInvoice !== null;
    if (alreadyInvoiced && omissions.length > 0) {
      throw new BadRequestException(
        `Milestone "${installment.name}" is already invoiced — an omission cannot be netted into it; ` +
          'a credit note is required (not yet available).',
      );
    }

    // The signed Σ of included omissions (≤ 0), applied to the fresh milestone invoice's subtotal.
    const omissionAdjustment = omissions.reduce((sum, o) => sum.plus(o.remaining), ZERO);

    // 7. One transaction for the whole package.
    const result = await prisma.$transaction(async (tx) => {
      // 4b. The milestone invoice: reuse an existing one, else create it (with the omission adjustment).
      const milestoneInvoice: InvoiceLike = alreadyInvoiced
        ? (installment.clientInvoice as InvoiceLike)
        : await this.clientInvoiceService.generateFromInstallment(
            identity,
            {
              installmentId: dto.installmentId,
              invoiceDate: dto.invoiceDate,
              dueDate: dto.dueDate,
              paymentTerms: dto.paymentTerms,
              subtotalAdjustment: omissionAdjustment.toFixed(2),
            },
            tx,
          );

      // 5. Each included OMISSION records a STAGE_REDUCTION against the (freshly-created) milestone
      // invoice. (alreadyInvoiced + omissions was rejected above, so this only runs on the fresh path.)
      for (const omission of omissions) {
        await this.variationService.allocateVariationBilling(
          identity,
          omission.id,
          {
            amount: omission.remaining, // negative
            treatment: 'STAGE_REDUCTION',
            clientInvoiceId: milestoneInvoice.id,
            installmentId: dto.installmentId,
          },
          tx,
        );
      }

      // 6. Each included ADDITION gets its own standalone invoice + an INVOICE allocation. Idempotent:
      // if an INVOICE allocation already links this (voId, installmentId), reuse its invoice (skip).
      const voInvoiceIds: string[] = [];
      for (const addition of additions) {
        // Exactly-once across re-runs (S-VB-6): if this variation was already billed on THIS
        // installment via an INVOICE allocation, reuse that invoice rather than raising a second one.
        const priorInvoiceId = await this.findExistingInvoiceAllocation(
          tx,
          orgId,
          addition.id,
          dto.installmentId,
        );
        if (priorInvoiceId) {
          voInvoiceIds.push(priorInvoiceId);
          continue;
        }

        const voInvoice = await this.clientInvoiceService.generateStandaloneCharge(
          identity,
          {
            clientId: contract.clientId,
            projectId: contract.projectId,
            contractId: contract.id,
            currencyCode: contract.currency,
            subtotal: addition.remaining.toFixed(2),
            label: `${addition.reference} — ${addition.title}`,
            invoiceDate: dto.invoiceDate,
            dueDate: dto.dueDate,
            paymentTerms: dto.paymentTerms,
          },
          tx,
        );
        await this.variationService.allocateVariationBilling(
          identity,
          addition.id,
          {
            amount: addition.remaining, // positive
            treatment: 'INVOICE',
            clientInvoiceId: voInvoice.id,
            installmentId: dto.installmentId,
          },
          tx,
        );
        voInvoiceIds.push(voInvoice.id);
      }

      // A stable discriminator so a re-run that legitimately raised a new invoice gets a new key,
      // while a fully-idempotent re-run (no new invoices) reuses the same key.
      const newInvoiceCount =
        (alreadyInvoiced ? 0 : 1) + additions.length; // upper bound on documents raised this call
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Contract',
        resourceId: contract.id,
        sourceCommand: 'commercial.billStage',
        eventType: 'COMMERCIAL_STAGE_BILLED',
        idempotencyKey: `bill-stage-${dto.installmentId}-${newInvoiceCount}-${milestoneInvoice.id}`,
        after: {
          installmentId: dto.installmentId,
          milestoneInvoiceId: milestoneInvoice.id,
          voInvoiceIds,
        },
      });

      return { milestoneInvoiceId: milestoneInvoice.id };
    });

    void result;
    // 8. Return the freshly-composed Billing Package for this installment.
    const packages = await this.getBillingPackages(identity, contract.id);
    const pkg = packages.packages.find((p) => p.installmentId === dto.installmentId);
    if (!pkg) {
      // Defensive: the installment we just billed must have a package.
      throw new NotFoundException(
        `Billing package for installment ${dto.installmentId} could not be assembled.`,
      );
    }
    return pkg;
  }

  // ─── S-VB-7 — Billing Package read model ────────────────────────────────────────

  /**
   * Group a contract's billing by installment: the milestone invoice plus each variation line
   * (INVOICE additions carry their own invoice; STAGE_REDUCTION omissions live on the milestone
   * invoice and are NOT counted again in `presentedTotal`). Money is nulled without
   * `financialPositionView`. Ordered by installment sort order.
   *
   * Slice 4B: also populates `documents[]` (flat list of all invoice documents) and package-level
   * aggregates (packageSubtotal, packageTax, packageTotal, packageOutstanding).
   */
  async getBillingPackages(
    identity: RequestIdentity,
    contractId: string,
  ): Promise<CommercialBillingPackagesResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const canViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);

    const [installments, allocations] = await Promise.all([
      this.repo.findInstallmentsWithInvoiceForContract(prisma, orgId, contractId),
      this.repo.findVariationAllocationsForContract(prisma, orgId, contractId),
    ]);

    // Group allocations by installment (allocations with a null installmentId are pre-C5 / unlinked
    // and cannot be placed in a stage package — they are excluded from this grouping by construction).
    const allocsByInstallment = new Map<string, typeof allocations>();
    for (const a of allocations) {
      if (!a.installmentId) continue;
      const list = allocsByInstallment.get(a.installmentId) ?? [];
      list.push(a);
      allocsByInstallment.set(a.installmentId, list);
    }

    const money = (d: Decimal | null): string | null =>
      !canViewFinancials || d === null ? null : d.toFixed(2);

    const toDeliveries = (inv: InvoiceLike): CommercialDeliveryRecord[] =>
      (inv.deliveries ?? []).map((d): CommercialDeliveryRecord => ({
        id: d.id,
        method: d.method as InvoiceDeliveryMethod,
        recipient: d.recipient,
        note: d.note,
        sentAt: d.sentAt.toISOString(),
        sentBy: d.sentBy,
      }));

    const toInvoice = (inv: InvoiceLike | null): CommercialBillingPackageInvoice | null =>
      inv === null
        ? null
        : {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            subtotal: money(new Decimal(inv.subtotal.toString())),
            totalAmount: money(new Decimal(inv.totalAmount.toString())),
            dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
            documentStatus: inv.documentStatus as ClientInvoiceDocStatus,
            postingStatus: inv.postingStatus as ArPostingStatus,
            deliveries: toDeliveries(inv),
          };

    const toDocument = (
      inv: InvoiceLike,
      sourceType: BillingPackageDocumentSource,
      sourceReference: string,
    ): CommercialBillingPackageDocument => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      sourceType,
      sourceReference,
      subtotal: money(new Decimal(inv.subtotal.toString())),
      salesTax: money(new Decimal(inv.vatAmount.toString())),
      total: money(new Decimal(inv.totalAmount.toString())),
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      outstanding: money(new Decimal(inv.outstandingAmount.toString())),
      deliveries: toDeliveries(inv),
    });

    const packages: CommercialBillingPackage[] = [];
    for (const inst of installments) {
      const instAllocs = allocsByInstallment.get(inst.id) ?? [];
      const hasMilestoneInvoice = inst.clientInvoice !== null;
      // S-VB-7: only installments that have a milestone invoice OR ≥1 VO allocation appear.
      if (!hasMilestoneInvoice && instAllocs.length === 0) continue;

      const milestoneInvoice = toInvoice((inst.clientInvoice as InvoiceLike | null) ?? null);

      const variationLines: CommercialBillingPackageLine[] = instAllocs.map((a) => ({
        variationId: a.variationId,
        reference: a.variation.reference,
        title: a.variation.title,
        allocationAmount: money(new Decimal(a.amount.toString())),
        treatment: a.treatment,
        // An INVOICE addition carries its own invoice; a STAGE_REDUCTION's clientInvoiceId IS the
        // milestone invoice (the reduction lives there), so its line reports no separate invoice.
        invoice:
          a.treatment === 'INVOICE' ? toInvoice((a.clientInvoice as InvoiceLike | null) ?? null) : null,
      }));

      // presentedTotal = milestone total + Σ addition-VO invoice totals. Omissions already reduced the
      // milestone subtotal, so they are never added again. Null when money is withheld.
      let presentedTotal: string | null = null;
      if (canViewFinancials) {
        let sum = inst.clientInvoice
          ? new Decimal(inst.clientInvoice.totalAmount.toString())
          : ZERO;
        for (const a of instAllocs) {
          if (a.treatment === 'INVOICE' && a.clientInvoice) {
            sum = sum.plus(new Decimal(a.clientInvoice.totalAmount.toString()));
          }
        }
        presentedTotal = sum.toFixed(2);
      }

      // Slice 4B — flat documents[] list: MILESTONE first, then VARIATION invoices.
      const documents: CommercialBillingPackageDocument[] = [];
      if (inst.clientInvoice) {
        documents.push(
          toDocument(inst.clientInvoice as InvoiceLike, 'MILESTONE', inst.name),
        );
      }
      for (const a of instAllocs) {
        if (a.treatment === 'INVOICE' && a.clientInvoice) {
          documents.push(
            toDocument(
              a.clientInvoice as InvoiceLike,
              'VARIATION',
              `${a.variation.reference} — ${a.variation.title}`,
            ),
          );
        }
      }

      // Package-level aggregates: sum across all documents (derived convenience, NOT a separate AR balance).
      let pkgSubtotal: string | null = null;
      let pkgTax: string | null = null;
      let pkgTotal: string | null = null;
      let pkgOutstanding: string | null = null;
      if (canViewFinancials) {
        let sumSubtotal = ZERO;
        let sumTax = ZERO;
        let sumTotal = ZERO;
        let sumOutstanding = ZERO;
        if (inst.clientInvoice) {
          const inv = inst.clientInvoice as InvoiceLike;
          sumSubtotal = sumSubtotal.plus(new Decimal(inv.subtotal.toString()));
          sumTax = sumTax.plus(new Decimal(inv.vatAmount.toString()));
          sumTotal = sumTotal.plus(new Decimal(inv.totalAmount.toString()));
          sumOutstanding = sumOutstanding.plus(new Decimal(inv.outstandingAmount.toString()));
        }
        for (const a of instAllocs) {
          if (a.treatment === 'INVOICE' && a.clientInvoice) {
            const inv = a.clientInvoice as InvoiceLike;
            sumSubtotal = sumSubtotal.plus(new Decimal(inv.subtotal.toString()));
            sumTax = sumTax.plus(new Decimal(inv.vatAmount.toString()));
            sumTotal = sumTotal.plus(new Decimal(inv.totalAmount.toString()));
            sumOutstanding = sumOutstanding.plus(new Decimal(inv.outstandingAmount.toString()));
          }
        }
        pkgSubtotal = sumSubtotal.toFixed(2);
        pkgTax = sumTax.toFixed(2);
        pkgTotal = sumTotal.toFixed(2);
        pkgOutstanding = sumOutstanding.toFixed(2);
      }

      packages.push({
        installmentId: inst.id,
        installmentName: inst.name,
        milestoneInvoice,
        variationLines,
        presentedTotal,
        documents,
        packageSubtotal: pkgSubtotal,
        packageTax: pkgTax,
        packageTotal: pkgTotal,
        packageOutstanding: pkgOutstanding,
      });
    }

    return { contractId, financialsVisible: canViewFinancials, packages };
  }

  // ─── Slice 3B — Commercial readiness commands ────────────────────────────────────

  /**
   * Mark a payment installment as commercially ready to bill.
   *
   * Guards (in priority order):
   *   1. Installment must exist in this org.
   *   2. Caller must have contract access (project membership gate).
   *   3. Contract must be ACTIVE.
   *   4. No invoice must already exist for this installment.
   *   5. If linked to a programme milestone, that milestone must be VERIFIED.
   *   6. Idempotent: already-ready → no-op, no duplicate audit.
   *
   * Does NOT generate an invoice, allocate variations, or change contract value.
   */
  async markReadyToBill(
    identity: RequestIdentity,
    installmentId: string,
    note?: string,
  ): Promise<InstallmentReadinessResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    if (installment.contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Contract ${installment.contract.contractNumber} must be ACTIVE to mark an installment ready to bill ` +
          `(currently ${installment.contract.status}).`,
      );
    }
    if (installment.clientInvoice !== null) {
      throw new BadRequestException(
        `Installment "${installment.name}" already has an invoice — readiness cannot be set after billing.`,
      );
    }
    if (
      installment.programmeMilestoneId &&
      installment.programmeMilestone?.status !== 'VERIFIED'
    ) {
      throw new BadRequestException(
        `The linked programme milestone is not yet verified; "${installment.name}" cannot be marked ready to bill.`,
      );
    }

    // Idempotent: already-ready is a no-op (no error, no duplicate audit event).
    if (installment.readyToBillAt !== null) {
      return {
        installmentId,
        readyToBill: true,
        readyToBillAt: installment.readyToBillAt.toISOString(),
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await this.repo.markInstallmentReadyToBill(
        tx as unknown as Parameters<typeof this.repo.markInstallmentReadyToBill>[0],
        orgId,
        installmentId,
        identity.userId,
        note,
      );
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractPaymentInstallment',
        resourceId: installmentId,
        sourceCommand: 'commercial.markReadyToBill',
        eventType: 'MILESTONE_READY_TO_BILL',
        idempotencyKey: `ready-to-bill-${installmentId}`,
        after: { readyToBillBy: identity.userId, note: note ?? null },
      });
      return result;
    });

    return {
      installmentId,
      readyToBill: true,
      readyToBillAt: updated.readyToBillAt!.toISOString(),
    };
  }

  /**
   * Revoke ready-to-bill status before an invoice is created.
   *
   * Guards:
   *   1. Installment must exist.
   *   2. Caller must have contract access.
   *   3. Must be currently marked ready (nothing to revoke otherwise).
   *   4. No invoice may exist (once billed, readiness is history — use the audit log).
   */
  async revokeReadyToBill(
    identity: RequestIdentity,
    installmentId: string,
    reason?: string,
  ): Promise<InstallmentReadinessResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    if (installment.readyToBillAt === null) {
      throw new BadRequestException(
        `Installment "${installment.name}" is not marked ready to bill — nothing to revoke.`,
      );
    }
    if (installment.clientInvoice !== null) {
      throw new BadRequestException(
        `Installment "${installment.name}" has an invoice — readiness cannot be revoked after billing.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.revokeInstallmentReadiness(
        tx as unknown as Parameters<typeof this.repo.revokeInstallmentReadiness>[0],
        orgId,
        installmentId,
      );
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractPaymentInstallment',
        resourceId: installmentId,
        sourceCommand: 'commercial.revokeReadyToBill',
        eventType: 'MILESTONE_READINESS_REVOKED',
        idempotencyKey: `revoke-readiness-${installmentId}-${installment.readyToBillAt!.getTime()}`,
        after: { reason: reason ?? null },
      });
    });

    return { installmentId, readyToBill: false, readyToBillAt: null };
  }

  // ─── Slice 4B — Issue billing package + record delivery ─────────────────────────

  /**
   * Issue the billing package for a milestone installment in one atomic transaction.
   *
   * This is the "Issue billing package" business operation — NOT an invoice-centric command. It:
   *   1. Guards: installment must be READY TO BILL (readyToBillAt set).
   *   2. Idempotency: if the milestone invoice is already POSTED, return the existing package.
   *   3. Resolves VOs from `selectedVariationIds` (positive selection — only what the user reviewed).
   *   4. In one $transaction: create milestone DRAFT + VO DRAFTs → approve each → post each.
   *      All documents get independent sequential INV-xxx numbers assigned inside the same tx.
   *   5. Returns the fully-assembled Billing Package read model.
   */
  async issuePackage(
    identity: RequestIdentity,
    installmentId: string,
    dto: {
      invoiceDate: string;
      dueDate: string;
      paymentTerms?: string;
      notes?: string;
      selectedVariationIds: string[];
    },
  ): Promise<CommercialBillingPackage> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    if (!installment.readyToBillAt) {
      throw new BadRequestException(
        `Installment "${installment.name}" has not been marked ready to bill.`,
      );
    }

    const contract = installment.contract;

    // Idempotency: milestone invoice already POSTED → package is complete, nothing to do.
    if (
      installment.clientInvoice !== null &&
      installment.clientInvoice.postingStatus === 'POSTED'
    ) {
      const packages = await this.getBillingPackages(identity, contract.id);
      const pkg = packages.packages.find((p) => p.installmentId === installmentId);
      if (pkg) return pkg;
    }

    // Validate selectedVariationIds — reject unknown/ineligible VOs upfront.
    const allVos = await this.variationRepo.findByContract(prisma, orgId, contract.id);
    const eligibleById = new Map(
      allVos.filter((v) => v.status === 'CLIENT_APPROVED').map((v) => [v.id, v]),
    );
    for (const id of dto.selectedVariationIds) {
      if (!eligibleById.has(id)) {
        throw new BadRequestException(
          `Variation ${id} is not a CLIENT_APPROVED variation on this contract.`,
        );
      }
    }
    const selectedSet = new Set(dto.selectedVariationIds);

    interface Eligible {
      id: string;
      reference: string;
      title: string;
      remaining: Decimal;
    }
    const additions: Eligible[] = [];
    const omissions: Eligible[] = [];
    for (const [id, vo] of eligibleById) {
      if (!selectedSet.has(id)) continue;
      const net = computeNetPrice(vo.lines.map((l) => ({ amount: l.amount as Decimal })));
      const existing = await this.variationRepo.findAllocationsByVariation(prisma, orgId, vo.id);
      const remaining = VariationBillingAllocationPolicy.remainingUnallocated(net, existing);
      if (remaining.isZero()) continue;
      const e: Eligible = { id: vo.id, reference: vo.reference, title: vo.title, remaining };
      if (remaining.greaterThan(ZERO)) additions.push(e);
      else omissions.push(e);
    }

    const alreadyInvoiced = installment.clientInvoice !== null;
    if (alreadyInvoiced && omissions.length > 0) {
      throw new BadRequestException(
        `Milestone "${installment.name}" is already invoiced — an omission cannot be netted into it.`,
      );
    }
    const omissionAdjustment = omissions.reduce((sum, o) => sum.plus(o.remaining), ZERO);

    await prisma.$transaction(async (tx) => {
      // Step 1: create milestone DRAFT (or reuse if already exists).
      const milestoneInvoice = alreadyInvoiced
        ? (installment.clientInvoice as InvoiceLike)
        : await this.clientInvoiceService.generateFromInstallment(
            identity,
            {
              installmentId,
              invoiceDate: dto.invoiceDate,
              dueDate: dto.dueDate,
              paymentTerms: dto.paymentTerms,
              subtotalAdjustment: omissionAdjustment.toFixed(2),
            },
            tx,
          );

      // Step 2: allocate omissions against the milestone invoice.
      for (const omission of omissions) {
        await this.variationService.allocateVariationBilling(
          identity,
          omission.id,
          {
            amount: omission.remaining,
            treatment: 'STAGE_REDUCTION',
            clientInvoiceId: milestoneInvoice.id,
            installmentId,
          },
          tx,
        );
      }

      // Step 3: create VO DRAFT invoices for additions.
      const voInvoiceIds: string[] = [];
      for (const addition of additions) {
        const priorInvoiceId = await this.findExistingInvoiceAllocation(tx, orgId, addition.id, installmentId);
        if (priorInvoiceId) {
          voInvoiceIds.push(priorInvoiceId);
          continue;
        }
        const voInvoice = await this.clientInvoiceService.generateStandaloneCharge(
          identity,
          {
            clientId: contract.clientId,
            projectId: contract.projectId,
            contractId: contract.id,
            currencyCode: contract.currency,
            subtotal: addition.remaining.toFixed(2),
            label: `${addition.reference} — ${addition.title}`,
            invoiceDate: dto.invoiceDate,
            dueDate: dto.dueDate,
            paymentTerms: dto.paymentTerms,
          },
          tx,
        );
        await this.variationService.allocateVariationBilling(
          identity,
          addition.id,
          {
            amount: addition.remaining,
            treatment: 'INVOICE',
            clientInvoiceId: voInvoice.id,
            installmentId,
          },
          tx,
        );
        voInvoiceIds.push(voInvoice.id);
      }

      // Step 4: approve + post each invoice (milestone + VOs) atomically.
      // All inside the same transaction — if any posting fails, everything rolls back.
      const allInvoiceIds = [milestoneInvoice.id, ...voInvoiceIds];
      for (const invId of allInvoiceIds) {
        await this.clientInvoiceService.approve(identity, invId, tx);
        await this.clientInvoiceService.post(identity, { invoiceId: invId }, tx);
      }

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Contract',
        resourceId: contract.id,
        sourceCommand: 'commercial.issuePackage',
        eventType: 'COMMERCIAL_STAGE_ISSUED',
        idempotencyKey: `issue-package-${installmentId}-${milestoneInvoice.id}`,
        after: {
          installmentId,
          milestoneInvoiceId: milestoneInvoice.id,
          voInvoiceIds,
        },
      });
    }, { timeout: 15000 });

    const packages = await this.getBillingPackages(identity, contract.id);
    const pkg = packages.packages.find((p) => p.installmentId === installmentId);
    if (!pkg) {
      throw new NotFoundException(
        `Billing package for installment ${installmentId} could not be assembled after issue.`,
      );
    }
    return pkg;
  }

  /**
   * Record a delivery event for a client invoice — append-only history, one row per send.
   * Does not change AR status or outstanding balance.
   */
  async recordDelivery(
    identity: RequestIdentity,
    projectId: string,
    invoiceId: string,
    dto: {
      method: InvoiceDeliveryMethod;
      sentAt: string;
      recipient?: string;
      note?: string;
    },
  ) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // Verify the invoice exists and belongs to this org/project.
    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: invoiceId, organizationId: orgId, projectId },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found on project ${projectId}`);
    }

    const delivery = await prisma.clientInvoiceDelivery.create({
      data: {
        organizationId: orgId,
        invoiceId,
        method: dto.method,
        sentAt: new Date(dto.sentAt),
        sentBy: identity.userId,
        recipient: dto.recipient ?? null,
        note: dto.note ?? null,
      },
    });

    return {
      id: delivery.id,
      method: delivery.method as InvoiceDeliveryMethod,
      recipient: delivery.recipient,
      note: delivery.note,
      sentAt: delivery.sentAt.toISOString(),
      sentBy: delivery.sentBy,
    };
  }

  /**
   * Record a delivery event for every invoice in a billing package — append-only, one row per
   * invoice per send. Package-level convenience: the caller issues one action ("Send to Client")
   * and all documents in the package get an equivalent delivery record. Each invoice retains its
   * own independent delivery history.
   *
   * Does not change AR status or outstanding balance.
   */
  async sendPackage(
    identity: RequestIdentity,
    installmentId: string,
    dto: {
      method: InvoiceDeliveryMethod;
      sentAt: string;
      recipient?: string;
      note?: string;
    },
  ): Promise<{ deliveries: CommercialDeliveryRecord[] }> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    // Collect all invoice IDs in this package: the milestone invoice + any INVOICE-treatment VO invoices.
    const invoiceIds: string[] = [];
    if (installment.clientInvoice) {
      invoiceIds.push(installment.clientInvoice.id);
    }
    const voAllocs = await prisma.variationBillingAllocation.findMany({
      where: { organizationId: orgId, installmentId, treatment: 'INVOICE' },
      select: { clientInvoiceId: true },
    });
    for (const a of voAllocs) {
      if (a.clientInvoiceId) invoiceIds.push(a.clientInvoiceId);
    }

    if (invoiceIds.length === 0) {
      throw new BadRequestException(
        `No invoices have been prepared for installment "${installment.name}" — prepare or issue the package first.`,
      );
    }

    const sentAt = new Date(dto.sentAt);
    const rows = await prisma.$transaction((tx) =>
      Promise.all(
        invoiceIds.map((invoiceId) =>
          tx.clientInvoiceDelivery.create({
            data: {
              organizationId: orgId,
              invoiceId,
              method: dto.method,
              sentAt,
              sentBy: identity.userId,
              recipient: dto.recipient ?? null,
              note: dto.note ?? null,
            },
          }),
        ),
      ),
    );

    const deliveries: CommercialDeliveryRecord[] = rows.map((r) => ({
      id: r.id,
      method: r.method as InvoiceDeliveryMethod,
      recipient: r.recipient,
      note: r.note,
      sentAt: r.sentAt.toISOString(),
      sentBy: r.sentBy,
    }));
    return { deliveries };
  }

  /**
   * Patch metadata on a NOT_POSTED (DRAFT) client invoice: dueDate, paymentTerms, notes.
   * Amount, source identity, client, contract, and currency are immutable.
   */
  async patchDraftInvoice(
    identity: RequestIdentity,
    projectId: string,
    invoiceId: string,
    dto: { dueDate?: string | null; paymentTerms?: string | null; notes?: string | null },
  ) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: invoiceId, organizationId: orgId, projectId },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found on project ${projectId}`);
    }
    if (invoice.postingStatus !== 'NOT_POSTED') {
      throw new BadRequestException(
        `Invoice ${invoiceId} cannot be edited — it has already been posted (status: ${invoice.postingStatus}).`,
      );
    }

    const updated = await prisma.clientInvoice.update({
      where: { id: invoiceId },
      data: {
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        paymentTerms: dto.paymentTerms !== undefined ? dto.paymentTerms : undefined,
        notes: dto.notes !== undefined ? dto.notes : undefined,
      },
      select: { id: true, invoiceNumber: true, dueDate: true, paymentTerms: true, notes: true, postingStatus: true },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      dueDate: updated.dueDate?.toISOString() ?? null,
      paymentTerms: updated.paymentTerms,
      notes: updated.notes,
      postingStatus: updated.postingStatus,
    };
  }

  // ─── Slice 5B — Record project-level customer payment ───────────────────────────

  /**
   * Record a customer payment against project invoices in one atomic operation.
   *
   * Steps (atomic):
   *   1. Assert project membership.
   *   2. Resolve the active contract → clientId (required for the receipt subledger).
   *   3. Resolve bankAccount → GL account code (bank account must be ACTIVE + allowsReceipts).
   *   4. Validate each allocation: invoice must belong to this project, be POSTED, have
   *      outstanding > 0, allocation ≤ outstanding, currency must match.
   *   5. Σ allocations ≤ receipt amount.
   *   6. Atomic: CustomerReceiptService.createAndPost() + audit event in one $transaction.
   *
   * The `allocations` array is EXACTLY what the user confirmed — never auto-recomputed.
   */
  async recordProjectPayment(
    identity: RequestIdentity,
    projectId: string,
    dto: RecordProjectPaymentInput,
  ): Promise<RecordProjectPaymentResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    await this.projectAccess.assertMember(identity, projectId);

    // Idempotency: if the caller supplied a key and we already have a receipt for it, return
    // the existing result without creating a duplicate (safe network-retry protection).
    if (dto.idempotencyKey) {
      const existing = await prisma.paymentReceipt.findFirst({
        where: { idempotencyKey: dto.idempotencyKey },
        select: {
          id: true,
          receiptDate: true,
          totalAmount: true,
          unallocatedAmount: true,
          currencyCode: true,
          paymentMethod: true,
          reference: true,
          clientAllocations: {
            select: {
              clientInvoiceId: true,
              allocatedAmount: true,
              invoice: { select: { invoiceNumber: true } },
            },
          },
        },
      });
      if (existing) {
        return {
          receiptId: existing.id,
          receiptDate: existing.receiptDate.toISOString().slice(0, 10),
          amount: new Decimal(existing.totalAmount).toFixed(2),
          currency: existing.currencyCode,
          method: existing.paymentMethod ?? null,
          reference: existing.reference ?? null,
          allocations: existing.clientAllocations.map((a) => ({
            invoiceId: a.clientInvoiceId,
            invoiceNumber: a.invoice?.invoiceNumber ?? null,
            allocatedAmount: new Decimal(a.allocatedAmount).toFixed(2),
          })),
          unallocatedAmount: new Decimal(existing.unallocatedAmount).toFixed(2),
        };
      }
    }

    // Active contract → clientId
    const contract = await prisma.contract.findFirst({
      where: { organizationId: orgId, projectId, status: 'ACTIVE' },
      select: { clientId: true },
    });
    if (!contract) {
      throw new BadRequestException(
        `Project ${projectId} has no active contract — cannot record a payment.`,
      );
    }

    // Resolve bank account → GL code
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId: orgId },
      include: { glAccount: { select: { code: true } } },
    });
    if (!bankAccount) {
      throw new NotFoundException(`Bank account ${dto.bankAccountId} not found`);
    }
    if (!bankAccount.allowsReceipts) {
      throw new BadRequestException(
        `Bank account ${dto.bankAccountId} does not allow receipts`,
      );
    }
    if (bankAccount.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Bank account ${dto.bankAccountId} is ${bankAccount.status} — only ACTIVE accounts can receive payments`,
      );
    }
    const bankGlCode = bankAccount.glAccount.code;

    // Amount validation
    const totalAmount = new Decimal(dto.amount);
    if (totalAmount.lte(ZERO)) {
      throw new BadRequestException('Receipt amount must be positive');
    }

    // Validate allocations
    let allocatedTotal = ZERO;
    for (const alloc of dto.allocations) {
      allocatedTotal = allocatedTotal.plus(new Decimal(alloc.amount));
    }
    if (allocatedTotal.gt(totalAmount)) {
      throw new BadRequestException(
        `Total allocations ${allocatedTotal.toFixed(2)} exceed receipt amount ${totalAmount.toFixed(2)}`,
      );
    }

    for (const alloc of dto.allocations) {
      const invoice = await prisma.clientInvoice.findFirst({
        where: { id: alloc.clientInvoiceId, organizationId: orgId, projectId },
        select: { postingStatus: true, outstandingAmount: true, currencyCode: true },
      });
      if (!invoice) {
        throw new NotFoundException(
          `Invoice ${alloc.clientInvoiceId} not found on project ${projectId}`,
        );
      }
      if (invoice.postingStatus !== 'POSTED') {
        throw new BadRequestException(
          `Invoice ${alloc.clientInvoiceId} must be POSTED before allocation (status: ${invoice.postingStatus})`,
        );
      }
      const outstanding = new Decimal(invoice.outstandingAmount.toString());
      if (outstanding.lte(ZERO)) {
        throw new BadRequestException(
          `Invoice ${alloc.clientInvoiceId} has no outstanding balance`,
        );
      }
      if (new Decimal(alloc.amount).gt(outstanding)) {
        throw new BadRequestException(
          `Allocation ${alloc.amount} exceeds invoice ${alloc.clientInvoiceId} outstanding ${outstanding.toFixed(2)}`,
        );
      }
      if (invoice.currencyCode !== dto.currency) {
        throw new BadRequestException(
          `Currency mismatch: invoice ${alloc.clientInvoiceId} is ${invoice.currencyCode}, receipt is ${dto.currency}`,
        );
      }
    }

    // Atomic: create receipt + post GL + allocate + audit
    const txResult = await prisma.$transaction(async (tx) => {
      const { receiptId, journalEntryId } = await this.customerReceiptService.createAndPost(
        identity,
        {
          clientId: contract.clientId,
          bankAccountId: dto.bankAccountId,
          bankAccountCode: bankGlCode,
          receiptDate: dto.receiptDate,
          amount: dto.amount,
          currency: dto.currency,
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
          allocations: dto.allocations,
        },
        tx,
      );

      // Store the caller's idempotency key so future retries resolve without duplication.
      if (dto.idempotencyKey) {
        await tx.paymentReceipt.update({
          where: { id: receiptId },
          data: { idempotencyKey: dto.idempotencyKey },
        });
      }

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Project',
        resourceId: projectId,
        sourceCommand: 'commercial.recordProjectPayment',
        eventType: 'PROJECT_PAYMENT_RECEIVED',
        idempotencyKey: `project-payment-${projectId}-${dto.receiptDate}-${receiptId}`,
        after: {
          receiptId,
          journalEntryId,
          amount: dto.amount,
          currency: dto.currency,
          bankAccountId: dto.bankAccountId,
          allocationCount: dto.allocations.length,
        },
      });

      return { receiptId };
    }, { timeout: 15000 });

    // Build the response (reads outside tx — receipt is committed)
    const unallocatedAmount = totalAmount.minus(allocatedTotal);
    const allocationResults: RecordProjectPaymentAllocationResult[] = await Promise.all(
      dto.allocations.map(async (alloc) => {
        const inv = await prisma.clientInvoice.findFirst({
          where: { id: alloc.clientInvoiceId, organizationId: orgId },
          select: { invoiceNumber: true },
        });
        return {
          invoiceId: alloc.clientInvoiceId,
          invoiceNumber: inv?.invoiceNumber ?? null,
          allocatedAmount: new Decimal(alloc.amount).toFixed(2),
        };
      }),
    );

    return {
      receiptId: txResult.receiptId,
      receiptDate: dto.receiptDate,
      amount: totalAmount.toFixed(2),
      currency: dto.currency,
      method: dto.paymentMethod ?? null,
      reference: dto.reference ?? null,
      allocations: allocationResults,
      unallocatedAmount: unallocatedAmount.toFixed(2),
    };
  }

  /**
   * List deposit accounts (ACTIVE, allowsReceipts) for the deposit-account selector in the
   * Record Payment drawer. Returns only the fields needed for the UI to identify the account.
   */
  async getDepositAccounts(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<DepositAccountOption[]> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: orgId, allowsReceipts: true, status: 'ACTIVE' },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        currencyCode: true,
      },
      orderBy: { bankName: 'asc' },
    });

    return accounts.map((a) => ({
      id: a.id,
      bankName: a.bankName,
      accountName: a.accountName,
      accountNumber: a.accountNumber,
      currencyCode: a.currencyCode,
    }));
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────────

  /**
   * The invoice id of a prior INVOICE allocation for `(variationId, installmentId)`, or null. Used by
   * the addition path to stay exactly-once across re-runs of bill-stage (S-VB-6): if this variation
   * was already billed on this installment, reuse that invoice rather than raising a second one.
   */
  private async findExistingInvoiceAllocation(
    tx: Prisma.TransactionClient,
    organizationId: string,
    variationId: string,
    installmentId: string,
  ): Promise<string | null> {
    const prior = await tx.variationBillingAllocation.findFirst({
      where: { organizationId, variationId, installmentId, treatment: 'INVOICE' },
      select: { clientInvoiceId: true },
    });
    return prior?.clientInvoiceId ?? null;
  }
}
