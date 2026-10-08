import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { ApprovalService } from '../../../../platform/workflows/application/approval.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { driveGovernedTransition } from '../../../../platform/workflows/application/governed-transition.driver.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository.js';
import { PeriodValidator } from '../../accounting-core/application/validators/period.validator.js';
import { periodPostingBlock } from '../../accounting-core/domain/period-posting.policy.js';
import { BuyerAdvanceRepository } from '../infrastructure/buyer-advance.repository.js';
import { AwardPaymentRepository, type AwardRequestFacts } from '../infrastructure/award-payment.repository.js';
import { PurchaseOrderService } from '../../../procurement/purchase-orders/application/purchase-order.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import {
  advanceOutstanding,
  applicationAmount,
  applicationDate,
  cashAccountBlock,
  fundingAllows,
  fundingPosition,
  isLegacyAdvance,
  releaseBlockers,
} from '../domain/award-payment.policy.js';
import {
  parseDateOnly,
  parseMoney,
  paymentConflict,
  paymentForbidden,
  paymentUnprocessable,
  todayInMogadishu,
} from '../domain/payment-errors.js';
import {
  AWARD_PAYMENT_EVENTS,
  AWARD_PAYMENT_READ_MODEL,
  type AwardPaymentEvents,
  type AwardPaymentReadModel,
} from '../domain/award-payment-events.port.js';

export type AdvanceMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK';

/** `POST /buyer-advances` (existing): create a DRAFT advance, hardened (ADR-045 §7). */
export interface CreateBuyerAdvanceCommand {
  purchaseOrderId: string;
  recipientUserId: string;
  amount: number | string;
  currencyCode: string;
  paymentMethod: string;
  disbursementBankAccountId: string;
  reference?: string;
  notes?: string;
  advancedAt: string;
}

/** `POST /buyer-advances/release` — create, approve and post in one command (ADR-045 §2). */
export interface ReleaseCashCommand {
  idempotencyKey: string;
  quotationRequestId?: string;
  purchaseOrderId?: string;
  recipientUserId: string;
  amount: string | number;
  bankAccountId: string;
  paymentMethod: AdvanceMethod;
  advancedAt: string;
  reference?: string;
  note?: string;
  /** Top-up: apply the new advance to this posted bill in the same transaction. */
  applyToBillId?: string;
}

export interface CreateAdvanceReturnCommand {
  /** Review M1 — client key: a double tap records one return. */
  idempotencyKey?: string;
  amount: number | string;
  returnMethod: string;
  destinationBankAccountId?: string;
  receivedBy: string;
  receivedAt: string;
  reference?: string;
  note?: string;
}

export interface CreateApplicationCommand {
  /** Review M1 — client key: a double tap records one application. */
  idempotencyKey?: string;
  supplierBillId: string;
  /** Omitted → min(bill outstanding, advance outstanding). */
  amount?: number | string;
}

/** Legacy alias (`/evidence-allocations`). */
export interface CreateEvidenceAllocationCommand {
  supplierBillId: string;
  allocatedAmount: number;
}

type Tx = Prisma.TransactionClient;
const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * ADR-045 §2 — buyer (staff) cash advances as posted finance documents.
 *
 *  - release / post: SoD (nobody releases cash to themselves), the DoA gate on BuyerAdvance
 *    DRAFT → APPROVED (supplier-payment bands; the releaser's tap counts as their own step), then
 *    EVT-AP-007 Dr Staff advances / Cr the account's GL on `advancedAt`, all in one transaction
 *    with the audit event and the CASH_RELEASED notification;
 *  - applications: EVT-AP-008 Dr AP / Cr Staff advances on max(bill date, advancedAt);
 *  - returns: EVT-AP-009 Dr the account receiving the change / Cr Staff advances on `receivedAt`;
 *  - reverse: the mirror journal on `reversalDate` (EVT-AP-010; applications EVT-AP-011).
 *
 * Award POs are locked (`FOR UPDATE`) first and the funding cap is checked under that lock. Legacy
 * advances (POSTED without a journal) are never re-posted and never take part in posted settlement:
 * their evidence links and returns are recorded without a journal, as before.
 */
@Injectable()
export class BuyerAdvanceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly advanceRepo: BuyerAdvanceRepository,
    private readonly purchaseOrderService: PurchaseOrderService,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
    private readonly accountRepo: AccountRepository,
    private readonly awardRepo: AwardPaymentRepository,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly approvals: ApprovalService,
    private readonly sod: SegregationOfDutiesService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly projectAccess: ProjectAccessService,
    @Optional() @Inject(AWARD_PAYMENT_EVENTS) private readonly events?: AwardPaymentEvents,
    @Optional() @Inject(AWARD_PAYMENT_READ_MODEL) private readonly readModel?: AwardPaymentReadModel,
  ) {}

  // ── Setup readiness ───────────────────────────────────────────────────────────────────────────

  /**
   * `GET /buyer-advances/readiness` — what releasing buyer cash needs (ADR-045 P14): the
   * STAFF_ADVANCE profile in force today and at least one ACTIVE paying account without
   * signatories (a cash box / mobile-money float). Informational; not a ledger blocker.
   */
  async readiness(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const today = parseDateOnly(todayInMogadishu())!;
    const staff = await this.awardRepo.staffAdvanceAccount(prisma, orgId, today);
    const accounts = (await this.awardRepo.paymentAccounts(prisma, orgId)).filter(
      (a) => a.status === 'ACTIVE' && a.allowsPayments && a.activeSignatories === 0,
    );
    return {
      ready: staff !== null && accounts.length > 0,
      staffAdvanceProfile: staff !== null,
      cashAccountsWithoutSignatories: accounts.length,
      cashAccounts: accounts.map((a) => ({ bankAccountId: a.id, name: a.bankName, glCode: a.glCode, currencyCode: a.currencyCode })),
    };
  }

  // ── Release (one tap) ─────────────────────────────────────────────────────────────────────────

  /** `GET /buyer-advances/release-draft?quotationRequestId=` — the dialog's prefill and blockers. */
  async releaseDraft(identity: RequestIdentity, quotationRequestId: string) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const request = await this.awardRepo.findRequest(prisma, orgId, quotationRequestId);
    if (!request) throw new NotFoundException(`Quotation request ${quotationRequestId} not found`);
    if (request.projectId) await this.projectAccess.assertMember(identity, request.projectId);
    const po = request.purchaseOrderId ? await this.awardRepo.findPurchaseOrder(prisma, orgId, request.purchaseOrderId) : null;
    const revision = po ? await this.awardRepo.activeRevision(prisma, po.id) : null;
    const ordered = revision?.ordered ?? ZERO;
    const position = po
      ? fundingPosition(await this.awardRepo.fundingInputs(prisma, orgId, po.id, ordered))
      : { cap: ZERO, funded: ZERO, remaining: ZERO };
    const currencyCode = revision?.currencyCode ?? request.currencyCode;

    const people = await prisma.user.findMany({
      where: { id: { in: request.collectorIds }, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    const recipients: Array<{ userId: string; name: string; isRequestCreator: boolean }> = [];
    for (const person of people) {
      if (person.id === identity.userId) continue;
      if (!(await this.awardRepo.activeMember(prisma, orgId, person.id))) continue;
      recipients.push({
        userId: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        isRequestCreator: person.id === request.createdBy,
      });
    }
    recipients.sort((a, b) => Number(b.isRequestCreator) - Number(a.isRequestCreator) || a.name.localeCompare(b.name));

    const lastUsed = await this.awardRepo.lastAdvanceAccountId(prisma, orgId, identity.userId);
    const accounts = (await this.awardRepo.paymentAccounts(prisma, orgId, currencyCode))
      .filter((a) => cashAccountBlock(a, a.activeSignatories, currencyCode) === null)
      .map((a) => ({
        bankAccountId: a.id,
        name: a.bankName === a.accountName ? a.bankName : `${a.bankName} · ${a.accountName}`,
        glCode: a.glCode,
        method: guessMethod(a.bankName),
        lastUsed: a.id === lastUsed,
      }));
    const defaultAdvancedAt = todayInMogadishu();
    const staff = await this.awardRepo.staffAdvanceAccount(prisma, orgId, parseDateOnly(defaultAdvancedAt)!);
    const blockers = releaseBlockers({
      requestAwarded: request.status === 'AWARDED',
      poOpen: po?.status === 'OPEN',
      pathMatches: request.paymentPath === 'BUYER_CASH',
      remainingToFund: position.remaining,
      staffAdvanceConfigured: staff !== null,
      usableAccounts: accounts.length,
    });
    return {
      purchaseOrder: po ? { id: po.id, poNumber: po.poNumber, orderedAmount: ordered.toFixed(2) } : null,
      currencyCode,
      remainingToFund: position.remaining.toFixed(2),
      recipients,
      accounts,
      defaultAdvancedAt,
      bandHint: await this.bandHint(orgId, position.remaining),
      blockers,
    };
  }

  /**
   * `POST /buyer-advances/release`. Idempotent on `idempotencyKey`: a replay of a released advance
   * returns it; a replay of a DRAFT waiting for approval re-drives it (ADR-015).
   */
  async release(identity: RequestIdentity, cmd: ReleaseCashCommand) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const amountText = parseMoney(cmd.amount);
    if (!amountText) throw paymentUnprocessable('AMOUNT_INVALID');
    const amount = new Decimal(amountText);
    const advancedAt = parseDateOnly(cmd.advancedAt);
    if (!advancedAt) throw paymentUnprocessable('DATE_INVALID');
    if (!cmd.idempotencyKey?.trim()) throw new BadRequestException('idempotencyKey is required');

    const existing = await prisma.buyerAdvance.findFirst({ where: { organizationId: orgId, idempotencyKey: cmd.idempotencyKey } });
    if (existing) {
      this.assertSameRelease(existing, cmd, amount, advancedAt);
      if (existing.quotationRequestId) {
        const req = await this.awardRepo.findRequest(prisma, orgId, existing.quotationRequestId);
        if (req?.projectId) await this.projectAccess.assertMember(identity, req.projectId);
      }
      if (existing.documentStatus === 'DRAFT' && existing.postingStatus === 'NOT_POSTED') {
        await this.approveAndPost(identity, existing.id, { applyToBillId: cmd.applyToBillId });
      }
      return this.releaseResult(identity, existing.id);
    }

    const { po, request } = await this.resolveTarget(identity, cmd);
    if (request?.projectId) await this.projectAccess.assertMember(identity, request.projectId);
    await this.assertReleasable(identity, { po, request, recipientUserId: cmd.recipientUserId, bankAccountId: cmd.bankAccountId, advancedAt });

    let advanceId: string;
    try {
      advanceId = await prisma.$transaction(async (tx) => {
        const locked = await this.awardRepo.lockPurchaseOrder(tx, orgId, po.id);
        if (!locked || locked.status !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
        // Review M4 — the path is re-read under the PO lock (a concurrent path change serialises here).
        if (request) await this.assertAwardStillBuyerCash(tx, orgId, request.id);
        if (request) await this.assertFundingRoom(tx, orgId, po.id, amount, cmd.applyToBillId);
        const advance = await tx.buyerAdvance.create({
          data: {
            organizationId: orgId,
            purchaseOrderId: po.id,
            quotationRequestId: request?.id ?? null,
            recipientUserId: cmd.recipientUserId,
            amount,
            currencyCode: po.currencyCode,
            paymentMethod: cmd.paymentMethod,
            disbursementBankAccountId: cmd.bankAccountId,
            reference: cmd.reference?.trim() || null,
            notes: cmd.note?.trim() || null,
            advancedAt,
            documentStatus: 'DRAFT',
            postingStatus: 'NOT_POSTED',
            idempotencyKey: cmd.idempotencyKey,
            applyToBillId: cmd.applyToBillId ?? null,
            createdBy: identity.userId,
          },
        });
        await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_CREATED', 'buyer-advance.release', advance.updatedAt, {
          after: {
            purchaseOrderId: po.id,
            quotationRequestId: request?.id ?? null,
            recipientUserId: cmd.recipientUserId,
            amount: amount.toFixed(2),
            bankAccountId: cmd.bankAccountId,
            advancedAt: day(advancedAt),
          },
        });
        return advance.id;
      });
    } catch (error) {
      // Two deliveries of one tap raced: the partial unique (org, key) kept the first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.release(identity, cmd);
      }
      throw error;
    }

    await this.approveAndPost(identity, advanceId, { applyToBillId: cmd.applyToBillId });
    return this.releaseResult(identity, advanceId);
  }

  /** Review M4 — the award must still be AWARDED on the BUYER_CASH path (read under the PO lock). */
  private async assertAwardStillBuyerCash(tx: Tx, orgId: string, requestId: string) {
    const fresh = await this.awardRepo.findRequest(tx, orgId, requestId);
    if (!fresh || fresh.status !== 'AWARDED') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
    if (fresh.paymentPath !== 'BUYER_CASH') throw paymentConflict('PAYMENT_PATH_MISMATCH');
  }

  // ── Existing endpoints, hardened ──────────────────────────────────────────────────────────────

  /** `POST /buyer-advances` — a DRAFT advance (posted later by `post`), with the release checks. */
  async create(identity: RequestIdentity, cmd: CreateBuyerAdvanceCommand) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const amountText = parseMoney(cmd.amount);
    if (!amountText) throw paymentUnprocessable('AMOUNT_INVALID');
    const amount = new Decimal(amountText);
    const advancedAt = parseDateOnly(cmd.advancedAt);
    if (!advancedAt) throw paymentUnprocessable('DATE_INVALID');

    const { po, request } = await this.resolveTarget(identity, { purchaseOrderId: cmd.purchaseOrderId });
    if (cmd.currencyCode !== po.currencyCode) throw paymentUnprocessable('CURRENCY_MISMATCH');
    await this.assertReleasable(identity, {
      po,
      request,
      recipientUserId: cmd.recipientUserId,
      bankAccountId: cmd.disbursementBankAccountId,
      advancedAt,
    });

    return prisma.$transaction(async (tx) => {
      const locked = await this.awardRepo.lockPurchaseOrder(tx, orgId, po.id);
      if (!locked || locked.status !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
      if (request) await this.assertAwardStillBuyerCash(tx, orgId, request.id);
      if (request) await this.assertFundingRoom(tx, orgId, po.id, amount);
      const advance = await this.advanceRepo.create(tx as never, {
        organizationId: orgId,
        purchaseOrderId: po.id,
        recipientUserId: cmd.recipientUserId,
        amount,
        currencyCode: po.currencyCode,
        paymentMethod: cmd.paymentMethod,
        disbursementBankAccountId: cmd.disbursementBankAccountId,
        reference: cmd.reference,
        notes: cmd.notes,
        advancedAt,
        createdBy: identity.userId,
      });
      if (request) await tx.buyerAdvance.update({ where: { id: advance.id }, data: { quotationRequestId: request.id } });
      await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_CREATED', 'buyer-advance.create', advance.updatedAt, {
        after: { purchaseOrderId: po.id, amount: amount.toFixed(2), advancedAt: day(advancedAt) },
      });
      return tx.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    });
  }

  /**
   * `POST /buyer-advances/:id/post` — a DRAFT advance is released through the same gate, SoD and
   * EVT-AP-007 posting as `release`. A legacy advance (posted before GL posting) answers 409 as an
   * already-posted one always did: it is never re-posted.
   */
  async post(identity: RequestIdentity, advanceId: string) {
    const prisma = this.tenancyService.getClient();
    const advance = await this.advanceRepo.findById(prisma, identity.activeOrganizationId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);
    if (advance.postingStatus === 'POSTED') {
      throw new ConflictException(`BuyerAdvance ${advanceId} is already posted`);
    }
    if (advance.postingStatus === 'REVERSED' || advance.documentStatus === 'CANCELLED') {
      throw new BadRequestException(`BuyerAdvance ${advanceId} has been reversed and cannot be posted`);
    }
    if (advance.quotationRequestId) {
      const req = await this.awardRepo.findRequest(prisma, identity.activeOrganizationId, advance.quotationRequestId);
      if (req?.projectId) await this.projectAccess.assertMember(identity, req.projectId);
    }
    // The stored top-up target is honoured on a body-less re-drive from another device.
    await this.approveAndPost(identity, advanceId, { applyToBillId: advance.applyToBillId ?? undefined });
    return prisma.buyerAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  }

  // ── Approve + post (shared) ───────────────────────────────────────────────────────────────────

  /**
   * DRAFT → APPROVED + POSTED: SoD, the DoA gate (409 `{ approvalInstanceId }` while pending), then
   * one transaction: PO lock → advance lock, EVT-AP-007, the document flip, audit, notification and
   * (top-up) the application to `applyToBillId`. Idempotent: a posted advance is left alone.
   */
  private async approveAndPost(identity: RequestIdentity, advanceId: string, opts: { applyToBillId?: string }) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const advance = await prisma.buyerAdvance.findFirst({ where: { id: advanceId, organizationId: orgId } });
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);
    if (advance.postingStatus === 'POSTED') return;
    if (advance.documentStatus !== 'DRAFT' || advance.postingStatus !== 'NOT_POSTED') {
      throw paymentConflict('ADVANCE_NOT_RELEASED', {}, `BuyerAdvance ${advanceId} is ${advance.documentStatus}/${advance.postingStatus}`);
    }
    await this.assertNotSelfRelease(orgId, identity.userId, advance.recipientUserId);
    const staffOnDate = await this.awardRepo.staffAdvanceAccount(prisma, orgId, advance.advancedAt);
    if (!staffOnDate) throw paymentConflict('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
    await this.assertPeriodOpen(orgId, advance.advancedAt, 'CASH_AND_BANK');

    const request = advance.quotationRequestId
      ? await this.awardRepo.findRequest(prisma, orgId, advance.quotationRequestId)
      : null;
    const outcome = await driveGovernedTransition(
      { governance: this.commandGovernance, approvals: this.approvals },
      {
        identity,
        entityType: 'BuyerAdvance',
        fromState: 'DRAFT',
        toState: 'APPROVED',
        transactionType: WorkflowTransactionType.SUPPLIER_PAYMENT,
        resourceId: advance.id,
        // Review M7 — the band is chosen on the order's cumulative funding (this advance included),
        // so ten releases of $999 cannot all stay in the Finance Officer band.
        amount: request ? await this.cumulativeFunding(prisma, orgId, advance.purchaseOrderId, dec(advance.amount)) : dec(advance.amount),
        selfApprovalNote: request ? `Cash released from ${request.number}` : 'Buyer cash released',
        vetApprovers: async (approval) => {
          // R18: an approver on the advance's instance may not be its recipient.
          const codes = await this.sod.activeRuleCodes(orgId);
          const approvers = new Set(approval.actions.filter((a) => a.action === 'APPROVE').map((a) => a.actorId));
          for (const approverId of approvers) {
            const barred = this.sod.violation(codes, {
              organizationId: orgId,
              action: 'RELEASE_BUYER_ADVANCE',
              actorUserId: approverId,
              advanceRecipientUserId: advance.recipientUserId,
            });
            if (barred) {
              await this.commandGovernance.voidOpenApproval(WorkflowTransactionType.SUPPLIER_PAYMENT, advance.id);
              throw paymentForbidden(
                barred,
                `Segregation-of-duties rule '${barred}' prohibits an approver of this cash release; the approval was voided and must be run again by eligible approvers.`,
              );
            }
          }
        },
      },
    );
    if (outcome.gated) {
      // Review M2 — a concurrent re-drive may have posted it meanwhile: then the new instance the
      // gate opened is void and the posted advance is the answer.
      const now = await prisma.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
      if (now.postingStatus === 'POSTED') {
        await this.commandGovernance.voidOpenApproval(WorkflowTransactionType.SUPPLIER_PAYMENT, advance.id);
        return;
      }
      await prisma.buyerAdvance.updateMany({
        where: { id: advance.id, documentStatus: 'DRAFT' },
        data: { approvalInstanceId: outcome.approvalInstanceId },
      });
      throw new ConflictException({
        errorCode: 'APPROVAL_REQUIRED',
        message: 'Releasing this cash needs workflow approval first; it is released when the approvers have approved.',
        details: { code: 'APPROVAL_REQUIRED', approvalInstanceId: outcome.approvalInstanceId, advanceId: advance.id },
      });
    }

    let applied = false;
    await prisma.$transaction(async (tx) => {
      const locked = await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
      if (!locked) throw new NotFoundException(`PurchaseOrder ${advance.purchaseOrderId} not found`);
      await this.awardRepo.lockBuyerAdvance(tx, advance.id);
      const current = await tx.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
      if (current.postingStatus === 'POSTED') return;
      if (current.documentStatus !== 'DRAFT') throw paymentConflict('ADVANCE_NOT_RELEASED');
      // Review H3 — the release checks again, under the PO lock: a DRAFT may have waited for days.
      await this.assertStillReleasable(tx, identity, current, locked.status);
      // Review M2 — the approval is used in the same transaction as the posting.
      if (outcome.consumed) await this.commandGovernance.consumeApprovalIn(tx, outcome.consumed.instanceId);
      const staff = await this.awardRepo.staffAdvanceAccount(tx, orgId, current.advancedAt);
      if (!staff) throw paymentConflict('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
      const account = await tx.bankAccount.findUniqueOrThrow({
        where: { id: current.disbursementBankAccountId },
        select: { glAccountId: true },
      });
      const amount = dec(current.amount);
      const projectId = request?.projectId ?? undefined;
      const journal = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: current.advancedAt,
          documentDate: current.advancedAt,
          description: `Buyer cash advance${request ? ` — ${request.number}` : ''} (PO ${locked.poNumber})`,
          currencyCode: current.currencyCode,
          eventType: 'EVT-AP-007',
          sourceDocumentType: 'BUYER_ADVANCE',
          sourceDocumentId: current.id,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: identity.userId,
          lines: [
            {
              accountId: staff.accountId,
              debitAmount: amount,
              creditAmount: ZERO,
              resolutionSource: `STAFF_ADVANCE@v${staff.versionNumber}`,
              postingProfileVersionId: staff.versionId,
              projectId,
              memo: 'Cash advanced to buyer',
            },
            {
              accountId: account.glAccountId,
              debitAmount: ZERO,
              creditAmount: amount,
              sourceSubledgerType: 'BANK',
              projectId,
              memo: 'Cash paid out',
            },
          ],
        },
        tx as never,
      );
      const now = new Date();
      const approvedBy = outcome.consumed?.finalApproverId ?? identity.userId;
      const flipped = await tx.buyerAdvance.updateMany({
        where: { id: current.id, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' },
        data: {
          documentStatus: 'APPROVED',
          approvedBy,
          approvedAt: now,
          approvalInstanceId: outcome.consumed?.instanceId ?? current.approvalInstanceId,
          postingStatus: 'POSTED',
          postedJournalEntryId: journal.journalEntryId,
          // Audit timestamp only; the accounting date is advancedAt.
          postedAt: now,
          postedBy: identity.userId,
        },
      });
      if (flipped.count !== 1) throw paymentConflict('ADVANCE_ALREADY_RELEASED');
      const after = await tx.buyerAdvance.findUniqueOrThrow({ where: { id: current.id } });
      await this.audit(tx, identity, current.id, 'BUYER_ADVANCE_RELEASED', 'buyer-advance.release', after.updatedAt, {
        before: { documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' },
        after: {
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          amount: amount.toFixed(2),
          advancedAt: day(current.advancedAt),
          journalEntryId: journal.journalEntryId,
          approvedBy,
          recipientUserId: current.recipientUserId,
        },
        approvalInstanceId: outcome.consumed?.instanceId,
      });
      if (current.quotationRequestId && this.events) {
        await this.events.cashReleased(tx, {
          organizationId: orgId,
          quotationRequestId: current.quotationRequestId,
          advanceId: current.id,
          recipientUserId: current.recipientUserId,
          actorUserId: identity.userId,
        });
      }
      if (opts.applyToBillId) {
        await this.applyInTx(tx, identity, current.id, opts.applyToBillId, undefined, 'buyer-advance.release');
        applied = true;
      }
    });
    if (applied) await this.purchaseOrderService.autoCloseIfSettled(identity, advance.purchaseOrderId);
  }

  // ── Applications (EVT-AP-008) ─────────────────────────────────────────────────────────────────

  /** `POST /buyer-advances/:id/applications` (and the `evidence-allocations` alias). */
  async createApplication(identity: RequestIdentity, advanceId: string, cmd: CreateApplicationCommand) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    let requested: Decimal | undefined;
    if (cmd.amount !== undefined && cmd.amount !== null) {
      const text = parseMoney(cmd.amount);
      if (!text) throw paymentUnprocessable('APPLICATION_AMOUNT_INVALID');
      requested = new Decimal(text);
    }
    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);

    const replay = await this.applicationReplay(prisma, orgId, cmd.idempotencyKey, advance.id, cmd.supplierBillId, requested);
    if (replay) return replay;
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
        await this.awardRepo.lockBuyerAdvance(tx, advance.id);
        return this.applyInTx(tx, identity, advance.id, cmd.supplierBillId, requested, 'buyer-advance.apply', cmd.idempotencyKey);
      });
    } catch (error) {
      if (cmd.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.applicationReplay(prisma, orgId, cmd.idempotencyKey, advance.id, cmd.supplierBillId, requested);
        if (again) return again;
      }
      throw error;
    }
    await this.purchaseOrderService.autoCloseIfSettled(identity, advance.purchaseOrderId);
    return result;
  }

  /** Legacy alias: `POST /buyer-advances/:id/evidence-allocations { supplierBillId, allocatedAmount }`. */
  createEvidenceAllocation(identity: RequestIdentity, advanceId: string, cmd: CreateEvidenceAllocationCommand) {
    return this.createApplication(identity, advanceId, { supplierBillId: cmd.supplierBillId, amount: cmd.allocatedAmount });
  }

  /**
   * Applies an advance to a bill inside `tx` (the caller holds the PO and advance locks): same PO,
   * same supplier, same currency, a POSTED bill; amount ≤ both outstandings. Posted advance →
   * EVT-AP-008 + the bill's outstanding reduced. Legacy advance → an evidence link only (no journal,
   * the bill untouched), as before ADR-045.
   */
  async applyInTx(
    tx: Tx,
    identity: RequestIdentity,
    advanceId: string,
    billId: string,
    requested: Decimal | undefined,
    sourceCommand: string,
    idempotencyKey?: string,
  ) {
    const orgId = identity.activeOrganizationId;
    const advance = await tx.buyerAdvance.findUniqueOrThrow({
      where: { id: advanceId },
      include: { returns: true, evidenceAllocations: true, purchaseOrder: { select: { supplierId: true, poNumber: true } } },
    });
    await this.awardRepo.lockSupplierBill(tx, billId);
    const bill = await tx.supplierBill.findFirst({ where: { id: billId, organizationId: orgId } });
    if (!bill) throw new NotFoundException(`SupplierBill ${billId} not found`);
    if (
      bill.purchaseOrderId !== advance.purchaseOrderId ||
      bill.supplierId !== advance.purchaseOrder.supplierId ||
      bill.currencyCode !== advance.currencyCode
    ) {
      throw paymentUnprocessable('APPLICATION_MISMATCH');
    }
    const legacy = isLegacyAdvance(advance);
    if (!legacy && advance.postingStatus !== 'POSTED') throw paymentConflict('ADVANCE_NOT_RELEASED');
    if (!legacy && bill.postingStatus !== 'POSTED') {
      throw paymentConflict('APPLICATION_MISMATCH', {}, 'The bill must be posted before buyer cash can settle it.');
    }

    const outstanding = advanceOutstanding(
      { amount: dec(advance.amount), legacy },
      advance.evidenceAllocations.map((a) => ({ amount: dec(a.allocatedAmount), postingStatus: a.postingStatus })),
      advance.returns.map((r) => ({ amount: dec(r.amount) })),
    );
    // A legacy evidence link is capped by the bill's total minus earlier evidence on it (it never
    // reduced the bill's outstanding); a posted application by the bill's outstanding.
    const billRoom = legacy
      ? dec(bill.totalAmount).sub(
          (await tx.buyerAdvanceEvidenceAllocation.aggregate({ where: { supplierBillId: bill.id }, _sum: { allocatedAmount: true } }))
            ._sum.allocatedAmount ?? ZERO,
        )
      : dec(bill.outstandingAmount);
    const decision = applicationAmount(billRoom, outstanding, requested);
    if ('block' in decision) throw paymentUnprocessable(decision.block);
    const amount = decision.amount;

    const row = await tx.buyerAdvanceEvidenceAllocation.create({
      data: {
        organizationId: orgId,
        buyerAdvanceId: advance.id,
        supplierBillId: bill.id,
        allocatedAmount: amount,
        allocationDate: legacy ? null : applicationDate(bill.billDate, advance.advancedAt),
        idempotencyKey: idempotencyKey ?? null,
        createdBy: identity.userId,
      },
    });
    if (legacy) {
      await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_EVIDENCE_LINKED', sourceCommand, advance.updatedAt, {
        after: { applicationId: row.id, supplierBillId: bill.id, amount: amount.toFixed(2), legacy: true },
        keySuffix: row.id,
      });
      return { application: row, journalEntryId: null as string | null };
    }

    const date = applicationDate(bill.billDate, advance.advancedAt);
    const staff = await this.awardRepo.staffAdvanceAccount(tx, orgId, date);
    if (!staff) throw paymentConflict('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
    const apAccountId =
      (await this.awardRepo.billApAccountId(tx, bill.postedJournalEntryId)) ??
      (await new PostingAccountResolver(this.accountRepo).resolve(tx as never, orgId, 'ACCOUNTS_PAYABLE')).id;
    const request = advance.quotationRequestId ? await this.awardRepo.findRequest(tx, orgId, advance.quotationRequestId) : null;
    const projectId = request?.projectId ?? bill.projectId ?? undefined;
    const journal = await this.postingPort.post(
      {
        organizationId: orgId,
        accountingDate: date,
        documentDate: date,
        description: `Buyer cash applied — bill ${bill.billNumber ?? bill.supplierInvoiceNumber} (PO ${advance.purchaseOrder.poNumber})`,
        currencyCode: advance.currencyCode,
        eventType: 'EVT-AP-008',
        sourceDocumentType: 'BUYER_ADVANCE',
        sourceDocumentId: row.id,
        journalCategory: 'ACCOUNTS_PAYABLE',
        entryPurpose: 'NORMAL',
        postingOrigin: 'SYSTEM_AP',
        createdBy: identity.userId,
        lines: [
          {
            accountId: apAccountId,
            debitAmount: amount,
            creditAmount: ZERO,
            sourceSubledgerType: 'ACCOUNTS_PAYABLE',
            supplierId: bill.supplierId,
            projectId,
            memo: 'Bill settled by buyer cash',
          },
          {
            accountId: staff.accountId,
            debitAmount: ZERO,
            creditAmount: amount,
            resolutionSource: `STAFF_ADVANCE@v${staff.versionNumber}`,
            postingProfileVersionId: staff.versionId,
            projectId,
            memo: 'Advance accounted for',
          },
        ],
      },
      tx as never,
    );
    const billUpd = await tx.supplierBill.updateMany({
      where: { id: bill.id, outstandingAmount: { gte: amount } },
      data: { outstandingAmount: { decrement: amount } },
    });
    if (billUpd.count !== 1) throw paymentUnprocessable('APPLICATION_EXCEEDS_OUTSTANDING');
    const posted = await tx.buyerAdvanceEvidenceAllocation.update({
      where: { id: row.id },
      data: { postingStatus: 'POSTED', journalEntryId: journal.journalEntryId },
    });
    await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_APPLIED', sourceCommand, advance.updatedAt, {
      after: {
        applicationId: row.id,
        supplierBillId: bill.id,
        amount: amount.toFixed(2),
        allocationDate: day(date),
        journalEntryId: journal.journalEntryId,
      },
      keySuffix: row.id,
    });
    return { application: posted, journalEntryId: journal.journalEntryId };
  }

  /** `POST /buyer-advances/:id/applications/:appId/reverse` — EVT-AP-011 on the application's date. */
  async reverseApplication(identity: RequestIdentity, advanceId: string, applicationId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const text = reason?.trim();
    if (!text) throw new BadRequestException('A reason is required');
    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);

    const result = await prisma.$transaction(async (tx) => {
      await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
      await this.awardRepo.lockBuyerAdvance(tx, advance.id);
      const app = await tx.buyerAdvanceEvidenceAllocation.findFirst({
        where: { id: applicationId, buyerAdvanceId: advance.id, organizationId: orgId },
      });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      if (app.postingStatus !== 'POSTED' || !app.journalEntryId || !app.allocationDate) {
        throw paymentConflict('ADVANCE_NOT_RELEASED', {}, `Application ${applicationId} is not a posted application`);
      }
      await this.awardRepo.lockSupplierBill(tx, app.supplierBillId);
      const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: app.journalEntryId }, include: { lines: true } });
      const journal = await this.postingPort.post(
        {
          organizationId: orgId,
          // The mirror lands in the application's own period (its source date), never today.
          accountingDate: app.allocationDate,
          documentDate: app.allocationDate,
          description: `Reversal of buyer cash application: ${text}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AP-011',
          sourceDocumentType: 'BUYER_ADVANCE',
          sourceDocumentId: `reversal-${app.id}`,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AP',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: dec(l.creditAmount),
            creditAmount: dec(l.debitAmount),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            supplierId: l.supplierId ?? undefined,
            projectId: l.projectId ?? undefined,
            resolutionSource: l.resolutionSource ?? undefined,
            postingProfileVersionId: l.postingProfileVersionId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );
      const flipped = await tx.buyerAdvanceEvidenceAllocation.updateMany({
        where: { id: app.id, postingStatus: 'POSTED' },
        data: {
          postingStatus: 'REVERSED',
          reversalJournalEntryId: journal.journalEntryId,
          reversedAt: new Date(),
          reversedBy: identity.userId,
          reversalReason: text,
        },
      });
      if (flipped.count !== 1) throw new ConflictException(`Application ${applicationId} was already reversed`);
      await tx.supplierBill.update({ where: { id: app.supplierBillId }, data: { outstandingAmount: { increment: app.allocatedAmount } } });
      // Review LOW — the bill is open again, so an order auto-closed as settled is reopened.
      const reopened = await tx.purchaseOrder.updateMany({
        where: { id: advance.purchaseOrderId, organizationId: orgId, status: 'CLOSED' },
        data: { status: 'OPEN', closedAt: null },
      });
      if (reopened.count > 0) {
        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'TRANSITION',
          resourceType: 'PurchaseOrder',
          resourceId: advance.purchaseOrderId,
          sourceCommand: 'buyer-advance.reverse-application',
          eventType: 'PO_REOPENED',
          idempotencyKey: `po-reopened-${advance.purchaseOrderId}-${app.id}`,
          before: { status: 'CLOSED' },
          after: { status: 'OPEN' },
          reason: `Buyer cash application reversed: ${text}`,
        });
      }
      await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_APPLICATION_REVERSED', 'buyer-advance.reverse-application', advance.updatedAt, {
        before: { applicationId: app.id, postingStatus: 'POSTED' },
        after: { postingStatus: 'REVERSED', journalEntryId: journal.journalEntryId },
        reason: text,
        keySuffix: `rev-${app.id}`,
      });
      return { applicationId: app.id, reversalJournalEntryId: journal.journalEntryId };
    });
    return result;
  }

  // ── Returns (EVT-AP-009) ──────────────────────────────────────────────────────────────────────

  /**
   * `POST /buyer-advances/:id/returns` — change the buyer hands back, counted by finance. Capped at
   * what the buyer still holds; lands in a named cash/bank account (every method); EVT-AP-009
   * Dr that account's GL / Cr Staff advances on `receivedAt`. Legacy advances: recorded without a
   * journal, as before.
   */
  async createReturn(identity: RequestIdentity, advanceId: string, cmd: CreateAdvanceReturnCommand) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const amountText = parseMoney(cmd.amount);
    if (!amountText) throw paymentUnprocessable('AMOUNT_INVALID');
    const amount = new Decimal(amountText);
    const receivedAt = parseDateOnly(cmd.receivedAt);
    if (!receivedAt) throw paymentUnprocessable('DATE_INVALID');
    if (!cmd.destinationBankAccountId) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_ERROR',
        message: 'Choose the cash box or account the change was put into.',
        details: { code: 'DESTINATION_REQUIRED' },
      });
    }

    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);
    const destination = await this.awardRepo.findPaymentAccount(prisma, orgId, cmd.destinationBankAccountId);
    if (!destination) throw new NotFoundException(`BankAccount ${cmd.destinationBankAccountId} not found in this organization`);
    if (destination.status !== 'ACTIVE' || !destination.allowsReceipts) throw paymentUnprocessable('ACCOUNT_NOT_USABLE');
    if (destination.currencyCode !== advance.currencyCode) throw paymentUnprocessable('CURRENCY_MISMATCH');
    if (receivedAt.getTime() < advance.advancedAt.getTime()) {
      throw paymentUnprocessable('DATE_INVALID', {}, 'Change cannot be returned before the cash was advanced.');
    }
    const legacy = isLegacyAdvance(advance);
    if (!legacy) await this.assertPeriodOpen(orgId, receivedAt, 'CASH_AND_BANK');

    const returnReplay = async () => {
      if (!cmd.idempotencyKey) return null;
      const prior = await prisma.advanceReturn.findFirst({ where: { organizationId: orgId, idempotencyKey: cmd.idempotencyKey } });
      if (!prior) return null;
      const same =
        prior.buyerAdvanceId === advance.id &&
        dec(prior.amount).equals(amount) &&
        prior.destinationBankAccountId === destination.id &&
        prior.receivedAt.getTime() === receivedAt.getTime() &&
        prior.returnMethod === cmd.returnMethod;
      if (!same) throw paymentConflict('IDEMPOTENCY_KEY_REUSED');
      return prior;
    };
    const prior = await returnReplay();
    if (prior) return prior;

    let raced = false;
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
      await this.awardRepo.lockBuyerAdvance(tx, advance.id);
      // A concurrent tap with the same key may have committed while we waited for the lock.
      if (cmd.idempotencyKey) {
        const first = await tx.advanceReturn.findFirst({ where: { organizationId: orgId, idempotencyKey: cmd.idempotencyKey } });
        if (first) {
          raced = true;
          return { ...first, journalEntryId: first.journalEntryId };
        }
      }
      const current = await tx.buyerAdvance.findUniqueOrThrow({
        where: { id: advance.id },
        include: { returns: true, evidenceAllocations: true },
      });
      if (current.postingStatus !== 'POSTED') throw paymentConflict('ADVANCE_NOT_RELEASED');
      const outstanding = advanceOutstanding(
        { amount: dec(current.amount), legacy },
        current.evidenceAllocations.map((a) => ({ amount: dec(a.allocatedAmount), postingStatus: a.postingStatus })),
        current.returns.map((r) => ({ amount: dec(r.amount) })),
      );
      if (amount.greaterThan(outstanding)) {
        throw paymentUnprocessable('RETURN_EXCEEDS_OUTSTANDING', { outstanding: outstanding.toFixed(2) });
      }
      const row = await this.advanceRepo.createReturn(tx as never, {
        organizationId: orgId,
        buyerAdvanceId: current.id,
        amount,
        returnMethod: cmd.returnMethod,
        destinationBankAccountId: destination.id,
        receivedBy: cmd.receivedBy,
        receivedAt,
        reference: cmd.reference,
        note: cmd.note,
      });
      if (cmd.idempotencyKey) await tx.advanceReturn.update({ where: { id: row.id }, data: { idempotencyKey: cmd.idempotencyKey } });
      let journalEntryId: string | null = null;
      if (!legacy) {
        const staff = await this.awardRepo.staffAdvanceAccount(tx, orgId, receivedAt);
        if (!staff) throw paymentConflict('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
        const request = current.quotationRequestId ? await this.awardRepo.findRequest(tx, orgId, current.quotationRequestId) : null;
        const projectId = request?.projectId ?? undefined;
        const journal = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: receivedAt,
            documentDate: receivedAt,
            description: `Buyer change returned${request ? ` — ${request.number}` : ''}`,
            currencyCode: current.currencyCode,
            eventType: 'EVT-AP-009',
            sourceDocumentType: 'BUYER_ADVANCE',
            sourceDocumentId: row.id,
            journalCategory: 'CASH_AND_BANK',
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_CASH',
            createdBy: identity.userId,
            lines: [
              {
                accountId: destination.glAccountId,
                debitAmount: amount,
                creditAmount: ZERO,
                sourceSubledgerType: 'BANK',
                projectId,
                memo: 'Change received',
              },
              {
                accountId: staff.accountId,
                debitAmount: ZERO,
                creditAmount: amount,
                resolutionSource: `STAFF_ADVANCE@v${staff.versionNumber}`,
                postingProfileVersionId: staff.versionId,
                projectId,
                memo: 'Advance returned',
              },
            ],
          },
          tx as never,
        );
        journalEntryId = journal.journalEntryId;
        await tx.advanceReturn.update({ where: { id: row.id }, data: { journalEntryId } });
      }
      await this.audit(tx, identity, current.id, 'BUYER_ADVANCE_RETURNED', 'buyer-advance.return', current.updatedAt, {
        after: {
          returnId: row.id,
          amount: amount.toFixed(2),
          receivedAt: day(receivedAt),
          destinationBankAccountId: destination.id,
          journalEntryId,
          legacy,
        },
        keySuffix: row.id,
      });
      return { ...row, journalEntryId };
    });
    } catch (error) {
      if (cmd.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await returnReplay();
        if (again) return again;
      }
      throw error;
    }
    if (raced) return (await returnReplay()) ?? result;

    await this.purchaseOrderService.autoCloseIfSettled(identity, advance.purchaseOrderId);
    return result;
  }

  // ── Reverse ───────────────────────────────────────────────────────────────────────────────────

  /**
   * `POST /buyer-advances/:id/reverse` — only while nothing is applied or returned (409
   * ADVANCE_HAS_SETTLEMENTS). A posted advance gets the mirror journal (EVT-AP-010) on
   * `reversalDate` (≥ advancedAt); a DRAFT one (e.g. stuck waiting for approval) is CANCELLED and
   * its approval voided — no journal. A legacy advance is refused: finance clears it by manual journal.
   */
  async reverse(identity: RequestIdentity, advanceId: string, opts: { reason: string; reversalDate: string }) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const reason = opts.reason?.trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);
    if (isLegacyAdvance(advance)) throw paymentConflict('ADVANCE_LEGACY');

    if (advance.postingStatus === 'NOT_POSTED' && advance.documentStatus === 'DRAFT') {
      await prisma.$transaction(async (tx) => {
        await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
        const flipped = await tx.buyerAdvance.updateMany({
          where: { id: advance.id, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' },
          data: { documentStatus: 'CANCELLED', reversedAt: new Date(), reversedBy: identity.userId, reversalReason: reason },
        });
        if (flipped.count !== 1) throw paymentConflict('ADVANCE_ALREADY_RELEASED');
        await this.commandGovernance.voidOpenApprovalIn(tx, WorkflowTransactionType.SUPPLIER_PAYMENT, advance.id);
        const after = await tx.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
        await this.audit(tx, identity, advance.id, 'BUYER_ADVANCE_CANCELLED', 'buyer-advance.reverse', after.updatedAt, {
          before: { documentStatus: 'DRAFT' },
          after: { documentStatus: 'CANCELLED' },
          reason,
        });
      });
      return prisma.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    }

    if (advance.postingStatus !== 'POSTED' || !advance.postedJournalEntryId) {
      throw paymentConflict('ADVANCE_NOT_RELEASED', {}, `BuyerAdvance ${advanceId} is ${advance.postingStatus}`);
    }
    const reversalDate = parseDateOnly(opts.reversalDate);
    if (!reversalDate) throw paymentUnprocessable('DATE_INVALID');
    if (reversalDate.getTime() < advance.advancedAt.getTime()) {
      throw paymentUnprocessable('DATE_INVALID', {}, 'The reversal date cannot be before the advance date.');
    }
    await this.assertPeriodOpen(orgId, reversalDate, 'CASH_AND_BANK');

    await prisma.$transaction(async (tx) => {
      await this.awardRepo.lockPurchaseOrder(tx, orgId, advance.purchaseOrderId);
      await this.awardRepo.lockBuyerAdvance(tx, advance.id);
      const current = await tx.buyerAdvance.findUniqueOrThrow({
        where: { id: advance.id },
        include: { returns: { select: { id: true } }, evidenceAllocations: { where: { postingStatus: 'POSTED' }, select: { id: true } } },
      });
      if (current.postingStatus !== 'POSTED') throw paymentConflict('ADVANCE_NOT_RELEASED');
      if (current.returns.length > 0 || current.evidenceAllocations.length > 0) throw paymentConflict('ADVANCE_HAS_SETTLEMENTS');
      const original = await tx.journalEntry.findUniqueOrThrow({
        where: { id: current.postedJournalEntryId! },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const journal = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of buyer cash advance: ${reason}`,
          currencyCode: current.currencyCode,
          eventType: 'EVT-AP-010',
          sourceDocumentType: 'BUYER_ADVANCE',
          sourceDocumentId: `reversal-${current.id}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: dec(l.creditAmount),
            creditAmount: dec(l.debitAmount),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            projectId: l.projectId ?? undefined,
            resolutionSource: l.resolutionSource ?? undefined,
            postingProfileVersionId: l.postingProfileVersionId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );
      await tx.buyerAdvance.update({
        where: { id: current.id },
        data: {
          postingStatus: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: identity.userId,
          reversalReason: reason,
          reversalJournalEntryId: journal.journalEntryId,
        },
      });
      const after = await tx.buyerAdvance.findUniqueOrThrow({ where: { id: current.id } });
      await this.audit(tx, identity, current.id, 'BUYER_ADVANCE_REVERSED', 'buyer-advance.reverse', after.updatedAt, {
        before: { postingStatus: 'POSTED' },
        after: { postingStatus: 'REVERSED', reversalDate: day(reversalDate), journalEntryId: journal.journalEntryId },
        reason,
      });
    });
    return prisma.buyerAdvance.findUniqueOrThrow({ where: { id: advance.id } });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────

  async findById(identity: RequestIdentity, advanceId: string) {
    const prisma = this.tenancyService.getClient();
    const advance = await this.advanceRepo.findById(prisma, identity.activeOrganizationId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);
    const journals = await this.journalNumbers(prisma, [
      advance.postedJournalEntryId,
      advance.reversalJournalEntryId,
      ...advance.evidenceAllocations.flatMap((a) => [a.journalEntryId, a.reversalJournalEntryId]),
      ...advance.returns.map((r) => r.journalEntryId),
    ]);
    return {
      ...this.withPosition(advance),
      postedJournalNumber: journals.get(advance.postedJournalEntryId ?? '') ?? null,
      reversalJournalNumber: journals.get(advance.reversalJournalEntryId ?? '') ?? null,
      applications: advance.evidenceAllocations.map((a) => ({
        ...a,
        journalNumber: journals.get(a.journalEntryId ?? '') ?? null,
        reversalJournalNumber: journals.get(a.reversalJournalEntryId ?? '') ?? null,
      })),
      returns: advance.returns.map((r) => ({ ...r, journalNumber: journals.get(r.journalEntryId ?? '') ?? null })),
    };
  }

  /**
   * `GET /buyer-advances[?purchaseOrderId=&limit=]`. With a PO: that PO's advances (unchanged
   * order). Without: the organisation's advances, newest first, capped at `limit` (default 100,
   * max 500). Each row adds `purchaseOrder: { id, poNumber }`, `supplier: { id, name }`, `legacy`.
   */
  async list(identity: RequestIdentity, opts: { purchaseOrderId?: string; limit?: number } = {}) {
    const prisma = this.tenancyService.getClient();
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const advances = await this.advanceRepo.findForList(prisma, identity.activeOrganizationId, {
      purchaseOrderId: opts.purchaseOrderId,
      limit,
    });
    return advances.map(({ purchaseOrder, ...advance }) => ({
      ...this.withPosition(advance),
      purchaseOrder: { id: purchaseOrder.id, poNumber: purchaseOrder.poNumber },
      supplier: purchaseOrder.supplier,
    }));
  }

  async findByPurchaseOrder(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancyService.getClient();
    const advances = await this.advanceRepo.findByPurchaseOrder(prisma, identity.activeOrganizationId, purchaseOrderId);
    return advances.map((a) => this.withPosition(a));
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────

  /** outstanding / applied / returned / legacy, by the ADR-045 arithmetic (legacy kept). */
  private withPosition<
    A extends {
      amount: unknown;
      postingStatus: string;
      postedJournalEntryId: string | null;
      evidenceAllocations: Array<{ allocatedAmount: unknown; postingStatus: string }>;
      returns: Array<{ amount: unknown }>;
    },
  >(advance: A) {
    const legacy = isLegacyAdvance(advance);
    const applications = advance.evidenceAllocations.map((a) => ({
      amount: dec(a.allocatedAmount as Decimal),
      postingStatus: a.postingStatus,
    }));
    const returns = advance.returns.map((r) => ({ amount: dec(r.amount as Decimal) }));
    const outstanding = advanceOutstanding({ amount: dec(advance.amount as Decimal), legacy }, applications, returns);
    const applied = applications
      .filter((a) => legacy || a.postingStatus === 'POSTED')
      .reduce((s, a) => s.add(a.amount), ZERO);
    const returned = returns.reduce((s, r) => s.add(r.amount), ZERO);
    return { ...advance, outstanding, applied, returned, legacy };
  }

  private async journalNumbers(prisma: ReturnType<TenancyService['getClient']>, ids: Array<string | null>) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map<string, string>();
    const rows = await prisma.journalEntry.findMany({ where: { id: { in: wanted } }, select: { id: true, journalNumber: true } });
    return new Map(rows.map((r) => [r.id, r.journalNumber ?? '']));
  }

  private async releaseResult(identity: RequestIdentity, advanceId: string) {
    const advance = await this.findById(identity, advanceId);
    const payment =
      advance.quotationRequestId && this.readModel
        ? await this.readModel.paymentOf(identity, advance.quotationRequestId)
        : null;
    return { advance, payment };
  }

  /** A replay of a key must be the same release (PO, recipient, amount, account, date). */
  private assertSameRelease(
    existing: {
      purchaseOrderId: string;
      quotationRequestId: string | null;
      recipientUserId: string;
      amount: unknown;
      disbursementBankAccountId: string;
      advancedAt: Date;
      paymentMethod: string;
      applyToBillId: string | null;
    },
    cmd: ReleaseCashCommand,
    amount: Decimal,
    advancedAt: Date,
  ) {
    const same =
      (!cmd.purchaseOrderId || cmd.purchaseOrderId === existing.purchaseOrderId) &&
      (!cmd.quotationRequestId || cmd.quotationRequestId === existing.quotationRequestId) &&
      cmd.recipientUserId === existing.recipientUserId &&
      dec(existing.amount as Decimal).equals(amount) &&
      cmd.bankAccountId === existing.disbursementBankAccountId &&
      cmd.paymentMethod === existing.paymentMethod &&
      (cmd.applyToBillId ?? null) === (existing.applyToBillId ?? null) &&
      existing.advancedAt.getTime() === advancedAt.getTime();
    if (!same) throw paymentConflict('IDEMPOTENCY_KEY_REUSED');
  }

  /** The PO (OPEN, with its currency) and the award it came from (null for a non-award PO). */
  private async resolveTarget(
    identity: RequestIdentity,
    cmd: { quotationRequestId?: string; purchaseOrderId?: string },
  ): Promise<{ po: { id: string; status: string; currencyCode: string; supplierId: string }; request: AwardRequestFacts | null }> {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    let request: AwardRequestFacts | null = null;
    let poId = cmd.purchaseOrderId;
    if (cmd.quotationRequestId) {
      request = await this.awardRepo.findRequest(prisma, orgId, cmd.quotationRequestId);
      if (!request) throw new NotFoundException(`Quotation request ${cmd.quotationRequestId} not found`);
      if (!request.purchaseOrderId) throw paymentConflict('PAYMENT_PO_NOT_OPEN');
      if (poId && poId !== request.purchaseOrderId) throw paymentConflict('PAYMENT_PO_NOT_OPEN');
      poId = request.purchaseOrderId;
    }
    if (!poId) throw new BadRequestException('quotationRequestId or purchaseOrderId is required');
    const po = await this.awardRepo.findPurchaseOrder(prisma, orgId, poId);
    if (!po) throw new NotFoundException(`PurchaseOrder ${poId} not found in this organization`);
    if (!request) request = await this.awardRepo.findRequestForPurchaseOrder(prisma, orgId, po.id);
    const revision = await this.awardRepo.activeRevision(prisma, po.id);
    return {
      po: { id: po.id, status: po.status, currencyCode: revision?.currencyCode ?? request?.currencyCode ?? 'USD', supplierId: po.supplierId },
      request,
    };
  }

  /** R1, R2, R4, R5, R6, R7, R8 — every check that needs no lock, before anything is written. */
  private async assertReleasable(
    identity: RequestIdentity,
    args: {
      po: { id: string; status: string; currencyCode: string };
      request: AwardRequestFacts | null;
      recipientUserId: string;
      bankAccountId: string;
      advancedAt: Date;
    },
  ) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const { po, request } = args;
    if (request && request.status !== 'AWARDED') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
    if (po.status !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
    if (request && request.paymentPath !== 'BUYER_CASH') throw paymentConflict('PAYMENT_PATH_MISMATCH');

    await this.assertNotSelfRelease(orgId, identity.userId, args.recipientUserId);
    const member = await this.awardRepo.activeMember(prisma, orgId, args.recipientUserId);
    const eligible = request
      ? request.collectorIds.includes(args.recipientUserId)
      : Boolean(member?.permissions.has(PERMISSIONS.procurementView));
    if (!member || !eligible) throw paymentUnprocessable('ADVANCE_RECIPIENT_INVALID');

    const account = await this.awardRepo.findPaymentAccount(prisma, orgId, args.bankAccountId);
    if (!account) throw new NotFoundException(`BankAccount ${args.bankAccountId} not found in this organization`);
    const block = cashAccountBlock(account, account.activeSignatories, po.currencyCode);
    if (block === 'ACCOUNT_REQUIRES_DUAL_CONTROL') throw paymentConflict(block);
    if (block) throw paymentUnprocessable(block);

    if (!(await this.awardRepo.staffAdvanceAccount(prisma, orgId, args.advancedAt))) {
      throw paymentConflict('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
    }
    await this.assertPeriodOpen(orgId, args.advancedAt, 'CASH_AND_BANK');
  }

  /** R3 under the PO lock; a top-up is also capped at the bill it settles. */
  private async assertFundingRoom(tx: Tx, orgId: string, poId: string, amount: Decimal, applyToBillId?: string) {
    const revision = await this.awardRepo.activeRevision(tx, poId);
    const position = fundingPosition(await this.awardRepo.fundingInputs(tx, orgId, poId, revision?.ordered ?? ZERO));
    if (!fundingAllows(position, amount)) {
      throw paymentConflict('FUNDING_EXCEEDS_ORDER', {
        orderedAmount: position.cap.toFixed(2),
        funded: position.funded.toFixed(2),
        requested: amount.toFixed(2),
      });
    }
    if (applyToBillId) {
      const bill = await tx.supplierBill.findFirst({ where: { id: applyToBillId, organizationId: orgId } });
      if (!bill || bill.purchaseOrderId !== poId || bill.postingStatus !== 'POSTED') throw paymentUnprocessable('APPLICATION_MISMATCH');
      if (amount.greaterThan(dec(bill.outstandingAmount))) {
        throw paymentUnprocessable('APPLICATION_EXCEEDS_OUTSTANDING', { billOutstanding: dec(bill.outstandingAmount).toFixed(2) });
      }
    }
  }

  /**
   * Review H3 — inside the posting transaction, under the PO lock: the order still OPEN; the award
   * still on BUYER_CASH; the account still usable without dual control; the recipient still an
   * active collector; and the order still within its cap (this DRAFT already counts).
   */
  private async assertStillReleasable(
    tx: Tx,
    identity: RequestIdentity,
    advance: { id: string; purchaseOrderId: string; quotationRequestId: string | null; recipientUserId: string; disbursementBankAccountId: string; currencyCode: string },
    poStatus: string,
  ) {
    const orgId = identity.activeOrganizationId;
    if (poStatus !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
    const request = advance.quotationRequestId ? await this.awardRepo.findRequest(tx, orgId, advance.quotationRequestId) : null;
    if (advance.quotationRequestId) await this.assertAwardStillBuyerCash(tx, orgId, advance.quotationRequestId);
    const account = await this.awardRepo.findPaymentAccount(tx, orgId, advance.disbursementBankAccountId);
    if (!account) throw paymentUnprocessable('ACCOUNT_NOT_USABLE');
    const block = cashAccountBlock(account, account.activeSignatories, advance.currencyCode);
    if (block === 'ACCOUNT_REQUIRES_DUAL_CONTROL') throw paymentConflict(block);
    if (block) throw paymentUnprocessable(block);
    const member = await this.awardRepo.activeMember(tx, orgId, advance.recipientUserId);
    const eligible = request
      ? request.collectorIds.includes(advance.recipientUserId)
      : Boolean(member?.permissions.has(PERMISSIONS.procurementView));
    if (!member || !eligible) throw paymentUnprocessable('ADVANCE_RECIPIENT_INVALID');
    if (request) {
      const revision = await this.awardRepo.activeRevision(tx, advance.purchaseOrderId);
      const position = fundingPosition(await this.awardRepo.fundingInputs(tx, orgId, advance.purchaseOrderId, revision?.ordered ?? ZERO));
      if (position.funded.greaterThan(position.cap)) {
        throw paymentConflict('FUNDING_EXCEEDS_ORDER', {
          orderedAmount: position.cap.toFixed(2),
          funded: position.funded.toFixed(2),
          requested: '0.00',
        });
      }
    }
  }

  /** Review M7 — Σ live funding of the order (this document included), the DoA band's value. */
  private async cumulativeFunding(db: Tx | ReturnType<TenancyService['getClient']>, orgId: string, poId: string, fallback: Decimal) {
    const revision = await this.awardRepo.activeRevision(db, poId);
    const position = fundingPosition(await this.awardRepo.fundingInputs(db, orgId, poId, revision?.ordered ?? ZERO));
    return position.funded.greaterThan(fallback) ? position.funded : fallback;
  }

  /** Review M1 — a replayed application key answers the first application (or 409 if it differs). */
  private async applicationReplay(
    db: ReturnType<TenancyService['getClient']>,
    orgId: string,
    key: string | undefined,
    advanceId: string,
    billId: string,
    requested: Decimal | undefined,
  ) {
    if (!key) return null;
    const prior = await db.buyerAdvanceEvidenceAllocation.findFirst({ where: { organizationId: orgId, idempotencyKey: key } });
    if (!prior) return null;
    if (prior.buyerAdvanceId !== advanceId || prior.supplierBillId !== billId || (requested && !dec(prior.allocatedAmount).equals(requested))) {
      throw paymentConflict('IDEMPOTENCY_KEY_REUSED');
    }
    return { application: prior, journalEntryId: prior.journalEntryId };
  }

  private async assertNotSelfRelease(orgId: string, actorUserId: string, recipientUserId: string) {
    const codes = await this.sod.activeRuleCodes(orgId);
    const barred = this.sod.violation(codes, {
      organizationId: orgId,
      action: 'RELEASE_BUYER_ADVANCE',
      actorUserId,
      advanceRecipientUserId: recipientUserId,
    });
    if (barred) throw paymentForbidden(barred);
  }

  /** R8 — the existing posting policy, predicted before anything is written (409 with its code). */
  private async assertPeriodOpen(orgId: string, date: Date, journalCategory: string) {
    const prisma = this.tenancyService.getClient();
    const period = await PeriodValidator.findCovering(prisma, orgId, date);
    const block = periodPostingBlock(period ? { name: period.name, status: period.status } : null, journalCategory);
    if (block) {
      throw paymentConflict(block, { date: day(date) }, `No open accounting period for ${day(date)} (${block}).`);
    }
  }

  /** The supplier-payment band an amount falls in (active bindings only), for the dialog. */
  private async bandHint(orgId: string, amount: Decimal) {
    const prisma = this.tenancyService.getClient();
    const bindings = await prisma.workflowTriggerBinding.findMany({
      where: { organizationId: orgId, entityType: 'BuyerAdvance', fromState: 'DRAFT', toState: 'APPROVED', isActive: true },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    const band = bindings.find(
      (b) =>
        b.definition.isActive &&
        (b.minAmount === null || amount.greaterThanOrEqualTo(dec(b.minAmount))) &&
        (b.maxAmount === null || amount.lessThan(dec(b.maxAmount))),
    );
    return band ? { name: band.definition.name, steps: band.definition.steps.map((s) => s.roleRequired) } : null;
  }

  private audit(
    tx: Tx,
    identity: RequestIdentity,
    advanceId: string,
    eventType: string,
    sourceCommand: string,
    updatedAt: Date,
    extra: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string; approvalInstanceId?: string; keySuffix?: string },
  ) {
    return this.auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: eventType.endsWith('CREATED') ? 'CREATE' : 'TRANSITION',
      resourceType: 'BuyerAdvance',
      resourceId: advanceId,
      sourceCommand,
      eventType,
      idempotencyKey: `buyer-advance-${advanceId}-${eventType}${extra.keySuffix ? `-${extra.keySuffix}` : ''}-${updatedAt.getTime()}`,
      before: extra.before,
      after: extra.after,
      reason: extra.reason,
      approvalInstanceId: extra.approvalInstanceId,
    });
  }
}

/** The disbursement method an account suggests (prefill only — finance can change it). */
function guessMethod(bankName: string): AdvanceMethod {
  const name = bankName.toLowerCase();
  if (/cash|petty|sanduuq/.test(name)) return 'CASH';
  if (/evc|zaad|sahal|e-?dahab|mobile|hormuud|telesom/.test(name)) return 'MOBILE_MONEY';
  return 'BANK';
}
