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
}

export interface CreateSupplierBillDto {
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRateSnapshot?: number;
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
  ) {}

  async create(identity: RequestIdentity, dto: CreateSupplierBillDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

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
        projectId: line.projectId,
        departmentId: line.departmentId,
        costCenterId: line.costCenterId,
        boqNodeId: line.boqNodeId,
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
      exchangeRateSnapshot: new Decimal(dto.exchangeRateSnapshot ?? 1),
      exchangeRateDate: new Date(dto.billDate),
      exchangeRateSource: 'MANUAL',
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
    return prisma.supplierBill.update({
      where: { id: bill.id },
      data: { documentStatus: 'SUBMITTED' },
    });
  }

  async approve(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireStatus(prisma, identity.activeOrganizationId, billId, 'SUBMITTED');
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
          lines.push({
            accountId: expenseAccountId,
            debitAmount: gross,
            creditAmount: new Decimal(0),
            transactionCurrencyCode: bill.currencyCode,
            baseCurrencyAmount: gross,
            projectId: billLine.projectId ?? bill.projectId ?? undefined,
            departmentId: billLine.departmentId ?? bill.departmentId ?? undefined,
            costCenterId: billLine.costCenterId ?? undefined,
            boqNodeId: billLine.boqNodeId ?? undefined,
            supplierId: bill.supplierId,
          });
        }

        // Credit line: AP control
        const totalAmount = new Decimal(bill.totalAmount.toString());
        lines.push({
          accountId: apGl.id,
          debitAmount: new Decimal(0),
          creditAmount: totalAmount,
          transactionCurrencyCode: bill.currencyCode,
          baseCurrencyAmount: totalAmount,
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

        // ACCRUED → ACTUAL commitment movement (ADR-007, Rule CL-003)
        // Only for procurement-linked bills (purchaseOrderRevisionId present).
        if (bill.purchaseOrderRevisionId) {
          const billedTotal = new Decimal(bill.totalAmount.toString());
          const rate = new Decimal(bill.exchangeRateSnapshot.toString());
          const idempKey = `bill-actual-${bill.id}`;
          const existing = await this.commitmentWriter.findByIdempotencyKey(tx, idempKey);
          if (!existing) {
            // Reverse ACCRUED
            await this.commitmentWriter.accrued(tx, {
              organizationId: orgId,
              supplierId: bill.supplierId,
              amount: billedTotal.negated(),
              currencyCode: bill.currencyCode,
              rate,
              sourceDocumentType: 'SUPPLIER_BILL',
              sourceDocumentId: bill.id,
              eventType: 'BILL_POSTED_ACCRUED_REVERSAL',
              idempotencyKey: idempKey + '-accrued',
              accountingDate: bill.billDate,
            });
            // Record ACTUAL
            await this.commitmentWriter.actual(tx, {
              organizationId: orgId,
              supplierId: bill.supplierId,
              amount: billedTotal,
              currencyCode: bill.currencyCode,
              rate,
              sourceDocumentType: 'SUPPLIER_BILL',
              sourceDocumentId: bill.id,
              eventType: 'BILL_POSTED_ACTUAL',
              idempotencyKey: idempKey,
              accountingDate: bill.billDate,
            });
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
            transactionCurrencyCode: l.transactionCurrencyCode,
            baseCurrencyAmount: l.baseCurrencyAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            supplierId: l.supplierId ?? undefined,
            projectId: l.projectId ?? undefined,
            departmentId: l.departmentId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

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
