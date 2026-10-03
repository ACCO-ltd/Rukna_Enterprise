import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  type BillingPackageDocumentSource,
  type ClientInvoiceDocStatus,
  type ArPostingStatus,
  type CommercialBillingPackage,
  type CommercialBillingPackageDocument,
  type CommercialBillingPackageInvoice,
  type CommercialBillingPackageLine,
  type CommercialBillingPackagesResponse,
  type CommercialDeliveryRecord,
  type CommercialDeleteDraftInvoiceResponse,
  type CommercialIssueInvoiceResponse,
  type CommercialPreparePackageRequest,
  type CommercialPreparePackageResponse,
  type DepositAccountOption,
  type InvoiceDeliveryMethod,
  type InstallmentReadinessResult,
  type RecordProjectPaymentAllocationResult,
  type RecordProjectPaymentResult,
  type RequestIdentity,
  type StageBillingEligibility,
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
import { installmentBillingBlockerMessage } from '../../../accounting/accounts-receivable/domain/installment-billing-eligibility.js';
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
import { isUnposted, redateForIssue, resolveInvoiceDates } from '../domain/commercial-workspace.policy.js';
import {
  issuePostingDate,
  stageBillingEligibility,
  stagePrepareBlock,
} from '../domain/stage-billing-eligibility.policy.js';
import { PeriodValidator } from '../../../accounting/accounting-core/application/validators/period.validator.js';

const ZERO = new Decimal(0);

/**
 * A refused command: 400 whose body carries a machine `code` (the convention elsewhere) and
 * `errorCode` (what the global exception filter lifts into the envelope's `error.code`).
 */
/**
 * An audit idempotency key for a set of invoices. The ids are sorted so the same set always gives
 * the same key, and hashed rather than cut to the column's length — a truncated list of ids could
 * make two different packages share a key and the second event be dropped as a duplicate.
 */
function invoiceSetKey(prefix: string, invoiceIds: readonly string[]): string {
  const digest = createHash('sha256').update([...invoiceIds].sort().join(',')).digest('hex');
  return `${prefix}-${digest}`;
}

function refuse(code: string, message: string): BadRequestException {
  return new BadRequestException({ message, code, errorCode: code });
}

/** A VO slice still to bill, resolved from the positive selection. */
interface EligibleVariation {
  id: string;
  reference: string;
  title: string;
  remaining: Decimal;
}

/** One invoice of a billing package, as the issue / delete commands need it. */
interface PackageInvoice {
  id: string;
  documentStatus: string;
  postingStatus: string;
  invoiceNumber: string | null;
}

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

/**
 * ADR-030 CONST-COM-028 / S-VB-5..9 (Commercial redesign P1) — the Billing-Package orchestrator and
 * read model.
 *
 * This is Commercial's ONE thin variation-billing WRITE path; the rest of Commercial stays read-only.
 * Orchestration crosses construction → accounting, allowed by ARCH-BOUNDARY-001 (Accounting never
 * imports Variations — the ordering/authorization lives here). {@link issuePackage} composes existing
 * capabilities:
 *   - the milestone invoice via {@link ClientInvoiceService.generateFromInstallment} (with an omission
 *     `subtotalAdjustment` when this un-invoiced stage nets included omissions);
 *   - one standalone invoice per included ADDITION via
 *     {@link ClientInvoiceService.generateStandaloneCharge};
 *   - the exactly-once billing ledger via {@link VariationOrderService.allocateVariationBilling};
 *   - approval + posting via {@link ClientInvoiceService.approve} / {@link ClientInvoiceService.post},
 *     so every document leaves the transaction POSTED with its INV-xxxx number already assigned.
 * All of it runs inside a single transaction so the package commits or rolls back as a whole, with one
 * package-level audit event. Entitlement (contract value / %-schedule) is never touched — realization
 * is a separate layer (CONST-COM-027).
 *
 * A two-step "bill this stage" command (draft-only: allocate now, post later) used to exist here and
 * has been retired — it let a variation's invoice sit allocated-but-unposted, which made
 * {@link issuePackage}'s "already fully realized → skip" eligibility check silently exclude that VO's
 * invoice from ever being posted, orphaning it with no invoice number. `issuePackage` is now the only
 * way to raise a billing package, and it always issues (approves + posts) in the same transaction.
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
    // Commercial redesign D5 — the same money-visibility rule as every other Commercial read model
    // (ADR-029 §8 A-2 margin tier), not the bare legacy `financialPositionView` check it used before.
    const { canViewMargin: canViewFinancials } = resolveBoqVisibility(identity);

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
      postingStatus: inv.postingStatus as ArPostingStatus,
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
   * Mark a payment installment as commercially ready to bill — Construction's signal to Finance
   * (ADR-043 decision 1: Construction verifies and marks ready; Finance prepares and issues).
   *
   * Authorized at the route by the finance set (`view:contract` + `manage:receivable`) or by the
   * narrow `mark-ready:billing` the Construction Director holds. Returns no money.
   *
   * Guards — the prepare command's own rule (`stagePrepareBlock`), so the button the schedule
   * enables (`billingEligibility.canPrepare`) and this command can never disagree:
   *   1. Installment must exist in this org (and on `projectId` when the route names one).
   *   2. Caller must have contract access (project membership gate).
   *   3. Contract must be ACTIVE.
   *   4. CONST-COM-011: a work-completion stage needs a linked, site-VERIFIED programme milestone;
   *      an advance needs the contract executed.
   *   5. No live (non-cancelled) invoice may exist for the stage.
   *   6. Idempotent: already-ready → no-op, no duplicate audit.
   *
   * Does NOT generate an invoice, allocate variations, or change contract value.
   */
  async markReadyToBill(
    identity: RequestIdentity,
    installmentId: string,
    note?: string,
    projectId?: string,
  ): Promise<InstallmentReadinessResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment || (projectId !== undefined && installment.contract.projectId !== projectId)) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    const block = stagePrepareBlock({
      contractStatus: installment.contract.status,
      installment,
      invoice: installment.clientInvoice,
    });
    if (block === 'CONTRACT_NOT_ACTIVE') {
      throw refuse(
        'CONTRACT_NOT_ACTIVE',
        `Contract ${installment.contract.contractNumber} must be ACTIVE to mark an installment ready to bill ` +
          `(currently ${installment.contract.status}).`,
      );
    }
    if (block === 'STAGE_ALREADY_INVOICED') {
      throw refuse(
        'STAGE_ALREADY_INVOICED',
        `Installment "${installment.name}" already has an invoice — readiness cannot be set after billing.`,
      );
    }
    if (block) {
      throw refuse(block, installmentBillingBlockerMessage(block, installment.name));
    }

    // Idempotent: already-ready is a no-op (no error, no duplicate audit event).
    if (installment.readyToBillAt !== null) {
      return {
        installmentId,
        readyToBill: true,
        readyToBillAt: installment.readyToBillAt.toISOString(),
      };
    }

    // Authoritative under the stage's row lock (shared with undo and prepare): two marks racing,
    // or a mark racing Finance's prepare, write once. The checks above are the fast error only.
    const readyToBillAt = await prisma.$transaction(async (tx) => {
      const t = tx as unknown as Parameters<typeof this.repo.lockInstallment>[0];
      if (!(await this.repo.lockInstallment(t, orgId, installmentId))) {
        throw new NotFoundException(`Payment installment ${installmentId} not found`);
      }
      const now = await this.repo.findReadinessForUpdate(t, orgId, installmentId);
      if (now.readyToBillAt) return now.readyToBillAt; // marked meanwhile: no-op, no event
      if (now.hasLiveInvoice) {
        throw new ConflictException({
          message: `Installment "${installment.name}" already has an invoice — readiness cannot be set after billing.`,
          code: 'STAGE_ALREADY_INVOICED',
          errorCode: 'STAGE_ALREADY_INVOICED',
        });
      }
      const at = await this.repo.markInstallmentReadyToBill(t, orgId, installmentId, identity.userId, note);
      if (!at) return (await this.repo.findReadinessForUpdate(t, orgId, installmentId)).readyToBillAt!;
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractPaymentInstallment',
        resourceId: installmentId,
        sourceCommand: 'commercial.markReadyToBill',
        eventType: 'MILESTONE_READY_TO_BILL',
        // Keyed on the mark's own timestamp (as revoke is): mark → undo → mark again is a new
        // event, and a constant key would collide on the outbox's unique index and roll it back.
        idempotencyKey: `ready-to-bill-${installmentId}-${at.getTime()}`,
        after: { readyToBillBy: identity.userId, note: note ?? null },
      });
      return at;
    });

    return { installmentId, readyToBill: true, readyToBillAt: readyToBillAt.toISOString() };
  }

  /**
   * Revoke ready-to-bill status ("Undo ready") before an invoice is prepared.
   *
   * Guards:
   *   1. Installment must exist (and be on `projectId` when the route names one).
   *   2. Caller must have contract access.
   *   3. Must be currently marked ready (nothing to revoke otherwise).
   *   4. No live invoice may exist — a draft counts: once Finance has prepared the stage, readiness
   *      is history (the audit log keeps it). A cancelled invoice does not count, so the stage can
   *      be taken back out of Finance's queue after a cancellation.
   */
  async revokeReadyToBill(
    identity: RequestIdentity,
    installmentId: string,
    reason?: string,
    projectId?: string,
  ): Promise<InstallmentReadinessResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment || (projectId !== undefined && installment.contract.projectId !== projectId)) {
      throw new NotFoundException(`Payment installment ${installmentId} not found`);
    }
    await this.projectAccess.assertContract(identity, installment.contract.id);

    if (installment.readyToBillAt === null) {
      throw refuse(
        'NOT_READY',
        `Installment "${installment.name}" is not marked ready to bill — nothing to revoke.`,
      );
    }
    if (installment.clientInvoice !== null && installment.clientInvoice.documentStatus !== 'CANCELLED') {
      throw refuse(
        'STAGE_ALREADY_INVOICED',
        `Installment "${installment.name}" has an invoice — readiness cannot be revoked after billing.`,
      );
    }

    // Re-checked under the stage's row lock, which Finance's prepare also takes: an undo and a
    // prepare serialise, so an undo can never clear readiness under a draft just prepared.
    await prisma.$transaction(async (tx) => {
      const t = tx as unknown as Parameters<typeof this.repo.lockInstallment>[0];
      if (!(await this.repo.lockInstallment(t, orgId, installmentId))) {
        throw new NotFoundException(`Payment installment ${installmentId} not found`);
      }
      const now = await this.repo.findReadinessForUpdate(t, orgId, installmentId);
      if (now.hasLiveInvoice) {
        throw new ConflictException({
          message: `Installment "${installment.name}" has an invoice — readiness cannot be revoked after billing.`,
          code: 'STAGE_ALREADY_INVOICED',
          errorCode: 'STAGE_ALREADY_INVOICED',
        });
      }
      if (!now.readyToBillAt || (await this.repo.revokeInstallmentReadiness(t, orgId, installmentId)) === 0) {
        throw refuse('NOT_READY', `Installment "${installment.name}" is not marked ready to bill — nothing to revoke.`);
      }
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractPaymentInstallment',
        resourceId: installmentId,
        sourceCommand: 'commercial.revokeReadyToBill',
        eventType: 'MILESTONE_READINESS_REVOKED',
        idempotencyKey: `revoke-readiness-${installmentId}-${now.readyToBillAt.getTime()}`,
        after: { reason: reason ?? null },
      });
    });

    return { installmentId, readyToBill: false, readyToBillAt: null };
  }

  /**
   * ADR-043 Phase 2 — why this stage can or cannot be prepared / issued, step by step. The same
   * object every payment-schedule row carries; built by `stageBillingEligibility` from the guards
   * `preparePackage` calls (`stagePrepareBlock`) and the rules the issue path posts under.
   */
  async getStageBillingEligibility(
    identity: RequestIdentity,
    projectId: string,
    installmentId: string,
  ): Promise<StageBillingEligibility> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment || installment.contract.projectId !== projectId) {
      throw new NotFoundException(`Payment installment ${installmentId} not found on project ${projectId}`);
    }
    await this.projectAccess.assertMember(identity, projectId);
    const invoice =
      installment.clientInvoice && installment.clientInvoice.documentStatus !== 'CANCELLED'
        ? installment.clientInvoice
        : null;
    const issueDate = issuePostingDate(invoice?.invoiceDate ?? null, new Date());
    const period = await PeriodValidator.findCovering(prisma, orgId, issueDate);
    return stageBillingEligibility({
      installmentId,
      contractStatus: installment.contract.status,
      installment,
      invoice,
      issuePeriod: period ? { name: period.name, status: period.status } : null,
    });
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
      /** ADR-041 — one tax code for every invoice in the package; omitted → the default. */
      taxCodeId?: string;
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
    const { additions, omissions } = await this.resolveSelectedVariations(
      prisma,
      orgId,
      contract.id,
      dto.selectedVariationIds,
    );

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
              taxCodeId: dto.taxCodeId,
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
            taxCodeId: dto.taxCodeId,
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

      // Step 4: approve + post every not-yet-posted invoice of the stage's package (milestone + VOs)
      // atomically. The package is read back from the ledger, not from this call's selection, so a
      // stage PREPARED through the new prepare-package command (drafts whose VOs are already fully
      // allocated, so `additions` above skips them) still has every draft posted — never orphaned.
      // All inside the same transaction — if any posting fails, everything rolls back.
      const packageNow = await this.repo.findPackageInvoices(tx as never, orgId, installmentId);
      await this.issueDrafts(identity, this.pendingOf(packageNow), tx);

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

  // ─── Commercial redesign D1 (2026-09-28) — prepare / issue / delete ──────────────

  /**
   * Prepare = drafts only (D1). Creates the stage's DRAFT invoice (with any selected omissions netted
   * into its subtotal) and one DRAFT per selected variation addition, and records the variation
   * allocations — exactly what {@link issuePackage} creates — but approves and posts nothing. The
   * draft review is the human checkpoint; {@link issueInvoice} is the one command that numbers and
   * posts the package.
   *
   * Refused (400, coded) when the contract is not ACTIVE, when `installmentBillingBlocker(at:'raise')`
   * names a blocker, or when the stage already has a live (non-cancelled) invoice. D2: preparing a
   * stage records `readyToBillAt/By` itself when unset, with its audit event, so the retired
   * "mark ready" step's trail is kept. One transaction; the unique source index on the stage invoice
   * (and the `(variation, installment)` allocation index) make a racing double-submit roll back.
   */
  async preparePackage(
    identity: RequestIdentity,
    projectId: string,
    installmentId: string,
    dto: CommercialPreparePackageRequest,
  ): Promise<CommercialPreparePackageResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment || installment.contract.projectId !== projectId) {
      throw new NotFoundException(`Payment installment ${installmentId} not found on project ${projectId}`);
    }
    await this.projectAccess.assertMember(identity, projectId);
    const contract = installment.contract;

    // One rule for this command and the stage's billing eligibility (ADR-043 Phase 2).
    const block = stagePrepareBlock({
      contractStatus: contract.status,
      installment,
      invoice: installment.clientInvoice,
    });
    if (block === 'CONTRACT_NOT_ACTIVE') {
      throw refuse(
        'CONTRACT_NOT_ACTIVE',
        `Contract ${contract.contractNumber} must be ACTIVE to prepare an invoice (currently ${contract.status}).`,
      );
    }
    if (block === 'STAGE_ALREADY_INVOICED') {
      throw refuse(
        'STAGE_ALREADY_INVOICED',
        `"${installment.name}" already has an invoice (${installment.clientInvoice?.invoiceNumber ?? 'draft'}).`,
      );
    }
    if (block) {
      throw refuse(block, installmentBillingBlockerMessage(block, installment.name));
    }

    const dates = resolveInvoiceDates(dto, contract.paymentTerms, new Date());
    if (dates.error) throw refuse('INVALID_DUE_DATE', dates.error);
    const paymentTerms =
      dto.paymentTermsDays !== undefined ? `${dto.paymentTermsDays} days` : (contract.paymentTerms ?? undefined);

    const { additions, omissions } = await this.resolveSelectedVariations(
      prisma,
      orgId,
      contract.id,
      dto.selectedVariationIds ?? [],
    );
    const omissionAdjustment = omissions.reduce((sum, o) => sum.plus(o.remaining), ZERO);

    return prisma.$transaction(
      async (tx) => {
        // The stage's row lock, shared with mark ready / undo ready: an undo cannot interleave.
        await this.repo.lockInstallment(tx as never, orgId, installmentId);
        // Authoritative re-check inside the transaction (the pre-check above is a fast error only).
        const existing = await this.repo.findPackageInvoices(tx as never, orgId, installmentId);
        if (existing.stage) {
          throw refuse('STAGE_ALREADY_INVOICED', `"${installment.name}" already has an invoice.`);
        }

        const stageInvoice = await this.clientInvoiceService.generateFromInstallment(
          identity,
          {
            installmentId,
            invoiceDate: dates.invoiceDate,
            dueDate: dates.dueDate,
            paymentTerms,
            subtotalAdjustment: omissionAdjustment.toFixed(2),
            taxCodeId: dto.taxCodeId,
          },
          tx,
        );

        for (const omission of omissions) {
          await this.variationService.allocateVariationBilling(
            identity,
            omission.id,
            {
              amount: omission.remaining,
              treatment: 'STAGE_REDUCTION',
              clientInvoiceId: stageInvoice.id,
              installmentId,
            },
            tx,
          );
        }

        const voInvoiceIds: string[] = [];
        for (const addition of additions) {
          const voInvoice = await this.clientInvoiceService.generateStandaloneCharge(
            identity,
            {
              clientId: contract.clientId,
              projectId: contract.projectId,
              contractId: contract.id,
              currencyCode: contract.currency,
              subtotal: addition.remaining.toFixed(2),
              label: `${addition.reference} — ${addition.title}`,
              invoiceDate: dates.invoiceDate,
              dueDate: dates.dueDate,
              paymentTerms,
            taxCodeId: dto.taxCodeId,
            },
            tx,
          );
          await this.variationService.allocateVariationBilling(
            identity,
            addition.id,
            { amount: addition.remaining, treatment: 'INVOICE', clientInvoiceId: voInvoice.id, installmentId },
            tx,
          );
          voInvoiceIds.push(voInvoice.id);
        }

        const invoiceIds = [stageInvoice.id, ...voInvoiceIds];
        if (dto.notes) {
          await this.repo.setDraftNotes(tx as never, orgId, invoiceIds, dto.notes);
        }

        // D2 — preparing IS the ready-to-bill decision now; keep its audit trail.
        // Conditional: if Construction marked it meanwhile, their mark stands and no event is added.
        const markedAt = installment.readyToBillAt
          ? null
          : await this.repo.markInstallmentReadyToBill(
              tx as never,
              orgId,
              installmentId,
              identity.userId,
              'Prepared for billing',
            );
        if (markedAt) {
          await this.auditOutbox.record(tx, {
            organizationId: orgId,
            actorUserId: identity.userId,
            action: 'UPDATE',
            resourceType: 'ContractPaymentInstallment',
            resourceId: installmentId,
            sourceCommand: 'commercial.preparePackage',
            eventType: 'MILESTONE_READY_TO_BILL',
            idempotencyKey: `ready-to-bill-${installmentId}-prepare-${stageInvoice.id}`,
            after: { readyToBillBy: identity.userId, note: 'Prepared for billing' },
          });
        }

        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'CREATE',
          resourceType: 'Contract',
          resourceId: contract.id,
          sourceCommand: 'commercial.preparePackage',
          eventType: 'COMMERCIAL_STAGE_PREPARED',
          idempotencyKey: `prepare-package-${stageInvoice.id}`,
          after: {
            installmentId,
            stageInvoiceId: stageInvoice.id,
            voInvoiceIds,
            omissionVariationIds: omissions.map((o) => o.id),
          },
        });

        return { invoiceId: stageInvoice.id, invoiceIds };
      },
      { timeout: 15000 },
    );
  }

  /**
   * Issue = approve + number + post in ONE command (D1). For a stage invoice — or any variation
   * invoice of a stage package — every not-yet-posted draft of that package is issued together; for
   * a separate charge (or any other unlinked invoice) just that one. Each draft is re-snapshotted with
   * the organisation's CURRENT branding first (D8). One transaction: numbers are claimed at post and
   * everything rolls back if any posting fails. Posting still runs `installmentBillingBlocker(at:'post')`.
   *
   * Idempotent: re-issuing a package whose drafts are all posted returns the posted documents.
   */
  async issueInvoice(
    identity: RequestIdentity,
    projectId: string,
    invoiceId: string,
  ): Promise<CommercialIssueInvoiceResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    await this.projectAccess.assertMember(identity, projectId);

    const header = await this.repo.findInvoiceHeader(prisma, orgId, projectId, invoiceId);
    if (!header) throw new NotFoundException(`Invoice ${invoiceId} not found on project ${projectId}`);
    if (header.documentStatus === 'CANCELLED') {
      throw refuse('INVOICE_CANCELLED', `Invoice ${invoiceId} was cancelled; prepare a new one.`);
    }

    const pkg = await this.resolvePackage(prisma, orgId, header);
    const pending = pkg.invoices.filter((i) => i.documentStatus !== 'CANCELLED' && isUnposted(i.postingStatus));

    if (pending.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          await this.issueDrafts(identity, pending, tx, { redateToToday: true });
          await this.auditOutbox.record(tx, {
            organizationId: orgId,
            actorUserId: identity.userId,
            action: 'UPDATE',
            resourceType: 'Contract',
            resourceId: header.contractId ?? projectId,
            sourceCommand: 'commercial.issueInvoice',
            eventType: 'COMMERCIAL_INVOICE_ISSUED',
            idempotencyKey: invoiceSetKey('issue-invoice', pending.map((i) => i.id)),
            after: { invoiceIds: pending.map((i) => i.id), installmentId: pkg.installmentId },
          });
        },
        { timeout: 15000 },
      );
    }

    // Read back the numbers the post claimed (outside the tx — it has committed).
    const after = await this.resolvePackage(prisma, orgId, header);
    const issued = after.invoices.filter((i) => i.postingStatus === 'POSTED');
    return {
      invoiceIds: issued.map((i) => i.id),
      invoiceNumbers: issued.map((i) => i.invoiceNumber ?? ''),
    };
  }

  /**
   * Delete a draft = cancel it (and the other drafts of its stage package), release the variation
   * billing allocations recorded against them so each VO reads unbilled again, and free the stage /
   * separate charge to be prepared again. 400 once posted — a posted invoice is undone with a credit
   * note, never deleted. One transaction, one audit event naming what was cancelled and released.
   */
  async deleteDraftInvoice(
    identity: RequestIdentity,
    projectId: string,
    invoiceId: string,
  ): Promise<CommercialDeleteDraftInvoiceResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    await this.projectAccess.assertMember(identity, projectId);

    const header = await this.repo.findInvoiceHeader(prisma, orgId, projectId, invoiceId);
    if (!header) throw new NotFoundException(`Invoice ${invoiceId} not found on project ${projectId}`);
    if (header.documentStatus === 'CANCELLED') {
      throw refuse('INVOICE_CANCELLED', `Invoice ${invoiceId} is already cancelled.`);
    }
    if (!isUnposted(header.postingStatus)) {
      throw refuse(
        'INVOICE_ALREADY_ISSUED',
        `Invoice ${header.invoiceNumber ?? invoiceId} has been issued; it cannot be deleted. Issue a credit note instead.`,
      );
    }

    const pkg = await this.resolvePackage(prisma, orgId, header);
    const targets = pkg.invoices
      .filter((i) => i.documentStatus !== 'CANCELLED' && isUnposted(i.postingStatus))
      .map((i) => i.id);

    await prisma.$transaction(
      async (tx) => {
        const released = await this.variationService.releaseBillingForCancelledDrafts(identity, targets, tx);
        const cancelled = await this.repo.cancelDraftInvoices(
          tx as never,
          orgId,
          targets,
          identity.userId,
          'Draft deleted from Commercial',
        );
        if (cancelled !== targets.length) {
          // Something was issued between the read and this write — refuse rather than half-cancel.
          throw new ConflictException('The invoice package changed while it was being deleted; reload and retry.');
        }
        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'DELETE',
          resourceType: 'Contract',
          resourceId: header.contractId ?? projectId,
          sourceCommand: 'commercial.deleteDraftInvoice',
          eventType: 'COMMERCIAL_DRAFT_DELETED',
          idempotencyKey: invoiceSetKey('delete-draft', targets),
          before: {
            invoiceIds: targets,
            installmentId: pkg.installmentId,
            sourceBoqNodeId: header.sourceBoqNodeId,
          },
          after: { releasedAllocations: released },
        });
      },
      { timeout: 15000 },
    );

    return { cancelledInvoiceIds: targets };
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
   * Resolve the positive VO selection for a stage package: every id must be a CLIENT_APPROVED
   * variation on the contract (400 otherwise); each is split by the sign of what is still unbilled
   * (addition → its own invoice; omission → nets into the stage). Fully-billed VOs are skipped.
   */
  private async resolveSelectedVariations(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    contractId: string,
    selectedVariationIds: string[],
  ): Promise<{ additions: EligibleVariation[]; omissions: EligibleVariation[] }> {
    const allVos = await this.variationRepo.findByContract(prisma, orgId, contractId);
    const eligibleById = new Map(
      allVos.filter((v) => v.status === 'CLIENT_APPROVED').map((v) => [v.id, v]),
    );
    for (const id of selectedVariationIds) {
      if (!eligibleById.has(id)) {
        throw refuse(
          'VARIATION_NOT_BILLABLE',
          `Variation ${id} is not a CLIENT_APPROVED variation on this contract.`,
        );
      }
    }
    const selectedSet = new Set(selectedVariationIds);
    const additions: EligibleVariation[] = [];
    const omissions: EligibleVariation[] = [];
    for (const [id, vo] of eligibleById) {
      if (!selectedSet.has(id)) continue;
      const net = computeNetPrice(vo.lines.map((l) => ({ amount: l.amount as Decimal })));
      const existing = await this.variationRepo.findAllocationsByVariation(prisma, orgId, vo.id);
      const remaining = VariationBillingAllocationPolicy.remainingUnallocated(net, existing);
      if (remaining.isZero()) continue;
      const e: EligibleVariation = { id: vo.id, reference: vo.reference, title: vo.title, remaining };
      if (remaining.greaterThan(ZERO)) additions.push(e);
      else omissions.push(e);
    }
    return { additions, omissions };
  }

  /**
   * The billing package an invoice belongs to. A stage invoice (sourceInstallmentId) or a variation
   * invoice billed on a stage (INVOICE allocation → installment) resolves to that stage's whole
   * package, stage invoice first; anything else (separate charge, IPC, unlinked) is a package of one.
   */
  private async resolvePackage(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    header: {
      id: string;
      invoiceNumber: string | null;
      documentStatus: string;
      postingStatus: string;
      sourceInstallmentId: string | null;
      variationBillingAllocations: Array<{ installmentId: string | null }>;
    },
  ): Promise<{ installmentId: string | null; invoices: PackageInvoice[] }> {
    const installmentId =
      header.sourceInstallmentId ??
      header.variationBillingAllocations.find((a) => a.installmentId)?.installmentId ??
      null;
    if (!installmentId) {
      const fresh = await prisma.clientInvoice.findFirst({
        where: { id: header.id, organizationId: orgId },
        select: { id: true, documentStatus: true, postingStatus: true, invoiceNumber: true },
      });
      return { installmentId: null, invoices: fresh ? [fresh] : [] };
    }
    const { stage, vos } = await this.repo.findPackageInvoices(prisma, orgId, installmentId);
    const seen = new Set<string>();
    const invoices: PackageInvoice[] = [];
    for (const inv of [stage, ...vos]) {
      if (!inv || seen.has(inv.id)) continue;
      seen.add(inv.id);
      invoices.push(inv);
    }
    return { installmentId, invoices };
  }

  /** The not-yet-posted, not-cancelled invoices of a package, stage invoice first. */
  private pendingOf(pkg: { stage: PackageInvoice | null; vos: PackageInvoice[] }): PackageInvoice[] {
    return [pkg.stage, ...pkg.vos].filter(
      (i): i is PackageInvoice => i !== null && i.documentStatus !== 'CANCELLED' && isUnposted(i.postingStatus),
    );
  }

  /**
   * Issue drafts inside the caller's transaction: re-snapshot the org branding (D8), approve (a legacy
   * draft may already be APPROVED), then post — which claims the INV number and runs the
   * `at:'post'` billing gate.
   */
  private async issueDrafts(
    identity: RequestIdentity,
    drafts: PackageInvoice[],
    tx: Prisma.TransactionClient,
    // Only the Issue command re-dates: its drafts may have waited. The deprecated issue-package
    // route creates and issues in one step with the date the user chose, which stands.
    opts: { redateToToday?: boolean } = {},
  ): Promise<void> {
    const today = new Date();
    for (const draft of drafts) {
      // Dated the day it is issued (owner decision); the post below reads these dates through `tx`.
      const dates = opts.redateToToday
        ? await this.repo.findDraftDates(tx as never, identity.activeOrganizationId, draft.id)
        : null;
      const redated = dates ? redateForIssue(dates.invoiceDate, dates.dueDate, today) : null;
      if (redated) {
        await this.repo.redateDraft(tx as never, identity.activeOrganizationId, draft.id, redated.invoiceDate, redated.dueDate);
      }
      await this.clientInvoiceService.refreshBrandingSnapshot(identity, draft.id, tx);
      if (draft.documentStatus === 'DRAFT') {
        await this.clientInvoiceService.approve(identity, draft.id, tx);
      }
      await this.clientInvoiceService.post(identity, { invoiceId: draft.id }, tx);
    }
  }

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
