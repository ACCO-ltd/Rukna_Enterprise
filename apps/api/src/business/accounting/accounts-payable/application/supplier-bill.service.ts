import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { SupplierBillRepository } from '../infrastructure/supplier-bill.repository.js';
import { CommitmentLedgerWriter } from '../../../../business/procurement/commitment-ledger/application/commitment-ledger-writer.service.js';
import { BillMatchingService } from '../../../../business/procurement/bill-matching/application/bill-matching.service.js';
import { CommandGovernanceService, throwIfGated } from '../../../../platform/workflows/application/command-governance.service.js';
import {
  validateCostTarget,
  costTargetViolationMessage,
} from '../../../../business/procurement/purchase-orders/domain/cost-target.policy.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';

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

export interface PostSupplierBillDto {
  billId: string;
  apAccountCode: string;
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

  async create(identity: RequestIdentity, dto: CreateSupplierBillDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

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

    const subtotal = lines.reduce((s, l) => s.plus(l.netAmount), new Decimal(0));
    const vatTotal = lines.reduce((s, l) => s.plus(l.vatAmount), new Decimal(0));
    // For NON_RECOVERABLE VAT (ACCO policy): gross posts to expense
    const totalAmount = lines.reduce((s, l) => s.plus(l.grossAmount), new Decimal(0));

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

    return this.repo.create(prisma, {
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
  }

  async submit(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'DRAFT');
    // Governance seam (ADR-011) — backward-compatible: null when no binding is configured.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'SupplierBill', 'DRAFT', 'SUBMITTED', bill.id),
      'Supplier bill submission requires workflow approval.',
    );

    const updated = await prisma.supplierBill.update({
      where: { id: bill.id },
      data: { documentStatus: 'SUBMITTED' },
    });

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

    return this.repo.approve(prisma, bill.id, identity.userId);
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
    if (bill.documentStatus !== 'APPROVED') {
      throw new BadRequestException(`Bill must be APPROVED before posting`);
    }
    if (bill.postingStatus === 'POSTED') {
      throw new ConflictException(`Bill ${dto.billId} is already posted`);
    }

    // ADR-007: posting blocked for procurement bills unless matching is complete/approved
    const POSTABLE_MATCH_STATUSES = ['MATCHED', 'MATCHED_WITH_TOLERANCE', 'APPROVED_EXCEPTION'];
    if (bill.purchaseOrderRevisionId && !POSTABLE_MATCH_STATUSES.includes(bill.matchStatus)) {
      throw new BadRequestException(
        `Bill posting blocked — match status is ${bill.matchStatus}. Approve the exception before posting.`,
      );
    }

    const apGl = await this.accountRepo.findByCode(prisma, orgId, dto.apAccountCode);
    if (!apGl) throw new NotFoundException(`AP GL account ${dto.apAccountCode} not found`);

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
          // Resolve posting profile for expense account
          const profile = await tx.postingProfile.findFirst({
            where: { organizationId: orgId, code: billLine.expenseProfileCode, status: 'ACTIVE' },
          });

          let expenseAccountId: string;
          if (profile) {
            const version = await tx.postingProfileVersion.findFirst({
              where: {
                postingProfileId: profile.id,
                effectiveFrom: { lte: bill.billDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: bill.billDate } }],
              },
              orderBy: { effectiveFrom: 'desc' },
            });
            if (!version) {
              throw new BadRequestException(
                `No active version for posting profile ${billLine.expenseProfileCode} on ${bill.billDate.toISOString().slice(0, 10)}`,
              );
            }
            expenseAccountId = version.accountId;
          } else {
            throw new BadRequestException(
              `Posting profile "${billLine.expenseProfileCode}" not found — configure it in the COA`,
            );
          }

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
            journalCategory: 'ACCOUNTS_PAYABLE',
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_AP',
            createdBy: userId,
            lines,
          },
          tx as never,
        );

        const billNum = await this.sequenceRepo.claimNext(tx as never, orgId, 'SUPPLIER_BILL');
        await this.repo.markPosted(prisma, bill.id, postResult.journalEntryId, billNum.formattedNumber, userId);

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

  async findAll(identity: RequestIdentity, supplierId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, supplierId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!bill) throw new NotFoundException(`SupplierBill ${id} not found`);
    return bill;
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
