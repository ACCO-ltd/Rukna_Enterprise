import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  ACCOUNT_KIND_FOR_METHOD,
  RECEIPT_PAYMENT_METHODS,
  describeInstrument,
  normaliseDetails,
  paymentDetailProblems,
  type NormalisedDetails,
  type PaymentDetails,
  type ReceiptPaymentMethod,
} from '../domain/receipt-payment-method.js';

/** A new receipt's fields that the payment-method rules read (PM-1). */
type RecordableReceipt = PaymentDetails & {
  clientId: string;
  amount: string;
  currency: string;
  receiptDate: string;
  paymentMethod?: string;
};

const NO_DETAILS: NormalisedDetails = {
  instrumentNumber: null, issuer: null, instrumentDate: null, payerName: null, payerAccount: null, receivedBy: null,
};

// ADR-024 ACC-POST-001: bankAccountCode is an explicit choice (which account received the
// money); arAccountCode/unappliedAccountCode are optional overrides, resolved by role when absent.
export interface PostReceiptDto {
  receiptId: string;
  /** The registered bank account the money landed in (RC-3); `bankAccountCode` names it by GL code. */
  bankAccountId?: string;
  bankAccountCode?: string;
  /** PM-4 — the day a cheque on hand is deposited (today when omitted); it posts on that date. */
  depositDate?: string;
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
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  /**
   * The receipt's document number (RCP-000123), claimed in the transaction that posts it so a
   * rolled-back post never burns a number. The sequence is created on first use.
   */
  private async claimReceiptNumber(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
    await this.sequenceRepo.ensureSequence(tx as never, orgId, 'PAYMENT_RECEIPT', 'RCP-');
    const claimed = await this.sequenceRepo.claimNext(tx as never, orgId, 'PAYMENT_RECEIPT');
    return claimed.formattedNumber;
  }

  /**
   * Post a PaymentReceipt to the GL.
   * EVT-AR-003 Branch A (fully allocated): Dr Bank / Cr AR
   * EVT-AR-003 Branch B (partial): Dr Bank / Cr AR (allocated) / Cr Unapplied
   */
  async post(identity: RequestIdentity, dto: PostReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const receipt = await this.receiptRepo.findById(prisma, orgId, dto.receiptId);
    if (!receipt) throw new NotFoundException({ errorCode: 'RECEIPT_NOT_FOUND', message: `Receipt ${dto.receiptId} not found` });
    // RC-1: only a receipt that was never posted can be posted. A REVERSED one used to pass: the
    // ledger's idempotency guard handed back the original (reversed) journal, so nothing reached the
    // GL while the invoices were paid again and a new number was claimed (subledger ≠ GL).
    this.assertPostable(receipt);

    // RC-3: the money lands in a registered bank account that takes receipts, in the receipt's
    // currency — the same checks as Receive payment. The AR control and unapplied-cash accounts
    // resolve server-side by role (ACC-POST-001), overridable via DTO.
    const bank = await this.receivingBank(prisma, orgId, dto, receipt.currencyCode, receipt.paymentMethod);
    const bankGl = { id: bank.glAccount.id };
    const postingDate = this.depositDay(receipt, dto.depositDate);

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
    const ids = initialAllocations.map((a) => a.clientInvoiceId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An invoice is listed twice; combine its amounts into one line.');
    }

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
      // RC-1: claim the receipt first. The row lock makes a second post at the same moment wait,
      // then match nothing (it is POSTED by then) — one journal, one number, one set of allocations.
      const claimed = await tx.paymentReceipt.updateMany({
        where: { id: receipt.id, postingStatus: 'NOT_POSTED', documentStatus: { not: 'CANCELLED' } },
        data: { bankAccountId: bank.id, accountingDate: postingDate, lastPostingAttemptAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({ errorCode: 'RECEIPT_ALREADY_POSTED', message: 'This receipt was posted or cancelled a moment ago. Reload it.' });
      }

      const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
        {
          accountId: bankGl.id,
          debitAmount: totalAmount,
          creditAmount: new Decimal(0),
          sourceSubledgerType: 'BANK',
          // Step 6 (fix forward): the bank line names who paid, like the AR line it balances.
          clientId: receipt.clientId,
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

      // Claimed before posting (same transaction) so the journal names the receipt's number.
      const receiptNumber = await this.claimReceiptNumber(tx, orgId);
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: postingDate,
          documentDate: receipt.receiptDate,
          description: `Customer receipt ${receiptNumber}`,
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

      // Everything below runs on `tx`, with the journal entry: it used the outer client before, so
      // a failure part-way could leave a POSTED receipt without its allocations (and the receipt row
      // locked by this transaction would block the outer client's allocation writes).
      await this.receiptRepo.markPosted(
        tx as never, receipt.id, postResult.journalEntryId, userId,
        allocatedAmount, unallocatedAmount, receiptNumber,
      );

      // Create initial allocation records
      for (const alloc of initialAllocations) {
        const invoice = await this.invoiceRepo.findById(tx as never, orgId, alloc.clientInvoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${alloc.clientInvoiceId} not found`);
        this.assertAllocatable(receipt, invoice, new Decimal(alloc.amount));

        await this.receiptRepo.createAllocation(tx as never, {
          organizationId: orgId,
          paymentReceiptId: receipt.id,
          clientInvoiceId: alloc.clientInvoiceId,
          allocatedAmount: new Decimal(alloc.amount),
          allocationDate: postingDate,
          journalEntryId: postResult.journalEntryId,
          postingStatus: 'POSTED',
          createdBy: userId,
        });

        // Guarded decrement (as in allocate): a payment applied to the same invoice meanwhile can
        // no longer be overwritten by a balance read before it.
        const amount = new Decimal(alloc.amount);
        const drawn = await tx.clientInvoice.updateMany({
          where: { id: invoice.id, outstandingAmount: { gte: amount } },
          data: { outstandingAmount: { decrement: amount } },
        });
        if (drawn.count === 0) {
          throw new ConflictException(`Invoice ${invoice.invoiceNumber ?? invoice.id} was paid while this receipt was being posted. Reload and try again.`);
        }
      }

      return postResult;
    });
  }

  /** RC-1 — a receipt can be posted once: never after posting, reversal or cancellation. */
  private assertPostable(receipt: { postingStatus: string; documentStatus: string }): void {
    if (receipt.documentStatus === 'CANCELLED') {
      throw new ConflictException({ errorCode: 'RECEIPT_CANCELLED', message: 'This receipt was cancelled and cannot be posted.' });
    }
    if (receipt.postingStatus !== 'NOT_POSTED') {
      throw new ConflictException({
        errorCode: 'RECEIPT_ALREADY_POSTED',
        message: receipt.postingStatus === 'REVERSED'
          ? 'This receipt was reversed. Record a new receipt instead.'
          : 'This receipt is already posted.',
      });
    }
  }

  /**
   * RC-3 — the registered bank account a receipt lands in, by id or by its GL code: active, taking
   * receipts and in the receipt's currency (B-1 checked this for payments and refunds only).
   */
  private async receivingBank(
    prisma: Prisma.TransactionClient,
    orgId: string,
    ref: { bankAccountId?: string; bankAccountCode?: string },
    currency: string,
    method?: string | null,
  ) {
    if (!ref.bankAccountId && !ref.bankAccountCode) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_REQUIRED', message: 'Choose the bank account the money arrived in.' });
    }
    const bank = await prisma.bankAccount.findFirst({
      where: ref.bankAccountId
        ? { id: ref.bankAccountId, organizationId: orgId }
        : { organizationId: orgId, glAccount: { code: ref.bankAccountCode } },
      include: { glAccount: { select: { id: true, code: true } } },
    });
    if (!bank) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: 'That bank account was not found.' });
    if (bank.status !== 'ACTIVE' || !bank.allowsReceipts) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_NOT_RECEIVING', message: `${bank.accountName} does not accept receipts.` });
    }
    if (bank.currencyCode !== currency) {
      throw new BadRequestException({
        errorCode: 'CURRENCY_MISMATCH',
        message: `${bank.accountName} holds ${bank.currencyCode}; this payment is ${currency}.`,
      });
    }
    // PM-3 — cash lands in a cash box, mobile money in a wallet, the rest in a bank account.
    const kind = method ? ACCOUNT_KIND_FOR_METHOD[method as ReceiptPaymentMethod] : undefined;
    if (kind && bank.kind !== kind) {
      const where = { BANK: 'a bank account', CASH: 'a cash box', MOBILE_WALLET: 'a mobile-money wallet' }[kind];
      throw new BadRequestException({
        errorCode: 'BANK_ACCOUNT_WRONG_KIND',
        message: `This payment method is received into ${where}; ${bank.accountName} is not one.`,
      });
    }
    return bank;
  }

  /**
   * PM-4 — the day a receipt posts. A cheque dated later than the receipt is a cheque on hand: it
   * posts when deposited (`depositDate`, today by default), never before the cheque date.
   */
  private depositDay(
    receipt: { paymentMethod: string | null; instrumentDate: Date | null; accountingDate: Date },
    depositDate?: string,
  ): Date {
    const onHand =
      receipt.paymentMethod === 'CHEQUE' && receipt.instrumentDate && receipt.instrumentDate.getTime() > receipt.accountingDate.getTime();
    if (!onHand) return receipt.accountingDate;
    const day = new Date(depositDate ?? new Date().toISOString().slice(0, 10));
    if (day.getTime() < receipt.instrumentDate!.getTime()) {
      throw new BadRequestException({
        errorCode: 'CHEQUE_NOT_DUE',
        message: `This cheque is dated ${receipt.instrumentDate!.toISOString().slice(0, 10)}; it can be deposited from that day.`,
      });
    }
    return day;
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

    // The application happens when both source documents exist: the later of the invoice date and
    // the receipt's accounting date (never the clock) — the AR mirror of ADR-045 review H2. Dating
    // it on the receipt alone put an application to an invoice raised months later into the
    // (possibly closed) receipt month, so it could never post.
    const applicationDay =
      invoice.invoiceDate.getTime() > receipt.accountingDate.getTime()
        ? invoice.invoiceDate
        : receipt.accountingDate;

    return prisma.$transaction(async (tx) => {
      // The allocation row is created first so its id keys the GL journal. Keying the journal on
      // the receipt→invoice pair made a second allocation of the same pair (or a re-allocation
      // after a reversal) hit the posting idempotency guard: the guard returned the first journal
      // while the balances below were drawn down again, so the subledger drifted from the GL.
      const allocation = await this.receiptRepo.createAllocation(tx as never, {
        organizationId: orgId,
        paymentReceiptId: receipt.id,
        clientInvoiceId: invoice.id,
        allocatedAmount: amount,
        allocationDate: applicationDay,
        postingStatus: 'POSTED',
        createdBy: userId,
      });

      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: applicationDay,
          documentDate: applicationDay,
          description: `Receipt ${receipt.receiptNumber ?? receipt.id} applied to invoice ${invoice.invoiceNumber ?? invoice.id}`,
          currencyCode: receipt.currencyCode,
          eventType: 'EVT-AR-005',
          sourceDocumentType: 'PAYMENT_RECEIPT',
          sourceDocumentId: `${receipt.id}-alloc-${allocation.id}`,
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

      // All subledger side-effects run on `tx` (not the outer `prisma` client) so they commit or
      // roll back with the GL journal above. Writing them on `prisma` left the allocation row,
      // receipt balances, and invoice outstanding committed independently of a rolled-back journal
      // — the same defect fixed for the receipt-post path in 4eb64e1.
      await this.receiptRepo.linkAllocationJournal(tx as never, allocation.id, postResult.journalEntryId);

      // Guarded atomic decrements: the `gte` predicate + decrement execute as one row-locked
      // statement, so two concurrent allocations of the same receipt (or against the same invoice)
      // cannot both draw down the same balance. Once a balance is exhausted the WHERE matches zero
      // rows and we roll back. Replaces a read-then-blind-write that lost updates under concurrency.
      const receiptUpd = await tx.paymentReceipt.updateMany({
        where: { id: receipt.id, unallocatedAmount: { gte: amount } },
        data: { unallocatedAmount: { decrement: amount }, allocatedAmount: { increment: amount } },
      });
      if (receiptUpd.count === 0) {
        throw new ConflictException(
          `Receipt ${receipt.id} unallocated balance changed concurrently — allocation ${amount.toFixed(2)} no longer fits. Retry.`,
        );
      }

      const invoiceUpd = await tx.clientInvoice.updateMany({
        where: { id: invoice.id, outstandingAmount: { gte: amount } },
        data: { outstandingAmount: { decrement: amount } },
      });
      if (invoiceUpd.count === 0) {
        throw new ConflictException(
          `Invoice ${invoice.id} outstanding changed concurrently — allocation ${amount.toFixed(2)} exceeds it now. Retry.`,
        );
      }

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
    if (!receipt) throw new NotFoundException({ errorCode: 'RECEIPT_NOT_FOUND', message: `Receipt ${receiptId} not found` });
    if (receipt.postingStatus !== 'POSTED') {
      throw new BadRequestException({
        errorCode: 'RECEIPT_NOT_POSTED',
        message: `Only a posted receipt can be reversed (status: ${receipt.postingStatus}).`,
      });
    }
    const reason = opts.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException({ errorCode: 'REVERSAL_REASON_REQUIRED', message: 'Say why the receipt is reversed.' });
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
      throw new BadRequestException({
        errorCode: 'RECEIPT_HAS_LATER_ALLOCATIONS',
        message: `This receipt was applied to invoices after it was posted (${subsequentAllocs}). Undo those applications first, then reverse the receipt.`,
        details: { count: subsequentAllocs },
      });
    }

    // AR-5 — cash already paid back from this receipt left the bank; undo the refund first.
    const postedRefunds = await prisma.clientRefund.count({ where: { receiptId, status: 'POSTED' } });
    if (postedRefunds > 0) {
      throw new BadRequestException({
        errorCode: 'RECEIPT_HAS_REFUNDS',
        message: 'Money from this receipt was paid back to the client. Reverse the refund first, then the receipt.',
      });
    }

    if (!receipt.postedJournalEntryId) {
      throw new BadRequestException(`Receipt ${receiptId} has no posted journal to reverse`);
    }

    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: receipt.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);
    // RC-4: the money cannot bounce before it arrived; a reversal dated earlier took cash out of a
    // period the receipt never touched.
    if (reversalDate.getTime() < receipt.accountingDate.getTime()) {
      throw new BadRequestException({
        errorCode: 'REVERSAL_BEFORE_RECEIPT',
        message: `The reversal date cannot be before the receipt date (${receipt.accountingDate.toISOString().slice(0, 10)}).`,
      });
    }

    return prisma.$transaction(async (tx) => {
      // RC-4: claim the receipt (row lock), so a second reversal at the same moment matches nothing
      // instead of restoring the invoices' balances twice.
      const claimed = await tx.paymentReceipt.updateMany({
        where: { id: receiptId, postingStatus: 'POSTED' },
        data: { postingStatus: 'REVERSED' },
      });
      if (claimed.count === 0) {
        throw new ConflictException({ errorCode: 'RECEIPT_NOT_POSTED', message: 'This receipt was reversed a moment ago. Reload it.' });
      }

      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of receipt ${receipt.receiptNumber ?? receiptId}: ${reason}`,
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
          reversedAt: new Date(),
          reversedBy: userId,
          reversalReason: reason,
          reversalJournalEntryId: reversalResult.journalEntryId,
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
    receiptId?: string,
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const alloc = await prisma.clientReceiptAllocation.findFirst({
      where: { id: allocationId, organizationId: orgId, postingStatus: 'POSTED' },
    });
    if (!alloc) throw new NotFoundException(`Allocation ${allocationId} not found or not POSTED`);
    if (receiptId && alloc.paymentReceiptId !== receiptId) {
      throw new NotFoundException(`Allocation ${allocationId} is not on receipt ${receiptId}`);
    }

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
    const invoiceNumber =
      (await prisma.clientInvoice.findUnique({ where: { id: alloc.clientInvoiceId }, select: { invoiceNumber: true } }))
        ?.invoiceNumber ?? alloc.clientInvoiceId;

    return prisma.$transaction(async (tx) => {
      // RC-4: claim the allocation (row lock) so a double click cannot restore the balances twice.
      const claimed = await tx.clientReceiptAllocation.updateMany({
        where: { id: allocationId, postingStatus: 'POSTED' },
        data: { postingStatus: 'REVERSED' },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This application was undone a moment ago. Reload the receipt.');
      }

      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          // Reversal mirrors the source allocation's period (its allocationDate), never today's
          // date — a `new Date()` here mis-periods AR and can be rejected outright when the current
          // period is closed. Enforces feedback-accounting-date-rule.
          accountingDate: alloc.allocationDate,
          documentDate: alloc.allocationDate,
          description: `Undo: receipt ${receipt.receiptNumber ?? receipt.id} applied to invoice ${invoiceNumber}`,
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

  /**
   * Create and immediately post a receipt in one atomic operation, reusing the caller's
   * `Prisma.TransactionClient` so the GL journal, allocation records, and invoice outstanding
   * updates all commit or roll back with the outer transaction.
   *
   * Callers:
   *  - `CommercialBillingService.recordProjectPayment` — wraps this in a prisma.$transaction that
   *    also records an audit event, so everything is one DB commit.
   *
   * Follows EVT-AR-003 Branch A (fully allocated) / Branch B (partial / fully unapplied):
   *   Dr Bank / Cr AR (allocated part) / Cr Unapplied (remainder)
   */
  async createAndPost(
    identity: RequestIdentity,
    dto: {
      clientId: string;
      bankAccountId: string;
      bankAccountCode: string;
      receiptDate: string;
      amount: string;
      currency: string;
      paymentMethod?: string;
      reference?: string;
      notes?: string;
      /** PM-1 — the method's proof, already checked and normalised. */
      details?: NormalisedDetails;
      allocations: Array<{ clientInvoiceId: string; amount: number }>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ receiptId: string; journalEntryId: string }> {
    const { activeOrganizationId: orgId, userId } = identity;
    const ZERO = new Decimal(0);

    const bankGl = await this.accountRepo.findByCode(tx as never, orgId, dto.bankAccountCode);
    if (!bankGl) throw new NotFoundException(`Bank GL account ${dto.bankAccountCode} not found`);

    const arGl = await this.resolver.resolveByCodeOrRole(tx as never, orgId, undefined, 'ACCOUNTS_RECEIVABLE');
    const unappliedGl = await this.resolver.resolveByCodeOrRole(tx as never, orgId, undefined, 'UNAPPLIED_CLIENT_RECEIPTS');

    const receiptDate = new Date(dto.receiptDate);
    const totalAmount = new Decimal(dto.amount);
    const allocatedAmount = dto.allocations.reduce((s, a) => s.plus(new Decimal(a.amount)), ZERO);
    const unallocatedAmount = totalAmount.minus(allocatedAmount);

    if (allocatedAmount.gt(totalAmount)) {
      throw new BadRequestException(
        `Total allocations ${allocatedAmount.toFixed(2)} exceed receipt amount ${totalAmount.toFixed(2)}`,
      );
    }

    // 1. Create receipt row inside tx
    const receipt = await tx.paymentReceipt.create({
      data: {
        organizationId: orgId,
        clientId: dto.clientId,
        bankAccountId: dto.bankAccountId,
        receiptDate,
        accountingDate: receiptDate,
        totalAmount,
        allocatedAmount: ZERO,
        unallocatedAmount: totalAmount,
        currencyCode: dto.currency,
        paymentMethod: dto.paymentMethod ?? null,
        ...(dto.details ?? NO_DETAILS),
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });

    // 2. GL journal lines (EVT-AR-003)
    const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
      { accountId: bankGl.id, debitAmount: totalAmount, creditAmount: ZERO, sourceSubledgerType: 'BANK', clientId: dto.clientId },
    ];
    if (allocatedAmount.gt(ZERO)) {
      lines.push({
        accountId: arGl.id,
        debitAmount: ZERO,
        creditAmount: allocatedAmount,
        sourceSubledgerType: 'ACCOUNTS_RECEIVABLE',
        clientId: dto.clientId,
      });
    }
    if (unallocatedAmount.gt(ZERO)) {
      lines.push({
        accountId: unappliedGl.id,
        debitAmount: ZERO,
        creditAmount: unallocatedAmount,
        clientId: dto.clientId,
      });
    }

    // 3. Post to GL inside same tx
    // Claimed before posting (same transaction) so the journal names the receipt's number.
    const receiptNumber = await this.claimReceiptNumber(tx, orgId);
    const postResult = await this.postingPort.post(
      {
        organizationId: orgId,
        accountingDate: receiptDate,
        documentDate: receiptDate,
        description: `Customer receipt ${receiptNumber}`,
        currencyCode: dto.currency,
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

    // 4. Mark receipt POSTED, with its document number
    await tx.paymentReceipt.update({
      where: { id: receipt.id },
      data: {
        receiptNumber,
        postingStatus: 'POSTED',
        postedJournalEntryId: postResult.journalEntryId,
        postedAt: new Date(),
        postedBy: userId,
        allocatedAmount,
        unallocatedAmount,
      },
    });

    // 5. Create initial allocation rows + reduce invoice outstanding
    for (const alloc of dto.allocations) {
      await tx.clientReceiptAllocation.create({
        data: {
          organizationId: orgId,
          paymentReceiptId: receipt.id,
          clientInvoiceId: alloc.clientInvoiceId,
          allocatedAmount: new Decimal(alloc.amount),
          allocationDate: receiptDate,
          journalEntryId: postResult.journalEntryId,
          postingStatus: 'POSTED',
          createdBy: userId,
        },
      });
      await tx.clientInvoice.update({
        where: { id: alloc.clientInvoiceId },
        data: { outstandingAmount: { decrement: new Decimal(alloc.amount) } },
      });
    }

    return { receiptId: receipt.id, journalEntryId: postResult.journalEntryId };
  }

  /**
   * ADR-046 §6 — Receive payment: the money lands straight in the chosen bank account. Records,
   * posts (EVT-AR-003, Dr that bank's GL account) and applies the receipt in one transaction — no
   * holding account, no separate Post step. Each allocation must be a posted invoice of this
   * client, in the receipt's currency, within its outstanding balance (CONST: allocation guards).
   */
  async receive(
    identity: RequestIdentity,
    dto: {
      clientId: string;
      bankAccountId: string;
      receiptDate: string;
      amount: string;
      currency: string;
      paymentMethod?: string;
      reference?: string;
      notes?: string;
      allocations?: Array<{ clientInvoiceId: string; amount: number }>;
    } & PaymentDetails,
  ) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const ZERO = new Decimal(0);
    const allocations = dto.allocations ?? [];

    const total = new Decimal(dto.amount);
    const details = await this.assertRecordable(prisma, orgId, dto);

    const bank = await this.receivingBank(prisma, orgId, { bankAccountId: dto.bankAccountId }, dto.currency, dto.paymentMethod);

    // PM-4 — a cheque dated after the day it is received is held, not banked: it is recorded with
    // its bank account and posts when deposited (Post → Deposit), on or after the cheque date.
    if (details.instrumentDate && dto.paymentMethod === 'CHEQUE' && details.instrumentDate.getTime() > new Date(dto.receiptDate).getTime()) {
      const held = await this.saveReceipt(prisma, identity, dto, details, bank.id);
      return this.findById(identity, held.id);
    }

    const ids = allocations.map((a) => a.clientInvoiceId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An invoice is listed twice; combine its amounts into one line.');
    }
    const applied = allocations.reduce((sum, a) => sum.plus(new Decimal(a.amount)), ZERO);
    if (applied.gt(total)) {
      throw new BadRequestException(`Applied ${applied.toFixed(2)} is more than the payment of ${total.toFixed(2)}.`);
    }
    const invoices = ids.length
      ? await prisma.clientInvoice.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, invoiceNumber: true, clientId: true, postingStatus: true, outstandingAmount: true, currencyCode: true },
        })
      : [];
    for (const a of allocations) {
      const inv = invoices.find((i) => i.id === a.clientInvoiceId);
      if (!inv) throw new NotFoundException(`Invoice ${a.clientInvoiceId} not found`);
      const ref = inv.invoiceNumber ?? inv.id;
      if (inv.clientId !== dto.clientId) {
        throw new BadRequestException({ errorCode: 'ALLOCATION_CLIENT_MISMATCH', message: `Invoice ${ref} belongs to a different client.` });
      }
      if (inv.postingStatus !== 'POSTED') throw new BadRequestException(`Invoice ${ref} is not issued yet.`);
      if (inv.currencyCode !== dto.currency) {
        throw new BadRequestException({ errorCode: 'CURRENCY_MISMATCH', message: `Invoice ${ref} is in ${inv.currencyCode}; this payment is ${dto.currency}.` });
      }
      const outstanding = new Decimal(inv.outstandingAmount.toString());
      if (new Decimal(a.amount).gt(outstanding)) {
        throw new BadRequestException(`Invoice ${ref} has ${outstanding.toFixed(2)} outstanding; ${a.amount} cannot be applied.`);
      }
    }

    const { receiptId } = await prisma.$transaction(async (tx) => {
      const result = await this.createAndPost(
        identity,
        { ...dto, bankAccountCode: bank.glAccount.code, details, allocations },
        tx,
      ).catch((err: unknown) => this.duplicateProof(err, dto.paymentMethod));
      // The invoices' outstanding balances moved inside the same transaction; a concurrent receipt
      // that already settled one would drive it below zero, so re-check before committing.
      if (ids.length) {
        const overdrawn = await tx.clientInvoice.count({ where: { id: { in: ids }, outstandingAmount: { lt: 0 } } });
        if (overdrawn > 0) throw new ConflictException('An invoice was paid while this payment was being recorded. Reload and try again.');
      }
      return result;
    });
    return this.findById(identity, receiptId);
  }

  // ACC-SET-001 BE-2: receipt creation moved here from the retired finance module. No separate
  // accounting date is captured on the receipt form, so the receipt date is its accounting date.
  async create(identity: RequestIdentity, dto: CreateReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const details = await this.assertRecordable(prisma, identity.activeOrganizationId, dto);
    return this.saveReceipt(prisma, identity, dto, details);
  }

  private async saveReceipt(
    prisma: Prisma.TransactionClient,
    identity: RequestIdentity,
    dto: RecordableReceipt & { reference?: string; notes?: string },
    details: NormalisedDetails,
    bankAccountId?: string,
  ) {
    const receiptDate = new Date(dto.receiptDate);
    return this.receiptRepo
      .create(prisma as never, {
        organizationId: identity.activeOrganizationId,
        clientId: dto.clientId,
        bankAccountId,
        receiptDate,
        accountingDate: receiptDate,
        totalAmount: dto.amount,
        currencyCode: dto.currency,
        paymentMethod: dto.paymentMethod,
        details,
        reference: dto.reference?.trim() || undefined,
        notes: dto.notes?.trim() || undefined,
        createdBy: identity.userId,
      })
      .catch((err: unknown) => this.duplicateProof(err, dto.paymentMethod));
  }

  /** A concurrent receipt claimed the same proof between the check and the write (PM-2's index). */
  private duplicateProof(err: unknown, method?: string): never {
    if ((err as { code?: string })?.code === 'P2002' && String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('instrument')) {
      throw new ConflictException({
        errorCode: 'PAYMENT_PROOF_ALREADY_USED',
        message: `That ${method === 'CHEQUE' ? 'cheque' : 'payment'} was just recorded on another receipt.`,
      });
    }
    throw err;
  }

  /**
   * RC-2 — what every new receipt must be, recorded or received: in USD (ADR-024; a receipt in
   * another currency posted at rate 1 into the USD ledger, like CI-1's invoices), for more than
   * nothing, from a client of this organisation (an unknown client was a 500).
   */
  private async assertRecordable(
    prisma: Prisma.TransactionClient,
    orgId: string,
    dto: RecordableReceipt,
  ): Promise<NormalisedDetails> {
    if (dto.currency !== 'USD') {
      throw new BadRequestException({ errorCode: 'CURRENCY_NOT_SUPPORTED', message: 'Receipts are recorded in US dollars (USD) only.' });
    }
    if (!new Decimal(dto.amount).gt(0)) {
      throw new BadRequestException({ errorCode: 'AMOUNT_NOT_POSITIVE', message: 'The amount received must be more than 0.' });
    }
    const client = await prisma.client.findFirst({ where: { id: dto.clientId, organizationId: orgId }, select: { id: true } });
    if (!client) throw new NotFoundException({ errorCode: 'CLIENT_NOT_FOUND', message: 'That client was not found.' });

    // PM-1 — the method, and the proof it needs, before anything is written.
    if (!dto.paymentMethod || !RECEIPT_PAYMENT_METHODS.includes(dto.paymentMethod as ReceiptPaymentMethod)) {
      throw new BadRequestException({ errorCode: 'PAYMENT_METHOD_REQUIRED', message: 'Choose how the client paid.' });
    }
    const method = dto.paymentMethod as ReceiptPaymentMethod;
    const problems = paymentDetailProblems(method, dto);
    if (problems.length) {
      throw new BadRequestException({ errorCode: 'PAYMENT_DETAILS_INVALID', message: problems.join(' '), details: { problems } });
    }
    const details = normaliseDetails(method, dto);

    // PM-2 — the same proof cannot pay twice. A reversed (bounced cheque) or cancelled receipt frees it.
    if (details.instrumentNumber) {
      const used = await prisma.paymentReceipt.findFirst({
        where: {
          organizationId: orgId,
          paymentMethod: method,
          // A bank typed "premier bank" is the same bank as "Premier Bank".
          issuer: details.issuer ? { equals: details.issuer, mode: 'insensitive' } : null,
          instrumentNumber: details.instrumentNumber,
          postingStatus: { not: 'REVERSED' },
          documentStatus: { not: 'CANCELLED' },
        },
        select: { receiptNumber: true },
      });
      if (used) {
        throw new ConflictException({
          errorCode: 'PAYMENT_PROOF_ALREADY_USED',
          message: `${describeInstrument(method, details.issuer, details.instrumentNumber)} is already on ${used.receiptNumber ?? 'an unposted receipt'}.`,
          details: { receiptNumber: used.receiptNumber },
        });
      }
    }
    return details;
  }

  /**
   * RC-5 — cancel a receipt that was recorded but never posted (typed twice, the wrong client):
   * nothing reached the ledger, so it is set aside rather than reversed, and kept for the record.
   */
  async cancel(identity: RequestIdentity, receiptId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const why = reason?.trim() ?? '';
    if (why.length < 3) {
      throw new BadRequestException({ errorCode: 'CANCELLATION_REASON_REQUIRED', message: 'Say why the receipt is cancelled.' });
    }
    const receipt = await this.receiptRepo.findById(prisma, identity.activeOrganizationId, receiptId);
    if (!receipt) throw new NotFoundException({ errorCode: 'RECEIPT_NOT_FOUND', message: `Receipt ${receiptId} not found` });
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentReceipt.updateMany({
        where: { id: receiptId, postingStatus: 'NOT_POSTED', documentStatus: { not: 'CANCELLED' } },
        data: { documentStatus: 'CANCELLED', cancelledAt: new Date(), cancelledBy: identity.userId, cancellationReason: why },
      });
      if (count === 0) {
        throw new ConflictException({
          errorCode: 'RECEIPT_NOT_CANCELLABLE',
          message: receipt.postingStatus === 'NOT_POSTED' ? 'This receipt is already cancelled.' : 'A posted receipt is reversed, not cancelled.',
        });
      }
      await this.auditOutbox?.record(tx as never, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'PaymentReceipt',
        resourceId: receiptId,
        sourceCommand: 'accountsReceivable.RECEIPT_CANCELLED',
        eventType: 'RECEIPT_CANCELLED',
        idempotencyKey: `RECEIPT_CANCELLED:${receiptId}`,
        reason: why,
      } as never);
    });
    return this.findById(identity, receiptId);
  }

  async findAll(identity: RequestIdentity, clientId?: string, projectId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.receiptRepo.findAll(prisma, identity.activeOrganizationId, clientId, projectId);
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
    // receipt workspace can render and reverse them (ACC-SET-001 FE-1), with RC-7's detail.
    return { ...receipt, ...(await this.receiptRepo.findDetail(prisma, receipt)) };
  }
}
