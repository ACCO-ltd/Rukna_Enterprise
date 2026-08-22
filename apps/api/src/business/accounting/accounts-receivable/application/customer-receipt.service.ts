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
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import type { CreateReceiptDto } from '../presentation/dto/create-receipt.dto.js';
import { PaymentReceiptArRepository } from '../infrastructure/payment-receipt-ar.repository.js';
import { ClientInvoiceRepository } from '../infrastructure/client-invoice.repository.js';

// ADR-024 ACC-POST-001: bankAccountCode is an explicit choice (which account received the
// money); arAccountCode/unappliedAccountCode are optional overrides, resolved by role when absent.
export interface PostReceiptDto {
  receiptId: string;
  bankAccountCode: string;
  arAccountCode?: string;
  unappliedAccountCode?: string;
  /** Invoices to allocate at post time — optional; remaining goes to Unapplied */
  allocations?: { clientInvoiceId: string; amount: number }[];
}

export interface AllocateReceiptDto {
  receiptId: string;
  clientInvoiceId: string;
  amount: number;
  arAccountCode?: string;
  unappliedAccountCode?: string;
}

export interface ReverseReceiptDto {
  receiptId: string;
  reversalDate: string;
  reason: string;
  bankAccountCode: string;
  arAccountCode?: string;
  unappliedAccountCode?: string;
}

@Injectable()
export class CustomerReceiptService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly receiptRepo: PaymentReceiptArRepository,
    private readonly invoiceRepo: ClientInvoiceRepository,
    private readonly accountRepo: AccountRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  /**
   * Post a PaymentReceipt to the GL.
   * EVT-AR-003 Branch A (fully allocated): Dr Bank / Cr AR
   * EVT-AR-003 Branch B (partial): Dr Bank / Cr AR (allocated) / Cr Unapplied
   */
  async post(identity: RequestIdentity, dto: PostReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const receipt = await this.receiptRepo.findById(prisma, orgId, dto.receiptId);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${dto.receiptId} not found`);
    if (receipt.postingStatus === 'POSTED') {
      throw new ConflictException(`Receipt ${dto.receiptId} is already posted`);
    }

    // Bank stays an explicit choice (which account received the money); the AR control and
    // unapplied-cash accounts resolve server-side by role (ACC-POST-001), overridable via DTO.
    const bankGl = await this.accountRepo.findByCode(prisma, orgId, dto.bankAccountCode);
    if (!bankGl) throw new NotFoundException(`Bank GL account ${dto.bankAccountCode} not found`);

    const arGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.arAccountCode, 'ACCOUNTS_RECEIVABLE',
    );
    const unappliedGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.unappliedAccountCode, 'UNAPPLIED_CLIENT_RECEIPTS',
    );

    const totalAmount = new Decimal(receipt.totalAmount.toString());

    // Calculate initial allocation
    let allocatedAmount = new Decimal(0);
    const initialAllocations = dto.allocations ?? [];

    for (const alloc of initialAllocations) {
      allocatedAmount = allocatedAmount.plus(new Decimal(alloc.amount));
    }

    if (allocatedAmount.gt(totalAmount)) {
      throw new BadRequestException(
        `Total allocations ${allocatedAmount.toFixed(2)} exceed receipt amount ${totalAmount.toFixed(2)}`,
      );
    }

    const unallocatedAmount = totalAmount.minus(allocatedAmount);

    return prisma.$transaction(async (tx) => {
      const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
        {
          accountId: bankGl.id,
          debitAmount: totalAmount,
          creditAmount: new Decimal(0),
          sourceSubledgerType: 'BANK',
        },
      ];

      if (allocatedAmount.gt(0)) {
        lines.push({
          accountId: arGl.id,
          debitAmount: new Decimal(0),
          creditAmount: allocatedAmount,
          sourceSubledgerType: 'ACCOUNTS_RECEIVABLE',
          clientId: receipt.clientId,
        });
      }

      if (unallocatedAmount.gt(0)) {
        lines.push({
          accountId: unappliedGl.id,
          debitAmount: new Decimal(0),
          creditAmount: unallocatedAmount,
          clientId: receipt.clientId,
        });
      }

      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: receipt.accountingDate,
          documentDate: receipt.receiptDate,
          description: `Customer Receipt — ${receipt.id}`,
          currencyCode: receipt.currencyCode,
          eventType: 'EVT-AR-003',
          sourceDocumentType: 'PAYMENT_RECEIPT',
          sourceDocumentId: receipt.id,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: userId,
          lines,
        },
        tx as never,
      );

      await this.receiptRepo.markPosted(
        prisma, receipt.id, postResult.journalEntryId, userId,
        allocatedAmount, unallocatedAmount,
      );

      // Create initial allocation records
      for (const alloc of initialAllocations) {
        const invoice = await this.invoiceRepo.findById(prisma, orgId, alloc.clientInvoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${alloc.clientInvoiceId} not found`);
        this.assertAllocatable(receipt, invoice, new Decimal(alloc.amount));

        await this.receiptRepo.createAllocation(prisma, {
          organizationId: orgId,
          paymentReceiptId: receipt.id,
          clientInvoiceId: alloc.clientInvoiceId,
          allocatedAmount: new Decimal(alloc.amount),
          allocationDate: receipt.accountingDate,
          journalEntryId: postResult.journalEntryId,
          postingStatus: 'POSTED',
          createdBy: userId,
        });

        // Update invoice outstanding
        const newOutstanding = new Decimal(invoice.outstandingAmount.toString()).minus(new Decimal(alloc.amount));
        await this.invoiceRepo.updateOutstandingAmount(prisma, invoice.id, newOutstanding);
      }

      return postResult;
    });
  }

  /**
   * A receipt may only settle an invoice that is the SAME client, SAME currency, already POSTED,
   * and by no more than the invoice's remaining outstanding. Without these, a receipt could settle
   * another client's debt, cross currencies, pay an unrecognised (unposted) receivable, or drive
   * `outstandingAmount` negative. Applies to milestone (installment) invoices and IPC invoices alike.
   */
  private assertAllocatable(
    receipt: { clientId: string; currencyCode: string },
    invoice: {
      clientId: string;
      currencyCode: string;
      postingStatus: string;
      outstandingAmount: Decimal | string;
    },
    amount: Decimal,
  ): void {
    if (invoice.clientId !== receipt.clientId) {
      throw new BadRequestException(
        'Cannot allocate: the invoice belongs to a different client than the receipt.',
      );
    }
    if (invoice.currencyCode !== receipt.currencyCode) {
      throw new BadRequestException(
        `Currency mismatch: receipt is ${receipt.currencyCode}, invoice is ${invoice.currencyCode}.`,
      );
    }
    if (invoice.postingStatus !== 'POSTED') {
      throw new BadRequestException('Invoice must be POSTED before allocation.');
    }
    const outstanding = new Decimal(invoice.outstandingAmount.toString());
    if (amount.gt(outstanding)) {
      throw new BadRequestException(
        `Allocation ${amount.toFixed(2)} exceeds the invoice outstanding ${outstanding.toFixed(2)}.`,
      );
    }
  }

  /**
   * Subsequent allocation: allocate unallocated receipt amount to an invoice.
   * EVT-AR-005: Dr Unapplied / Cr AR
   */
  async allocate(identity: RequestIdentity, dto: AllocateReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const receipt = await this.receiptRepo.findById(prisma, orgId, dto.receiptId);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${dto.receiptId} not found`);
    if (receipt.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Receipt must be posted before subsequent allocation`);
    }

    const unallocated = new Decimal(receipt.unallocatedAmount.toString());
    const amount = new Decimal(dto.amount);

    if (amount.gt(unallocated)) {
      throw new BadRequestException(
        `Allocation amount ${amount.toFixed(2)} exceeds unallocated balance ${unallocated.toFixed(2)}`,
      );
    }

    const invoice = await this.invoiceRepo.findById(prisma, orgId, dto.clientInvoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${dto.clientInvoiceId} not found`);
    this.assertAllocatable(receipt, invoice, amount);

    const arGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.arAccountCode, 'ACCOUNTS_RECEIVABLE',
    );
    const unappliedGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.unappliedAccountCode, 'UNAPPLIED_CLIENT_RECEIPTS',
    );

    return prisma.$transaction(async (tx) => {
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: receipt.accountingDate,
          documentDate: receipt.receiptDate,
          description: `Receipt Allocation — Receipt ${receipt.id} → Invoice ${invoice.id}`,
          currencyCode: receipt.currencyCode,
          eventType: 'EVT-AR-005',
          sourceDocumentType: 'PAYMENT_RECEIPT',
          sourceDocumentId: `${receipt.id}-alloc-${invoice.id}`,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_AR',
          createdBy: userId,
          lines: [
            {
              accountId: unappliedGl.id,
              debitAmount: amount,
              creditAmount: new Decimal(0),
              clientId: receipt.clientId,
            },
            {
              accountId: arGl.id,
              debitAmount: new Decimal(0),
              creditAmount: amount,
              sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const,
              clientId: receipt.clientId,
            },
          ],
        },
        tx as never,
      );

      await this.receiptRepo.createAllocation(prisma, {
        organizationId: orgId,
        paymentReceiptId: receipt.id,
        clientInvoiceId: invoice.id,
        allocatedAmount: amount,
        allocationDate: new Date(),
        journalEntryId: postResult.journalEntryId,
        postingStatus: 'POSTED',
        createdBy: userId,
      });

      const newUnallocated = unallocated.minus(amount);
      const newAllocated = new Decimal(receipt.allocatedAmount.toString()).plus(amount);
      await this.receiptRepo.updateAllocations(prisma, receipt.id, newAllocated, newUnallocated);

      const newOutstanding = new Decimal(invoice.outstandingAmount.toString()).minus(amount);
      await this.invoiceRepo.updateOutstandingAmount(prisma, invoice.id, newOutstanding);

      return postResult;
    });
  }

  /**
   * Reverse a posted customer receipt.
   * EVT-AR-004: mirror of EVT-AR-003 (swap debit/credit on all original lines).
   * All initial allocations are reversed together with the receipt.
   * Subsequent allocations (EVT-AR-005) must be individually reversed first.
   */
  async reverse(
    identity: RequestIdentity,
    receiptId: string,
    opts: { reversalDate: string; reason: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const receipt = await this.receiptRepo.findById(prisma, orgId, receiptId);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${receiptId} not found`);
    if (receipt.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Only POSTED receipts can be reversed (status: ${receipt.postingStatus})`);
    }

    // Guard: subsequent allocations (EVT-AR-005) must be reversed first
    const subsequentAllocs = await prisma.clientReceiptAllocation.count({
      where: {
        paymentReceiptId: receiptId,
        postingStatus: 'POSTED',
        journalEntryId: { not: receipt.postedJournalEntryId },
      },
    });
    if (subsequentAllocs > 0) {
      throw new BadRequestException(
        `Receipt ${receiptId} has ${subsequentAllocs} subsequent allocation(s) that must be reversed first.`,
      );
    }

    if (!receipt.postedJournalEntryId) {
      throw new BadRequestException(`Receipt ${receiptId} has no posted journal to reverse`);
    }

    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: receipt.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);

    return prisma.$transaction(async (tx) => {
      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of Receipt ${receiptId}: ${opts.reason}`,
          currencyCode: receipt.currencyCode,
          eventType: 'EVT-AR-004',
          sourceDocumentType: 'PAYMENT_RECEIPT',
          sourceDocumentId: `reversal-${receiptId}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: receipt.postedJournalEntryId ?? undefined,
          createdBy: userId,
          lines: originalJournal.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      // Reverse initial allocations and restore invoice outstanding amounts
      const initialAllocs = await tx.clientReceiptAllocation.findMany({
        where: { paymentReceiptId: receiptId, journalEntryId: receipt.postedJournalEntryId },
      });
      for (const alloc of initialAllocs) {
        await tx.clientReceiptAllocation.update({
          where: { id: alloc.id },
          data: { postingStatus: 'REVERSED', reversalJournalEntryId: reversalResult.journalEntryId },
        });
        // Restore invoice outstanding amount
        await tx.clientInvoice.update({
          where: { id: alloc.clientInvoiceId },
          data: {
            outstandingAmount: {
              increment: alloc.allocatedAmount,
            },
          },
        });
      }

      await tx.paymentReceipt.update({
        where: { id: receiptId },
        data: {
          postingStatus: 'REVERSED',
          allocatedAmount: new Decimal(0),
          unallocatedAmount: new Decimal(0),
        },
      });

      return reversalResult;
    });
  }

  /**
   * Reverse a subsequent allocation (EVT-AR-005 → EVT-AR-006).
   * Dr AR / Cr Unapplied — mirror of EVT-AR-005.
   */
  // ADR-024 ACC-POST-001: arAccountCode/unappliedAccountCode are optional overrides.
  async reverseAllocation(
    identity: RequestIdentity,
    allocationId: string,
    opts: { arAccountCode?: string; unappliedAccountCode?: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const alloc = await prisma.clientReceiptAllocation.findFirst({
      where: { id: allocationId, organizationId: orgId, postingStatus: 'POSTED' },
    });
    if (!alloc) throw new NotFoundException(`Allocation ${allocationId} not found or not POSTED`);

    const receipt = await this.receiptRepo.findById(prisma, orgId, alloc.paymentReceiptId);
    if (!receipt) throw new NotFoundException(`Receipt not found for allocation`);

    // Must be a subsequent allocation (not the initial one)
    if (alloc.journalEntryId === receipt.postedJournalEntryId) {
      throw new BadRequestException(
        `Allocation ${allocationId} is an initial allocation — reverse the receipt instead`,
      );
    }

    const arGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, opts.arAccountCode, 'ACCOUNTS_RECEIVABLE',
    );
    const unappliedGl = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, opts.unappliedAccountCode, 'UNAPPLIED_CLIENT_RECEIPTS',
    );

    const amount = new Decimal(alloc.allocatedAmount.toString());

    return prisma.$transaction(async (tx) => {
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: new Date(),
          documentDate: new Date(),
          description: `Allocation Reversal — Allocation ${allocationId}`,
          currencyCode: receipt.currencyCode,
          eventType: 'EVT-AR-006',
          sourceDocumentType: 'PAYMENT_RECEIPT',
          sourceDocumentId: `alloc-reversal-${allocationId}`,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          createdBy: userId,
          lines: [
            {
              accountId: arGl.id,
              debitAmount: amount,
              creditAmount: new Decimal(0),
              sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const,
              clientId: receipt.clientId,
            },
            {
              accountId: unappliedGl.id,
              debitAmount: new Decimal(0),
              creditAmount: amount,
              clientId: receipt.clientId,
            },
          ],
        },
        tx as never,
      );

      await tx.clientReceiptAllocation.update({
        where: { id: allocationId },
        data: { postingStatus: 'REVERSED', reversalJournalEntryId: postResult.journalEntryId },
      });

      // Restore receipt unallocated balance
      await tx.paymentReceipt.update({
        where: { id: receipt.id },
        data: {
          allocatedAmount: { decrement: alloc.allocatedAmount },
          unallocatedAmount: { increment: alloc.allocatedAmount },
        },
      });

      // Restore invoice outstanding amount
      await tx.clientInvoice.update({
        where: { id: alloc.clientInvoiceId },
        data: { outstandingAmount: { increment: alloc.allocatedAmount } },
      });

      return postResult;
    });
  }

  // ACC-SET-001 BE-2: receipt creation moved here from the retired finance module. No separate
  // accounting date is captured on the receipt form, so the receipt date is its accounting date.
  async create(identity: RequestIdentity, dto: CreateReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const receiptDate = new Date(dto.receiptDate);
    return this.receiptRepo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      clientId: dto.clientId,
      receiptDate,
      accountingDate: receiptDate,
      totalAmount: dto.amount,
      currencyCode: dto.currency,
      reference: dto.reference,
      notes: dto.notes,
      createdBy: identity.userId,
    });
  }

  async findAll(identity: RequestIdentity, clientId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.receiptRepo.findAll(prisma, identity.activeOrganizationId, clientId);
  }

  // ACC-SET-001 — IPC payment status derived from the invoice raised off it (moved from finance).
  async getCertificatePaymentStatus(identity: RequestIdentity, certificateId: string) {
    const prisma = this.tenancyService.getClient();
    const cert = await prisma.interimPaymentCertificate.findFirst({
      where: { id: certificateId, organizationId: identity.activeOrganizationId },
      select: { id: true },
    });
    if (!cert) throw new NotFoundException(`Certificate ${certificateId} not found`);
    return this.receiptRepo.getCertificatePaymentSummary(prisma, certificateId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const receipt = await this.receiptRepo.findById(prisma, identity.activeOrganizationId, id);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${id} not found`);
    // The controller documents "with allocations" — include the invoice allocations so the
    // receipt workspace can render and reverse them (ACC-SET-001 FE-1).
    const allocations = await this.receiptRepo.findAllocationsByReceipt(prisma, receipt.id);
    return { ...receipt, allocations };
  }
}
