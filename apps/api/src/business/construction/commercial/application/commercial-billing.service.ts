import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type ClientInvoiceDocStatus,
  type ArPostingStatus,
  type CommercialBillStageResult,
  type CommercialBillingPackage,
  type CommercialBillingPackageInvoice,
  type CommercialBillingPackageLine,
  type CommercialBillingPackagesResponse,
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

const ZERO = new Decimal(0);

/** The shape of a ClientInvoice the read model surfaces (selected in the AR/commercial repos). */
interface InvoiceLike {
  id: string;
  invoiceNumber: string | null;
  subtotal: Decimal;
  totalAmount: Decimal;
  documentStatus: string;
  postingStatus: string;
}

export interface BillStageInput {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
  variations: Array<{ variationId: string; include: boolean }>;
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
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  // ─── S-VB-5..9 — Bill this stage ────────────────────────────────────────────────

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

    // 2. Resolve the eligible (CLIENT_APPROVED) variations and their remaining headroom.
    const vos = await this.variationRepo.findByContract(prisma, orgId, contract.id);
    const includedById = new Map(
      dto.variations.filter((v) => v.include).map((v) => [v.variationId, true]),
    );

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
      if (!includedById.has(vo.id)) continue; // deferred (or not named) → no-op
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

    const toInvoice = (inv: InvoiceLike | null): CommercialBillingPackageInvoice | null =>
      inv === null
        ? null
        : {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            subtotal: money(new Decimal(inv.subtotal.toString())),
            totalAmount: money(new Decimal(inv.totalAmount.toString())),
            documentStatus: inv.documentStatus as ClientInvoiceDocStatus,
            postingStatus: inv.postingStatus as ArPostingStatus,
          };

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

      packages.push({
        installmentId: inst.id,
        installmentName: inst.name,
        milestoneInvoice,
        variationLines,
        presentedTotal,
      });
    }

    return { contractId, financialsVisible: canViewFinancials, packages };
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
