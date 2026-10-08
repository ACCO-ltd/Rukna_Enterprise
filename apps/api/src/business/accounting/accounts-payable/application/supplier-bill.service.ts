import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { WorkflowTransactionType, type RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository.js';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import {
  normalizeSupplierInvoiceNumber,
  SupplierBillRepository,
} from '../infrastructure/supplier-bill.repository.js';
import { CommitmentLedgerWriter } from '../../../../business/procurement/commitment-ledger/application/commitment-ledger-writer.service.js';
import { BillMatchingService } from '../../../../business/procurement/bill-matching/application/bill-matching.service.js';
import { CommandGovernanceService, throwIfGated } from '../../../../platform/workflows/application/command-governance.service.js';
import {
  validateCostTarget,
  costTargetViolationMessage,
} from '../../../../business/procurement/purchase-orders/domain/cost-target.policy.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import {
  billPostingBlock,
  isNotApprovedBlock,
  SUPPLIER_BILL_JOURNAL_CATEGORY,
} from '../domain/supplier-bill-eligibility.policy.js';

export interface CreateSupplierBillLineDto {
  description: string;
  quantity?: number;
  unitPrice?: number;
  netAmount: number;
  vatAmount: number;
  expenseProfileCode: string;
  projectId?: string;
  departmentId?: string;
  costCenterId?: string;
  boqNodeId?: string;
  /**
   * Project-level cost target for spend with no BOQ line. Only meaningful on a genuine
   * non-PO bill: a PO-backed bill inherits its whole cost-target from the matched PO line
   * at post time and never re-codes it (D7).
   */
  spendCategoryId?: string;
}

export interface CreateSupplierBillDto {
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  currencyCode: string;
  purchaseOrderId?: string;
  projectId?: string;
  departmentId?: string;
  lines: CreateSupplierBillLineDto[];
}

/**
 * True when a create hit the (organizationId, supplierId, supplierInvoiceNumberNorm) unique index.
 * Other unique violations (none today) are left to propagate unchanged.
 */
function isDuplicateInvoiceNumberConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    // The live-number index is a raw partial index, so Prisma reports its name, not the field.
    /supplierInvoiceNumberNorm|supplier_invoice_number/.test(
      String((error.meta as { target?: unknown } | undefined)?.target ?? ''),
    )
  );
}

/**
 * A status transition that lost a race: the guarded update (`where: { id, documentStatus }`)
 * found no row because another command moved the bill first. Prisma reports it as P2025.
 */
function isStaleTransition(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function staleTransition(expected: string): ConflictException {
  return new ConflictException(
    `The bill is no longer ${expected} — someone else changed it. Reload it and try again.`,
  );
}

/** A return or rejection must say why — it is what the clerk acts on and what the audit keeps. */
function requireReason(reason: string | undefined): string {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new BadRequestException('A reason is required');
  return trimmed;
}

export interface PostSupplierBillDto {
  billId: string;
  /** ADR-045 P3: optional, resolved by role (the single ACTIVE ACCOUNTS_PAYABLE account) when omitted. */
  apAccountCode?: string;
}

@Injectable()
export class SupplierBillService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: SupplierBillRepository,
    private readonly accountRepo: AccountRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
    private readonly commitmentWriter: CommitmentLedgerWriter,
    private readonly billMatching: BillMatchingService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  /**
   * Validation and line building shared by create and update, so an edited draft passes exactly
   * the rules a new bill does: cost targets on a non-PO bill (D7), an ACTIVE PO revision on a PO
   * bill, and server-computed totals.
   */
  private async prepareBill(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    dto: CreateSupplierBillDto,
  ) {
    // A non-PO bill is the only path where cost coding is keyed by hand, so it is validated
    // by the same rule a purchase order is: a BOQ node needs its project, and a project needs
    // a target (a BOQ node, or a spend category for project-level cost). A PO-backed bill
    // carries no coding of its own — it inherits the PO line's at post time (D7).
    if (!dto.purchaseOrderId) {
      for (const [idx, line] of dto.lines.entries()) {
        const projectId = line.projectId ?? dto.projectId;
        const resolvedNode = line.boqNodeId
          ? await this.resolveCostNode(prisma, orgId, line.boqNodeId)
          : null;
        const violation = validateCostTarget(
          { projectId, boqNodeId: line.boqNodeId, spendCategoryId: line.spendCategoryId },
          resolvedNode,
        );
        if (violation) {
          throw new BadRequestException(`Line ${idx + 1}: ${costTargetViolationMessage(violation)}`);
        }
      }
    }

    // M1 (ADR-040 review): a bill line debits its profile's account, so a profile that resolves
    // to anything but a cost or expense account (e.g. INC_42100, PROJECT_REVENUE) would silently
    // understate revenue. Refused here when the profile resolves; an unknown profile is still
    // reported at post, as before.
    const billDate = new Date(dto.billDate);
    for (const code of new Set(dto.lines.map((l) => l.expenseProfileCode))) {
      await this.resolveExpenseProfileAccount(prisma, orgId, code, billDate, { required: false });
    }

    const lines = dto.lines.map((line, idx) => {
      const net = new Decimal(line.netAmount);
      const vat = new Decimal(line.vatAmount);
      const gross = net.plus(vat);
      return {
        lineNumber: idx + 1,
        description: line.description,
        quantity: line.quantity ? new Decimal(line.quantity) : undefined,
        unitPrice: line.unitPrice ? new Decimal(line.unitPrice) : undefined,
        netAmount: net,
        vatAmount: vat,
        grossAmount: gross,
        expenseProfileCode: line.expenseProfileCode,
        projectId: line.projectId ?? dto.projectId,
        departmentId: line.departmentId,
        costCenterId: line.costCenterId,
        boqNodeId: line.boqNodeId,
        spendCategoryId: line.spendCategoryId,
      };
    });

    const subtotal = lines.reduce((sum, l) => sum.plus(l.netAmount), new Decimal(0));
    const vatTotal = lines.reduce((sum, l) => sum.plus(l.vatAmount), new Decimal(0));
    // For NON_RECOVERABLE VAT (ACCO policy): gross posts to expense
    const totalAmount = lines.reduce((sum, l) => sum.plus(l.grossAmount), new Decimal(0));

    let purchaseOrderRevisionId: string | undefined;
    if (dto.purchaseOrderId) {
      const activeRevision = await prisma.purchaseOrderRevision.findFirst({
        where: { purchaseOrderId: dto.purchaseOrderId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!activeRevision) {
        throw new BadRequestException(`Purchase order ${dto.purchaseOrderId} has no ACTIVE revision`);
      }
      purchaseOrderRevisionId = activeRevision.id;
    }

    return { lines, subtotal, vatTotal, totalAmount, purchaseOrderRevisionId };
  }

  async create(identity: RequestIdentity, dto: CreateSupplierBillDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    const { lines, subtotal, vatTotal, totalAmount, purchaseOrderRevisionId } =
      await this.prepareBill(prisma, orgId, dto);

    // One supplier invoice number is recorded once per supplier — the unique index on
    // (organizationId, supplierId, supplierInvoiceNumberNorm). Checked up front so a duplicate is
    // a 409 that names the bill already holding the number, instead of a raw constraint 500.
    const existing = await this.repo.findBySupplierInvoiceNumber(
      prisma,
      orgId,
      dto.supplierId,
      dto.supplierInvoiceNumber,
    );
    if (existing) throw this.duplicateInvoiceNumber(dto.supplierInvoiceNumber, existing.billNumber);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        supplierId: dto.supplierId,
        supplierInvoiceNumber: dto.supplierInvoiceNumber,
        billDate: new Date(dto.billDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: dto.currencyCode,
        purchaseOrderId: dto.purchaseOrderId,
        purchaseOrderRevisionId,
        projectId: dto.projectId,
        departmentId: dto.departmentId,
        subtotal,
        vatAmount: vatTotal,
        totalAmount,
        createdBy: userId,
        lines,
      });
    } catch (err) {
      // A concurrent create of the same number passes the pre-check and loses at the index.
      if (isDuplicateInvoiceNumberConflict(err)) {
        const winner = await this.repo.findBySupplierInvoiceNumber(
          prisma,
          orgId,
          dto.supplierId,
          dto.supplierInvoiceNumber,
        );
        throw this.duplicateInvoiceNumber(dto.supplierInvoiceNumber, winner?.billNumber ?? null);
      }
      throw err;
    }
  }

  private duplicateInvoiceNumber(number: string, billNumber: string | null): ConflictException {
    return new ConflictException(
      `Supplier invoice ${number} is already recorded on ${billNumber ?? 'a draft bill'}`,
    );
  }

  async submit(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'DRAFT');
    // Governance seam (ADR-011) — backward-compatible: null when no binding is configured.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'SupplierBill', 'DRAFT', 'SUBMITTED', bill.id),
      'Supplier bill submission requires workflow approval.',
    );

    let updated;
    try {
      updated = await prisma.supplierBill.update({
        where: { id: bill.id, documentStatus: 'DRAFT' },
        data: { documentStatus: 'SUBMITTED' },
      });
    } catch (err) {
      if (isStaleTransition(err)) throw staleTransition('a draft');
      throw err;
    }

    // D6 — auto-match on submit (no manual "run matching"). A PO-backed bill has its 3-way match
    // run automatically as a silent control: the verdict lands on matchStatus and the bill proceeds.
    // A clean bill (MATCHED / MATCHED_WITH_TOLERANCE) is silently ready toward posting; an EXCEPTION
    // is NOT thrown here — it lands as matchStatus=EXCEPTION and is held by the posting gate until the
    // existing exception-approval path (approveException / resolveException) clears it. Genuine non-PO
    // bills have no PO revision and are left untouched (separate controlled path, D6).
    if (bill.purchaseOrderId && bill.purchaseOrderRevisionId) {
      await this.billMatching.runMatching(identity, bill.id);
    }

    return updated;
  }

  /**
   * Edit a DRAFT bill — a new one, or one returned for correction. Same payload and the same
   * rules as create; the lines are replaced. A PO bill's previous match is discarded, because it
   * describes lines that no longer exist; submitting again runs a fresh one (D6).
   */
  async update(identity: RequestIdentity, billId: string, dto: CreateSupplierBillDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;
    const bill = await this.requireStatus(prisma, orgId, billId, 'DRAFT');

    // A draft can sit under an approval when a policy gates submit (ADR-011). While approvers are
    // deciding, the bill they are looking at must not change underneath them; and an approval
    // already granted covered the old content, so an edit voids it (below) and resubmitting
    // opens a fresh one.
    const approval = await this.commandGovernance.openApprovalState(
      WorkflowTransactionType.SUPPLIER_BILL,
      bill.id,
    );
    if (approval === 'PENDING') {
      throw new ConflictException(
        'An approval is in progress for this bill. It can be edited once the approvers have decided.',
      );
    }

    const { lines, subtotal, vatTotal, totalAmount, purchaseOrderRevisionId } =
      await this.prepareBill(prisma, orgId, dto);

    const existing = await this.repo.findBySupplierInvoiceNumber(
      prisma,
      orgId,
      dto.supplierId,
      dto.supplierInvoiceNumber,
      bill.id,
    );
    if (existing) throw this.duplicateInvoiceNumber(dto.supplierInvoiceNumber, existing.billNumber);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.supplierBillMatch.deleteMany({ where: { supplierBillId: bill.id } });
        await tx.supplierBillLine.deleteMany({ where: { supplierBillId: bill.id } });
        // Guarded: only while still DRAFT, so a concurrent submit cannot be overwritten.
        await tx.supplierBill.update({
          where: { id: bill.id, documentStatus: 'DRAFT' },
          data: {
            supplierId: dto.supplierId,
            supplierInvoiceNumber: dto.supplierInvoiceNumber,
            supplierInvoiceNumberNorm: normalizeSupplierInvoiceNumber(dto.supplierInvoiceNumber),
            billDate: new Date(dto.billDate),
            dueDate: new Date(dto.dueDate),
            currencyCode: dto.currencyCode,
            purchaseOrderId: dto.purchaseOrderId ?? null,
            purchaseOrderRevisionId: purchaseOrderRevisionId ?? null,
            projectId: dto.projectId ?? null,
            departmentId: dto.departmentId ?? null,
            subtotal,
            vatAmount: vatTotal,
            totalAmount,
            outstandingAmount: totalAmount,
            matchStatus: 'NOT_RUN',
            lines: { create: lines },
          },
        });
      });
    } catch (err) {
      if (isDuplicateInvoiceNumberConflict(err)) {
        // Lost a race at the index: name the bill that won, as create does.
        const winner = await this.repo.findBySupplierInvoiceNumber(
          prisma,
          orgId,
          dto.supplierId,
          dto.supplierInvoiceNumber,
          bill.id,
        );
        throw this.duplicateInvoiceNumber(dto.supplierInvoiceNumber, winner?.billNumber ?? null);
      }
      if (isStaleTransition(err)) throw staleTransition('a draft');
      throw err;
    }
    if (approval === 'APPROVED') {
      await this.commandGovernance.voidUnconsumedApproval(WorkflowTransactionType.SUPPLIER_BILL, bill.id);
    }
    return this.findById(identity, bill.id);
  }

  /**
   * Return a SUBMITTED bill to its clerk for correction (ADR-037 amendment): back to DRAFT, with
   * a required reason. The PO match is discarded — the lines are about to change — and runs
   * again when the corrected bill is submitted.
   */
  async returnForCorrection(identity: RequestIdentity, billId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'SUBMITTED');
    const why = requireReason(reason);
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.supplierBillMatch.deleteMany({ where: { supplierBillId: bill.id } });
        return tx.supplierBill.update({
          where: { id: bill.id, documentStatus: 'SUBMITTED' },
          data: {
            documentStatus: 'DRAFT',
          matchStatus: 'NOT_RUN',
          returnedAt: new Date(),
          returnedBy: identity.userId,
            returnReason: why,
          },
        });
      });
    } catch (err) {
      if (isStaleTransition(err)) throw staleTransition('submitted');
      throw err;
    }
  }

  /**
   * Reject a SUBMITTED bill — final (ADR-037 amendment). A rejected bill stays on record, is
   * never posted, and frees its supplier invoice number for a corrected bill.
   *
   * Segregation of duties (Eng Ahmed, 2026-09-27): the person who entered a bill may return it
   * for correction but may not reject it — a rejection is final, so someone else must make it.
   * Always on, not a policy toggle.
   */
  async reject(identity: RequestIdentity, billId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'SUBMITTED');
    if (bill.createdBy === identity.userId) {
      throw new ForbiddenException('You entered this bill, so someone else must reject it.');
    }
    const why = requireReason(reason);
    try {
      // Guarded: a bill approved (or posted) a moment ago must never be marked rejected — that
      // would free its supplier invoice number while a journal exists.
      return await prisma.supplierBill.update({
        where: { id: bill.id, documentStatus: 'SUBMITTED' },
        data: {
          documentStatus: 'REJECTED',
          rejectedAt: new Date(),
          rejectedBy: identity.userId,
          rejectionReason: why,
        },
      });
    } catch (err) {
      if (isStaleTransition(err)) throw staleTransition('submitted');
      throw err;
    }
  }

  async approve(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'SUBMITTED');

    // ADR-022 CONST-DOA-003: whoever received the goods against this bill's PO cannot approve the
    // bill. A non-PO bill has no goods receipt, so the rule does not apply.
    if (bill.purchaseOrderId) {
      const receipts = await prisma.goodsReceiptNote.findMany({
        where: { organizationId: identity.activeOrganizationId, purchaseOrderId: bill.purchaseOrderId },
        select: { createdBy: true },
      });
      const actorReceivedGoods = receipts.some((r) => r.createdBy === identity.userId);
      await this.sod.assertAllowed({
        organizationId: identity.activeOrganizationId,
        action: 'APPROVE_SUPPLIER_BILL',
        actorUserId: identity.userId,
        goodsReceiverUserId: actorReceivedGoods ? identity.userId : undefined,
      });
    }

    try {
      return await this.repo.approve(prisma, bill.id, identity.userId);
    } catch (err) {
      if (isStaleTransition(err)) throw staleTransition('submitted');
      throw err;
    }
  }

  /**
   * Post SupplierBill to GL.
   * EVT-AP-001: Dr Expense (grossAmount per line) / Cr Accounts Payable (totalAmount)
   * ACCO VAT policy: non-recoverable — gross amount (net+VAT) posts to expense.
   */
  async post(identity: RequestIdentity, dto: PostSupplierBillDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const bill = await this.repo.findById(prisma, orgId, dto.billId);
    if (!bill) throw new NotFoundException(`SupplierBill ${dto.billId} not found`);
    // One rule for this command and `GET /bills/:id/eligibility` (ADR-043): approved → not already
    // in the ledger → (ADR-007) a PO-backed bill's match complete or its exception approved.
    const block = billPostingBlock(bill);
    if (block) {
      if (isNotApprovedBlock(block)) throw new BadRequestException(`Bill must be APPROVED before posting`);
      if (block === 'BILL_ALREADY_POSTED') throw new ConflictException(`Bill ${dto.billId} is already posted`);
      if (block === 'OPENING_BALANCE_BILL') {
        throw new ConflictException({
          message: `Bill ${dto.billId} is an opening balance from the previous system — it is already in the ledger and is not posted again`,
          code: 'OPENING_BALANCE_BILL',
          errorCode: 'OPENING_BALANCE_BILL',
        });
      }
      if (block === 'BILL_REVERSED') {
        throw new ConflictException(`Bill ${dto.billId} has been reversed — record a new bill instead`);
      }
      throw new BadRequestException(
        `Bill posting blocked — match status is ${bill.matchStatus}. Approve the exception before posting.`,
      );
    }

    let apGl: { id: string; code: string };
    if (dto.apAccountCode) {
      const found = await this.accountRepo.findByCode(prisma, orgId, dto.apAccountCode);
      if (!found) throw new NotFoundException(`AP GL account ${dto.apAccountCode} not found`);
      apGl = found;
    } else {
      apGl = await new PostingAccountResolver(this.accountRepo).resolve(prisma, orgId, 'ACCOUNTS_PAYABLE');
    }

    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'SUPPLIER_BILL', 'BILL-');

    try {
      return await prisma.$transaction(async (tx) => {
        const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [];

        // D7, capture-once: for a PO-backed bill the authoritative cost-target is the one the
        // buyer set on the PO line, not whatever was keyed onto the bill. Resolved BEFORE the
        // journal lines are built, because the GL and the commitment ledger must both use it —
        // they used to be attributed independently, so project cost in the accounts and project
        // cost in the ledger could never be reconciled. The posting gate guarantees a completed
        // match for a PO-backed bill, so every line resolves; a line that defensively does not
        // falls back to its own coding.
        const costTargets = bill.purchaseOrderRevisionId
          ? await this.repo.findBillLineCostTargets(tx as never, bill.id)
          : [];
        const targetByLine = new Map(costTargets.map((t) => [t.supplierBillLineId, t]));

        // Debit lines: one per bill line (expense/inventory)
        for (const billLine of bill.lines) {
          // Resolve posting profile for expense account (version in force on the bill date; the
          // account must be COST_OF_SALES / EXPENSE — M1).
          const expenseAccountId = (await this.resolveExpenseProfileAccount(
            tx as never, orgId, billLine.expenseProfileCode, bill.billDate, { required: true },
          ))!;

          const gross = new Decimal(billLine.grossAmount.toString());
          const target = targetByLine.get(billLine.id);
          lines.push({
            accountId: expenseAccountId,
            debitAmount: gross,
            creditAmount: new Decimal(0),
            // Inherited from the PO line when there is one; the bill's own coding otherwise
            // (a genuine non-PO bill, validated at create by the cost-target policy).
            projectId: target?.projectId ?? billLine.projectId ?? bill.projectId ?? undefined,
            boqNodeId: target?.boqNodeId ?? billLine.boqNodeId ?? undefined,
            spendCategoryId: target?.spendCategoryId ?? billLine.spendCategoryId ?? undefined,
            departmentId: billLine.departmentId ?? bill.departmentId ?? undefined,
            costCenterId: billLine.costCenterId ?? undefined,
            supplierId: bill.supplierId,
          });
        }

        // Credit line: AP control
        const totalAmount = new Decimal(bill.totalAmount.toString());
        lines.push({
          accountId: apGl.id,
          debitAmount: new Decimal(0),
          creditAmount: totalAmount,
          sourceSubledgerType: 'ACCOUNTS_PAYABLE' as const,
          supplierId: bill.supplierId,
        });

        const postResult = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: bill.billDate,
            documentDate: bill.billDate,
            description: `Supplier Bill — ${bill.supplierInvoiceNumber}`,
            currencyCode: bill.currencyCode,
            eventType: 'EVT-AP-001',
            sourceDocumentType: 'SUPPLIER_BILL',
            sourceDocumentId: bill.id,
            journalCategory: SUPPLIER_BILL_JOURNAL_CATEGORY,
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_AP',
            createdBy: userId,
            lines,
          },
          tx as never,
        );

        const billNum = await this.sequenceRepo.claimNext(tx as never, orgId, 'SUPPLIER_BILL');
        // markPosted runs on `tx` so the POSTED flip commits atomically with the journal and the
        // commitment-ledger movement below. On the outer `prisma` client it committed independently,
        // leaving a POSTED bill pointing at a journalEntryId that a later rollback discarded (mirror
        // of the AR receipt-post fix in 4eb64e1).
        await this.repo.markPosted(tx as never, bill.id, postResult.journalEntryId, billNum.formattedNumber, userId);

        // ACCRUED → ACTUAL commitment movement (ADR-007, Rule CL-003; A14/D7).
        // Only for procurement-linked bills (purchaseOrderRevisionId present).
        //
        // D7 (capture-once, inherit downstream): attribute the ACTUAL to the SAME cost-target the PO
        // COMMITTED and the GRN ACCRUED used, so the ledger nets fully per project/node. We do this
        // PER BILL LINE, inheriting each line's matched PO line projectId/boqNodeId (org lines → null).
        // The posting gate above guarantees a completed match for a PO-backed bill, so every bill line
        // resolves a PO line here. If, defensively, a line has no match row, it falls back to the
        // bill-level attribution (supplier only) — the total still nets, only the dimension is coarser.
        if (bill.purchaseOrderRevisionId) {
          // Idempotency — the whole movement runs once. All per-line writes share this transaction, so
          // this guard (any ACTUAL already recorded for the bill) makes a retry a clean no-op.
          const alreadyPosted = await this.commitmentWriter.existsForSourceAndStage(
            tx as never,
            'SUPPLIER_BILL',
            bill.id,
            'ACTUAL',
          );
          if (!alreadyPosted) {
            for (const billLine of bill.lines) {
              const target = targetByLine.get(billLine.id);
              // ACTUAL is the GL expense: gross, because ACCO's input VAT is non-recoverable
              // and posts into cost (ACC-TAX-001). This is what makes ledger ACTUAL and GL
              // project cost the same number (REC-01).
              const lineAmount = new Decimal(billLine.grossAmount.toString());
              // The accrual is released at what the goods receipt actually accrued for this
              // quantity — billedQuantity × poUnitPrice — not at the bill's gross. Releasing
              // gross against a net accrual left a permanent −VAT residual in ACCRUED, which
              // surfaced as a NEGATIVE "remaining committed" on any fully-billed project.
              // Using the accrued basis makes the stage net to exactly zero whatever the
              // purchase-order price basis turns out to be, so this holds without first
              // settling whether ACCO's supplier prices include VAT.
              const accrualRelease = target?.accruedBasis ?? lineAmount;
              if (lineAmount.isZero() && accrualRelease.isZero()) continue;

              const common = {
                organizationId: orgId,
                supplierId: bill.supplierId,
                purchaseOrderId: bill.purchaseOrderId ?? undefined,
                projectId: target?.projectId ?? undefined,
                boqNodeId: target?.boqNodeId ?? undefined,
                spendCategoryId: target?.spendCategoryId ?? undefined,
                currencyCode: bill.currencyCode,
                sourceDocumentType: 'SUPPLIER_BILL' as const,
                sourceDocumentId: bill.id,
                sourceLineId: target?.purchaseOrderLineId,
                // Accounting-date rule: use the bill's date, never new Date().
                accountingDate: bill.billDate,
              };

              // Reverse the ACCRUED raised at goods receipt for this line's cost-target.
              await this.commitmentWriter.accrued(tx, {
                ...common,
                amount: accrualRelease.negated(),
                eventType: 'BILL_POSTED_ACCRUED_REVERSAL',
                idempotencyKey: `bill-accrued-rev-${bill.id}-${billLine.id}`,
              });
              // Record the ACTUAL for this line's cost-target.
              await this.commitmentWriter.actual(tx, {
                ...common,
                amount: lineAmount,
                eventType: 'BILL_POSTED_ACTUAL',
                idempotencyKey: `bill-actual-${bill.id}-${billLine.id}`,
              });
            }
          }
        }

        return { ...postResult, billNumber: billNum.formattedNumber };
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message.slice(0, 50) : 'POSTING_FAILED';
      await this.repo.markPostingFailed(prisma, bill.id, code);
      throw err;
    }
  }

  /**
   * Reverse a posted SupplierBill.
   * EVT-AP-002: Dr AP / Cr Expense — mirror of EVT-AP-001.
   * Guard: all payment allocations must be reversed first.
   */
  async reverse(
    identity: RequestIdentity,
    billId: string,
    opts: { reversalDate: string; reason: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const bill = await this.repo.findById(prisma, orgId, billId);
    if (!bill) throw new NotFoundException(`SupplierBill ${billId} not found`);
    if (bill.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Only POSTED bills can be reversed (status: ${bill.postingStatus})`);
    }
    if (bill.reversalJournalEntryId) {
      throw new ConflictException(`Bill ${billId} is already reversed`);
    }

    const activeAllocs = await prisma.supplierPaymentAllocation.count({
      where: { supplierBillId: billId, postingStatus: 'POSTED' },
    });
    if (activeAllocs > 0) {
      throw new BadRequestException(
        `Cannot reverse bill ${billId} — it has ${activeAllocs} active payment allocation(s). Reverse the payments first.`,
      );
    }

    if (!bill.postedJournalEntryId) {
      throw new BadRequestException(`Bill ${billId} has no posted journal to reverse`);
    }

    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: bill.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);

    return prisma.$transaction(async (tx) => {
      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of Bill ${bill.billNumber ?? billId}: ${opts.reason}`,
          currencyCode: bill.currencyCode,
          eventType: 'EVT-AP-002',
          sourceDocumentType: 'SUPPLIER_BILL',
          sourceDocumentId: `reversal-${billId}`,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AP',
          reversalOfJournalEntryId: bill.postedJournalEntryId ?? undefined,
          createdBy: userId,
          lines: originalJournal.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            supplierId: l.supplierId ?? undefined,
            projectId: l.projectId ?? undefined,
            boqNodeId: l.boqNodeId ?? undefined,
            spendCategoryId: l.spendCategoryId ?? undefined,
            departmentId: l.departmentId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      // Reverse the commitment ledger too.
      //
      // This used to post the mirror journal and stop, so a reversed bill took GL project
      // cost back to zero while procurement's ACTUAL still showed the full amount — the two
      // could never agree again. `BILL_REVERSAL` existed in the enum and was written by
      // nothing.
      //
      // ACTUAL is backed out, and the ACCRUED released at posting is re-raised: the goods are
      // still on site and still unbilled, which is exactly what ACCRUED means. Attribution and
      // amounts come from the original ledger rows rather than being recomputed, so the
      // reversal cannot land on a different cost-target than the posting did.
      const postedActuals = await tx.commitmentLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          sourceDocumentType: 'SUPPLIER_BILL',
          sourceDocumentId: billId,
        },
      });
      for (const entry of postedActuals) {
        await this.commitmentWriter[entry.stage === 'ACTUAL' ? 'actual' : 'accrued'](tx, {
          organizationId: orgId,
          projectId: entry.projectId ?? undefined,
          boqNodeId: entry.boqNodeId ?? undefined,
          spendCategoryId: entry.spendCategoryId ?? undefined,
          supplierId: entry.supplierId ?? undefined,
          purchaseOrderId: entry.purchaseOrderId ?? undefined,
          currencyCode: entry.currencyCode,
          amount: new Decimal(entry.amount.toString()).negated(),
          sourceDocumentType: 'BILL_REVERSAL',
          sourceDocumentId: billId,
          sourceLineId: entry.sourceLineId ?? undefined,
          eventType: `BILL_REVERSED_${entry.eventType}`,
          idempotencyKey: `bill-reversal-${entry.id}`,
          // Accounting-date rule: the reversal's own date, never new Date().
          accountingDate: reversalDate,
        });
      }

      await tx.supplierBill.update({
        where: { id: billId },
        data: {
          postingStatus: 'REVERSED',
          reversalJournalEntryId: reversalResult.journalEntryId,
          reversedBy: userId,
          reversedAt: new Date(),
        },
      });

      return reversalResult;
    });
  }

  /** Org-wide list, optionally narrowed to a supplier and/or a project (flow plan PR 4). */
  async findAll(identity: RequestIdentity, filter: { supplierId?: string; projectId?: string } = {}) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, filter);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!bill) throw new NotFoundException(`SupplierBill ${id} not found`);

    // The human journal numbers of the posting and its reversal (ADR-036), so a reader without
    // journal access can still see which journal posted the bill.
    const journalIds = [bill.postedJournalEntryId, bill.reversalJournalEntryId].filter(
      (value): value is string => Boolean(value),
    );
    const journals = journalIds.length
      ? await prisma.journalEntry.findMany({
          where: { id: { in: journalIds }, organizationId: identity.activeOrganizationId },
          select: { id: true, journalNumber: true },
        })
      : [];
    const numberOf = (journalId: string | null) =>
      journalId ? (journals.find((j) => j.id === journalId)?.journalNumber ?? null) : null;

    return {
      ...bill,
      postedJournalNumber: numberOf(bill.postedJournalEntryId),
      reversalJournalNumber: numberOf(bill.reversalJournalEntryId),
    };
  }

  /** The facts the cost-target rule needs about a BOQ node, or null when it does not resolve. */
  private async resolveCostNode(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    boqNodeId: string,
  ) {
    const node = await prisma.boqNode.findFirst({
      where: { id: boqNodeId, version: { boq: { organizationId } } },
      select: {
        isLeaf: true,
        isActive: true,
        version: { select: { boq: { select: { projectId: true } } } },
      },
    });
    if (!node) return null;
    return { projectId: node.version.boq.projectId, isLeaf: node.isLeaf, isActive: node.isActive };
  }

  /**
   * The account a posting profile points at on `date`, required to be a cost or expense account.
   * `required: false` returns null when the profile or its dated version does not exist (bill
   * create/update keep their old leniency); `required: true` (post) throws as before.
   */
  private async resolveExpenseProfileAccount(
    client: ReturnType<TenancyService['getClient']>,
    orgId: string,
    code: string,
    date: Date,
    opts: { required: boolean },
  ): Promise<string | null> {
    const profile = await client.postingProfile.findFirst({
      where: { organizationId: orgId, code, status: 'ACTIVE' },
    });
    if (!profile) {
      if (!opts.required) return null;
      throw new BadRequestException(`Posting profile "${code}" not found — configure it in the COA`);
    }
    const version = await client.postingProfileVersion.findFirst({
      where: {
        postingProfileId: profile.id,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) {
      if (!opts.required) return null;
      throw new BadRequestException(
        `No active version for posting profile ${code} on ${date.toISOString().slice(0, 10)}`,
      );
    }
    const account = await this.accountRepo.findById(client, orgId, version.accountId);
    const accountClass = account?.versions[0]?.accountClass;
    if (accountClass !== 'COST_OF_SALES' && accountClass !== 'EXPENSE') {
      throw new BadRequestException({
        errorCode: 'POSTING_PROFILE_NOT_EXPENSE',
        message:
          `Posting profile "${code}" points at ${account?.code ?? 'an unknown account'} ` +
          `(${accountClass ?? 'no class'}); a supplier bill line can only use a cost or expense profile.`,
      });
    }
    return version.accountId;
  }

  private async requireStatus(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    id: string,
    status: string,
  ) {
    const bill = await prisma.supplierBill.findFirst({ where: { id, organizationId, documentStatus: status as never } });
    if (!bill) throw new NotFoundException(`SupplierBill ${id} not found in ${status} status`);
    return bill;
  }
}
