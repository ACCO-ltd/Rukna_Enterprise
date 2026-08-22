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
import { SupplierPaymentRepository } from '../infrastructure/supplier-payment.repository.js';
import { SupplierBillRepository } from '../infrastructure/supplier-bill.repository.js';
import { CommandGovernanceService, throwIfGated } from '../../../../platform/workflows/application/command-governance.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';

export interface CreateSupplierPaymentDto {
  supplierId: string;
  bankAccountId: string;
  paymentDate: string;
  accountingDate?: string;
  currencyCode: string;
  totalAmount: number;
  paymentMethod: string;
  bankReference?: string;
  notes?: string;
  /** Bills to allocate at payment time */
  allocations?: { supplierBillId: string; amount: number }[];
}

export interface PostSupplierPaymentDto {
  paymentId: string;
  apAccountCode: string;
  bankGlCode: string;
  supplierAdvanceCode: string;
}

export interface AllocateAdvanceDto {
  paymentId: string;
  supplierBillId: string;
  amount: number;
  apAccountCode: string;
  supplierAdvanceCode: string;
}

@Injectable()
export class SupplierPaymentService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly paymentRepo: SupplierPaymentRepository,
    private readonly billRepo: SupplierBillRepository,
    private readonly accountRepo: AccountRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async create(identity: RequestIdentity, dto: CreateSupplierPaymentDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const allocationLines = dto.allocations ?? [];
    const allocatedAmount = allocationLines.reduce(
      (s, a) => s.plus(new Decimal(a.amount)), new Decimal(0),
    );

    const totalAmount = new Decimal(dto.totalAmount);
    if (allocatedAmount.gt(totalAmount)) {
      throw new BadRequestException(`Total allocations exceed payment amount`);
    }

    const paymentDate = new Date(dto.paymentDate);

    return prisma.$transaction(async (tx) => {
      const payment = await this.paymentRepo.create(tx as never, {
        organizationId: orgId,
        supplierId: dto.supplierId,
        bankAccountId: dto.bankAccountId,
        paymentDate,
        accountingDate: new Date(dto.accountingDate ?? dto.paymentDate),
        currencyCode: dto.currencyCode,
        totalAmount,
        allocatedAmount,
        unallocatedAmount: totalAmount.minus(allocatedAmount),
        paymentMethod: dto.paymentMethod,
        bankReference: dto.bankReference,
        notes: dto.notes,
        createdBy: userId,
      });

      for (const alloc of allocationLines) {
        const bill = await this.billRepo.findById(tx as never, orgId, alloc.supplierBillId);
        if (!bill) throw new NotFoundException(`SupplierBill ${alloc.supplierBillId} not found`);
        if (bill.supplierId !== dto.supplierId) {
          throw new BadRequestException(`Bill ${alloc.supplierBillId} supplier does not match payment supplier`);
        }
        if (bill.currencyCode !== dto.currencyCode) {
          throw new BadRequestException(`Bill ${alloc.supplierBillId} currency does not match payment currency`);
        }
        const allocAmt = new Decimal(alloc.amount);
        const outstanding = new Decimal(bill.outstandingAmount.toString());
        if (allocAmt.gt(outstanding)) {
          throw new BadRequestException(`Allocation ${allocAmt.toFixed(2)} exceeds bill outstanding balance ${outstanding.toFixed(2)}`);
        }

        await this.paymentRepo.createAllocation(tx as never, {
          organizationId: orgId,
          supplierPaymentId: payment.id,
          supplierBillId: alloc.supplierBillId,
          allocatedAmount: allocAmt,
          allocationDate: paymentDate,
          postingStatus: 'NOT_POSTED',
          createdBy: userId,
        });

        await this.billRepo.updateOutstandingAmount(tx as never, bill.id, outstanding.minus(allocAmt));
      }

      return payment;
    });
  }

  async approve(identity: RequestIdentity, paymentId: string) {
    const prisma = this.tenancyService.getClient();
    const payment = await this.paymentRepo.findById(prisma, identity.activeOrganizationId, paymentId);
    if (!payment) throw new NotFoundException(`SupplierPayment ${paymentId} not found`);
    if (payment.documentStatus !== 'DRAFT') {
      throw new BadRequestException(`Payment is already ${payment.documentStatus}`);
    }

    // ADR-022 CONST-DOA-003: whoever approved a bill this payment settles cannot also approve the
    // payment. Bill approval and payment approval must be different people.
    const allocations = await prisma.supplierPaymentAllocation.findMany({
      where: { supplierPaymentId: paymentId },
      select: { bill: { select: { approvedBy: true } } },
    });
    const actorApprovedASettledBill = allocations.some((a) => a.bill.approvedBy === identity.userId);
    await this.sod.assertAllowed({
      organizationId: identity.activeOrganizationId,
      action: 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT',
      actorUserId: identity.userId,
      supplierBillApproverUserId: actorApprovedASettledBill ? identity.userId : undefined,
    });

    // Governance seam (ADR-011) — the payment has no separate submit, so approval is the
    // request transition. Backward-compatible: null when no binding is configured.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'SupplierPayment', 'DRAFT', 'APPROVED', paymentId),
      'Supplier payment approval requires workflow approval.',
    );
    return this.paymentRepo.approve(prisma, paymentId, identity.userId);
  }

  /**
   * Post supplier payment to GL.
   * EVT-AP-003 Branch A (allocated): Dr AP / Cr Bank
   * EVT-AP-003 Branch B (advance): Dr AP / Dr Supplier Advance / Cr Bank
   */
  async post(identity: RequestIdentity, dto: PostSupplierPaymentDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const payment = await this.paymentRepo.findById(prisma, orgId, dto.paymentId);
    if (!payment) throw new NotFoundException(`SupplierPayment ${dto.paymentId} not found`);
    if (payment.documentStatus !== 'APPROVED') {
      throw new BadRequestException(`Payment must be APPROVED before posting`);
    }
    if (payment.postingStatus === 'POSTED') {
      throw new ConflictException(`Payment ${dto.paymentId} is already posted`);
    }

    const apGl = await this.accountRepo.findByCode(prisma, orgId, dto.apAccountCode);
    if (!apGl) throw new NotFoundException(`AP GL ${dto.apAccountCode} not found`);

    const bankGl = await this.accountRepo.findByCode(prisma, orgId, dto.bankGlCode);
    if (!bankGl) throw new NotFoundException(`Bank GL ${dto.bankGlCode} not found`);

    const advanceGl = await this.accountRepo.findByCode(prisma, orgId, dto.supplierAdvanceCode);
    if (!advanceGl) throw new NotFoundException(`Supplier Advance GL ${dto.supplierAdvanceCode} not found`);

    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'SUPPLIER_PAYMENT', 'PMT-');

    const totalAmount = new Decimal(payment.totalAmount.toString());
    const allocatedAmount = new Decimal(payment.allocatedAmount.toString());
    const unallocatedAmount = new Decimal(payment.unallocatedAmount.toString());

    try {
      return await prisma.$transaction(async (tx) => {
        const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [];

        if (allocatedAmount.gt(0)) {
          lines.push({
            accountId: apGl.id,
            debitAmount: allocatedAmount,
            creditAmount: new Decimal(0),
            sourceSubledgerType: 'ACCOUNTS_PAYABLE' as const,
            supplierId: payment.supplierId,
          });
        }

        if (unallocatedAmount.gt(0)) {
          lines.push({
            accountId: advanceGl.id,
            debitAmount: unallocatedAmount,
            creditAmount: new Decimal(0),
            supplierId: payment.supplierId,
          });
        }

        lines.push({
          accountId: bankGl.id,
          debitAmount: new Decimal(0),
          creditAmount: totalAmount,
          sourceSubledgerType: 'BANK' as const,
        });

        const postResult = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: payment.accountingDate,
            documentDate: payment.paymentDate,
            description: `Supplier Payment — ${payment.supplierId}`,
            currencyCode: payment.currencyCode,
            eventType: 'EVT-AP-003',
            sourceDocumentType: 'SUPPLIER_PAYMENT',
            sourceDocumentId: payment.id,
            journalCategory: 'CASH_AND_BANK',
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_CASH',
            createdBy: userId,
            lines,
          },
          tx as never,
        );

        const pmtNum = await this.sequenceRepo.claimNext(tx as never, orgId, 'SUPPLIER_PAYMENT');
        await this.paymentRepo.markPosted(tx as never, payment.id, postResult.journalEntryId, pmtNum.formattedNumber, userId);

        // Stamp any pre-created allocations (from create-time dto.allocations[]) with
        // this journal entry id so that the reverse() flow can find and restore them.
        await (tx as never as typeof prisma).supplierPaymentAllocation.updateMany({
          where: { supplierPaymentId: payment.id, postingStatus: 'NOT_POSTED' },
          data: { postingStatus: 'POSTED', journalEntryId: postResult.journalEntryId },
        });

        return { ...postResult, paymentNumber: pmtNum.formattedNumber };
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message.slice(0, 50) : 'POSTING_FAILED';
      await this.paymentRepo.markPostingFailed(prisma, payment.id, code);
      throw err;
    }
  }

  /**
   * Apply supplier advance to a bill.
   * EVT-AP-005: Dr AP / Cr Supplier Advance
   */
  async allocateAdvance(identity: RequestIdentity, dto: AllocateAdvanceDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const payment = await this.paymentRepo.findById(prisma, orgId, dto.paymentId);
    if (!payment) throw new NotFoundException(`SupplierPayment ${dto.paymentId} not found`);
    if (payment.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Payment must be posted before advance allocation`);
    }

    const unallocated = new Decimal(payment.unallocatedAmount.toString());
    const amount = new Decimal(dto.amount);
    if (amount.gt(unallocated)) {
      throw new BadRequestException(`Advance allocation ${amount.toFixed(2)} exceeds unallocated balance ${unallocated.toFixed(2)}`);
    }

    const bill = await this.billRepo.findById(prisma, orgId, dto.supplierBillId);
    if (!bill) throw new NotFoundException(`SupplierBill ${dto.supplierBillId} not found`);
    if (bill.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Bill must be POSTED before advance allocation`);
    }
    if (bill.supplierId !== payment.supplierId) {
      throw new BadRequestException(`Bill supplier does not match payment supplier`);
    }
    if (bill.currencyCode !== payment.currencyCode) {
      throw new BadRequestException(`Bill currency does not match payment currency`);
    }

    const apGl = await this.accountRepo.findByCode(prisma, orgId, dto.apAccountCode);
    if (!apGl) throw new NotFoundException(`AP GL ${dto.apAccountCode} not found`);

    const advanceGl = await this.accountRepo.findByCode(prisma, orgId, dto.supplierAdvanceCode);
    if (!advanceGl) throw new NotFoundException(`Supplier Advance GL ${dto.supplierAdvanceCode} not found`);

    return prisma.$transaction(async (tx) => {
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: payment.accountingDate,
          documentDate: payment.paymentDate,
          description: `Advance Applied — Payment ${payment.id} → Bill ${bill.id}`,
          currencyCode: payment.currencyCode,
          eventType: 'EVT-AP-005',
          sourceDocumentType: 'SUPPLIER_PAYMENT',
          sourceDocumentId: `${payment.id}-alloc-${bill.id}`,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_AP',
          createdBy: userId,
          lines: [
            {
              accountId: apGl.id,
              debitAmount: amount,
              creditAmount: new Decimal(0),
              sourceSubledgerType: 'ACCOUNTS_PAYABLE' as const,
              supplierId: payment.supplierId,
            },
            {
              accountId: advanceGl.id,
              debitAmount: new Decimal(0),
              creditAmount: amount,
              supplierId: payment.supplierId,
            },
          ],
        },
        tx as never,
      );

      const allocation = await this.paymentRepo.createAllocation(tx as never, {
        organizationId: orgId,
        supplierPaymentId: payment.id,
        supplierBillId: bill.id,
        allocatedAmount: amount,
        allocationDate: new Date(),
        journalEntryId: postResult.journalEntryId,
        postingStatus: 'POSTED',
        createdBy: userId,
      });

      const newUnallocated = unallocated.minus(amount);
      const newAllocated = new Decimal(payment.allocatedAmount.toString()).plus(amount);
      await this.paymentRepo.updateAllocations(tx as never, payment.id, newAllocated, newUnallocated);

      const newBillOutstanding = new Decimal(bill.outstandingAmount.toString()).minus(amount);
      await this.billRepo.updateOutstandingAmount(tx as never, bill.id, newBillOutstanding);

      return { ...postResult, allocationId: allocation.id };
    });
  }

  /**
   * Reverse a posted supplier payment.
   * EVT-AP-004: mirror of EVT-AP-003 (Dr Bank / Cr AP / Cr Supplier Advance).
   * Subsequent advance allocations (EVT-AP-005) must be reversed first.
   */
  async reverse(
    identity: RequestIdentity,
    paymentId: string,
    opts: { reversalDate: string; reason: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const payment = await this.paymentRepo.findById(prisma, orgId, paymentId);
    if (!payment) throw new NotFoundException(`SupplierPayment ${paymentId} not found`);
    if (payment.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Only POSTED payments can be reversed (status: ${payment.postingStatus})`);
    }

    // Guard: subsequent advance allocations must be reversed first
    const subsequentAllocs = await prisma.supplierPaymentAllocation.count({
      where: {
        supplierPaymentId: paymentId,
        postingStatus: 'POSTED',
        journalEntryId: { not: payment.postedJournalEntryId },
      },
    });
    if (subsequentAllocs > 0) {
      throw new BadRequestException(
        `Payment ${paymentId} has ${subsequentAllocs} subsequent advance allocation(s) that must be reversed first.`,
      );
    }

    if (!payment.postedJournalEntryId) {
      throw new BadRequestException(`Payment ${paymentId} has no posted journal to reverse`);
    }

    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: payment.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);

    return prisma.$transaction(async (tx) => {
      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of Payment ${payment.paymentNumber ?? paymentId}: ${opts.reason}`,
          currencyCode: payment.currencyCode,
          eventType: 'EVT-AP-004',
          sourceDocumentType: 'SUPPLIER_PAYMENT',
          sourceDocumentId: `reversal-${paymentId}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: payment.postedJournalEntryId ?? undefined,
          createdBy: userId,
          lines: originalJournal.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            supplierId: l.supplierId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      // Reverse initial allocations and restore bill outstanding amounts
      const initialAllocs = await tx.supplierPaymentAllocation.findMany({
        where: { supplierPaymentId: paymentId, journalEntryId: payment.postedJournalEntryId },
      });
      for (const alloc of initialAllocs) {
        await tx.supplierPaymentAllocation.update({
          where: { id: alloc.id },
          data: { postingStatus: 'REVERSED', reversalJournalEntryId: reversalResult.journalEntryId },
        });
        await tx.supplierBill.update({
          where: { id: alloc.supplierBillId },
          data: { outstandingAmount: { increment: alloc.allocatedAmount } },
        });
      }

      await tx.supplierPayment.update({
        where: { id: paymentId },
        data: { postingStatus: 'REVERSED' },
      });

      return reversalResult;
    });
  }

  /**
   * Reverse a supplier advance allocation (EVT-AP-005 → EVT-AP-006).
   * Dr Supplier Advance / Cr AP — mirror of EVT-AP-005.
   */
  async reverseAdvanceAllocation(
    identity: RequestIdentity,
    allocationId: string,
    opts: { apAccountCode: string; supplierAdvanceCode: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const alloc = await prisma.supplierPaymentAllocation.findFirst({
      where: { id: allocationId, organizationId: orgId, postingStatus: 'POSTED' },
    });
    if (!alloc) throw new NotFoundException(`Allocation ${allocationId} not found or not POSTED`);

    const payment = await this.paymentRepo.findById(prisma, orgId, alloc.supplierPaymentId);
    if (!payment) throw new NotFoundException(`Payment not found for allocation`);

    if (alloc.journalEntryId === payment.postedJournalEntryId) {
      throw new BadRequestException(
        `Allocation ${allocationId} is an initial allocation — reverse the payment instead`,
      );
    }

    const apGl = await this.accountRepo.findByCode(prisma, orgId, opts.apAccountCode);
    if (!apGl) throw new NotFoundException(`AP GL ${opts.apAccountCode} not found`);
    const advanceGl = await this.accountRepo.findByCode(prisma, orgId, opts.supplierAdvanceCode);
    if (!advanceGl) throw new NotFoundException(`Supplier Advance GL ${opts.supplierAdvanceCode} not found`);

    const amount = new Decimal(alloc.allocatedAmount.toString());

    return prisma.$transaction(async (tx) => {
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: new Date(),
          documentDate: new Date(),
          description: `Advance Allocation Reversal — Allocation ${allocationId}`,
          currencyCode: payment.currencyCode,
          eventType: 'EVT-AP-006',
          sourceDocumentType: 'SUPPLIER_PAYMENT',
          sourceDocumentId: `alloc-reversal-${allocationId}`,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AP',
          createdBy: userId,
          lines: [
            {
              accountId: advanceGl.id,
              debitAmount: amount,
              creditAmount: new Decimal(0),
              supplierId: payment.supplierId,
            },
            {
              accountId: apGl.id,
              debitAmount: new Decimal(0),
              creditAmount: amount,
              sourceSubledgerType: 'ACCOUNTS_PAYABLE' as const,
              supplierId: payment.supplierId,
            },
          ],
        },
        tx as never,
      );

      await tx.supplierPaymentAllocation.update({
        where: { id: allocationId },
        data: { postingStatus: 'REVERSED', reversalJournalEntryId: postResult.journalEntryId },
      });

      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: {
          allocatedAmount: { decrement: alloc.allocatedAmount },
          unallocatedAmount: { increment: alloc.allocatedAmount },
        },
      });

      await tx.supplierBill.update({
        where: { id: alloc.supplierBillId },
        data: { outstandingAmount: { increment: alloc.allocatedAmount } },
      });

      return postResult;
    });
  }

  async findAll(identity: RequestIdentity, supplierId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.paymentRepo.findAll(prisma, identity.activeOrganizationId, supplierId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const payment = await this.paymentRepo.findById(prisma, identity.activeOrganizationId, id);
    if (!payment) throw new NotFoundException(`SupplierPayment ${id} not found`);
    return payment;
  }
}
