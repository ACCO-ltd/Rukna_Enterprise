import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import {
  PostingAccountResolver,
  type ResolvedAccount,
} from '../../accounting-core/application/posting-account-resolver.service.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateCreditNoteDto {
  invoiceId: string;
  reason: 'OMISSION' | 'PRICE_ERROR' | 'CORRECTION' | 'NEGATIVE_VARIATION';
  /** Decimal string — ex-VAT net to credit */
  netAmount: string;
  /** ISO date string */
  accountingDate: string;
  note?: string;
  sourceVariationId?: string;
}

export interface PostCreditNoteDto {
  creditNoteId: string;
  arAccountCode?: string;
  revenueAccountCode?: string;
  vatAccountCode?: string;
}

@Injectable()
export class CreditNoteService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  // ─── createCreditNote ──────────────────────────────────────────────────────

  async createCreditNote(identity: RequestIdentity, dto: CreateCreditNoteDto) {
    const outerPrisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await outerPrisma.clientInvoice.findFirst({
      where: { id: dto.invoiceId, organizationId: orgId },
      select: {
        id: true,
        postingStatus: true,
        outstandingAmount: true,
        subtotal: true,
        vatAmount: true,
        projectId: true,
        contractId: true,
      },
    });
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);

    if (invoice.postingStatus !== 'POSTED') {
      throw new BadRequestException(
        `Credit notes can only be raised against POSTED invoices (current status: ${invoice.postingStatus})`,
      );
    }

    const netAmount = new Decimal(dto.netAmount);
    // Derive the actual VAT rate from the original invoice — never blindly assume 5%.
    // This ensures a zero-VAT invoice produces a zero-VAT credit note, and an invoice
    // posted at any other rate produces a proportionally correct credit.
    const invoiceSubtotal = new Decimal(invoice.subtotal.toString());
    const invoiceVatAmt = new Decimal(invoice.vatAmount.toString());
    const vatRate = invoiceSubtotal.isZero()
      ? new Decimal(0)
      : invoiceVatAmt.div(invoiceSubtotal).toDecimalPlaces(6);
    const vatAmount = netAmount.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = netAmount.plus(vatAmount);

    // Phase-1 credit limit: sum of existing NOT_POSTED + POSTED credit notes + new must not exceed outstanding
    const existingCreditTotal = await outerPrisma.creditNote.aggregate({
      where: {
        invoiceId: dto.invoiceId,
        organizationId: orgId,
        postingStatus: { in: ['NOT_POSTED', 'POSTED'] as never[] },
      },
      _sum: { totalAmount: true },
    });

    const alreadyCredited = new Decimal(
      existingCreditTotal._sum?.totalAmount?.toString() ?? '0',
    );
    const outstanding = new Decimal(invoice.outstandingAmount.toString());

    if (alreadyCredited.plus(totalAmount).gt(outstanding)) {
      throw new BadRequestException({
        code: 'CREDIT_EXCEEDS_OUTSTANDING',
        message:
          `Credit note total (${totalAmount.toFixed(2)}) plus existing credits ` +
          `(${alreadyCredited.toFixed(2)}) would exceed the invoice outstanding balance ` +
          `(${outstanding.toFixed(2)}).`,
      });
    }

    // sourceVariationId optional validation — validate same org if provided
    if (dto.sourceVariationId) {
      const variation = await outerPrisma.variationOrder.findFirst({
        where: { id: dto.sourceVariationId, organizationId: orgId },
        select: { id: true, contractId: true, lines: { select: { amount: true } } },
      });
      if (!variation) {
        throw new NotFoundException(`VariationOrder ${dto.sourceVariationId} not found`);
      }

      // Validate it's a negative/omission variation (Σ lines < 0)
      const variationNetPrice = variation.lines.reduce(
        (sum, l) => sum.plus(new Decimal(l.amount.toString())),
        new Decimal(0),
      );
      if (variationNetPrice.gte(0)) {
        throw new BadRequestException(
          `VariationOrder ${dto.sourceVariationId} is not a negative/omission variation (netPrice: ${variationNetPrice.toFixed(2)})`,
        );
      }

      // Validate total existing credit notes against this variation don't exceed its negative amount
      const existingForVariation = await outerPrisma.creditNote.aggregate({
        where: {
          sourceVariationId: dto.sourceVariationId,
          organizationId: orgId,
          postingStatus: { in: ['NOT_POSTED', 'POSTED'] as never[] },
        },
        _sum: { totalAmount: true },
      });
      const creditedForVariation = new Decimal(
        existingForVariation._sum?.totalAmount?.toString() ?? '0',
      );
      const absVariationAmount = variationNetPrice.abs().mul(new Decimal(1).plus(vatRate)).toDecimalPlaces(2); // inc. VAT at actual invoice rate
      if (creditedForVariation.plus(totalAmount).gt(absVariationAmount)) {
        throw new BadRequestException(
          `Credit notes against variation ${dto.sourceVariationId} would exceed its negative amount.`,
        );
      }
    }

    return outerPrisma.creditNote.create({
      data: {
        organizationId: orgId,
        invoiceId: dto.invoiceId,
        reason: dto.reason as never,
        netAmount,
        vatAmount,
        totalAmount,
        accountingDate: new Date(dto.accountingDate),
        postingStatus: 'NOT_POSTED',
        note: dto.note?.trim() || null,
        sourceVariationId: dto.sourceVariationId ?? null,
        createdBy: userId,
      },
    });
  }

  // ─── postCreditNote ────────────────────────────────────────────────────────

  async postCreditNote(identity: RequestIdentity, dto: PostCreditNoteDto) {
    const outerPrisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const creditNote = await outerPrisma.creditNote.findFirst({
      where: { id: dto.creditNoteId, organizationId: orgId },
    });
    if (!creditNote) throw new NotFoundException(`CreditNote ${dto.creditNoteId} not found`);

    if (creditNote.postingStatus === 'POSTED') {
      throw new ConflictException(`CreditNote ${dto.creditNoteId} is already posted`);
    }
    // A reversed credit note is finished (H2): posting it again would draw a new number and a second
    // journal. Raise a new credit note instead.
    if (creditNote.postingStatus !== 'NOT_POSTED' && creditNote.postingStatus !== 'FAILED') {
      throw new ConflictException(`CreditNote ${dto.creditNoteId} cannot be posted (status: ${creditNote.postingStatus})`);
    }

    // Resolve accounts
    const arAccount = await this.resolver.resolveByCodeOrRole(
      outerPrisma as never,
      orgId,
      dto.arAccountCode,
      'ACCOUNTS_RECEIVABLE',
    );
    const revAccount = await this.resolver.resolveByCodeOrRole(
      outerPrisma as never,
      orgId,
      dto.revenueAccountCode,
      'PROJECT_REVENUE',
    );

    const netAmount = new Decimal(creditNote.netAmount.toString());
    const vatAmount = new Decimal(creditNote.vatAmount.toString());
    const totalAmount = new Decimal(creditNote.totalAmount.toString());

    let vatAccount: ResolvedAccount | null = null;
    if (vatAmount.gt(0)) {
      vatAccount = await this.resolver.resolveByCodeOrRole(
        outerPrisma as never,
        orgId,
        dto.vatAccountCode,
        'VAT_OUTPUT_PAYABLE',
      );
    }

    // Ensure CN sequence exists before entering the transaction
    await this.sequenceRepo.ensureSequence(
      outerPrisma as never,
      orgId,
      'CREDIT_NOTE',
      'CN-',
    );

    // Invoice lookup for AR client/contract tags plus immutable tax fields for cap re-check
    const invoice = await outerPrisma.clientInvoice.findFirst({
      where: { id: creditNote.invoiceId, organizationId: orgId },
      select: { clientId: true, contractId: true, projectId: true, currencyCode: true, subtotal: true, vatAmount: true },
    });

    // Pre-compute vatRate and variationCap from immutable invoice/variation fields (outside tx)
    let variationCap: Decimal | null = null;
    if (creditNote.sourceVariationId) {
      const invSubtotal = invoice ? new Decimal(invoice.subtotal.toString()) : new Decimal(0);
      const invVatAmt = invoice ? new Decimal(invoice.vatAmount.toString()) : new Decimal(0);
      const vatRateForCap = invSubtotal.isZero()
        ? new Decimal(0)
        : invVatAmt.div(invSubtotal).toDecimalPlaces(6);
      const variation = await outerPrisma.variationOrder.findFirst({
        where: { id: creditNote.sourceVariationId, organizationId: orgId },
        select: { lines: { select: { amount: true } } },
      });
      if (variation) {
        const variationNetPrice = variation.lines.reduce(
          (sum, l) => sum.plus(new Decimal(l.amount.toString())),
          new Decimal(0),
        );
        variationCap = variationNetPrice.abs()
          .mul(new Decimal(1).plus(vatRateForCap))
          .toDecimalPlaces(2);
      }
    }

    return (outerPrisma as unknown as PrismaClient).$transaction(async (tx) => {
      // Lock the invoice row to prevent concurrent posts from double-spending AR.
      // The create-time check is insufficient: a payment arriving between create and post
      // can reduce the outstanding below this CN's totalAmount.
      const lockedRows = await (tx as unknown as PrismaClient).$queryRaw<
        Array<{ outstanding_amount: unknown }>
      >`SELECT outstanding_amount FROM client_invoices WHERE id = ${creditNote.invoiceId} AND organization_id = ${orgId} FOR UPDATE`;

      if (!lockedRows.length) {
        throw new NotFoundException(`ClientInvoice ${creditNote.invoiceId} not found`);
      }

      const currentOutstanding = new Decimal(String(lockedRows[0].outstanding_amount));
      if (totalAmount.gt(currentOutstanding)) {
        throw new BadRequestException({
          code: 'CREDIT_EXCEEDS_OUTSTANDING',
          message:
            `Credit note total (${totalAmount.toFixed(2)}) exceeds current invoice outstanding balance ` +
            `(${currentOutstanding.toFixed(2)}).`,
        });
      }

      // Re-check negative variation cap against only already-POSTED CNs for this variation.
      // This catches the case where two eligible draft CNs race to post simultaneously.
      if (creditNote.sourceVariationId && variationCap !== null) {
        const existingPostedForVar = await (tx as unknown as TenantPrisma).creditNote.aggregate({
          where: {
            sourceVariationId: creditNote.sourceVariationId,
            organizationId: orgId,
            postingStatus: 'POSTED',
            id: { not: creditNote.id },
          },
          _sum: { totalAmount: true },
        });
        const alreadyPostedForVar = new Decimal(
          existingPostedForVar._sum?.totalAmount?.toString() ?? '0',
        );
        if (alreadyPostedForVar.plus(totalAmount).gt(variationCap)) {
          throw new BadRequestException(
            `Posting this credit note would exceed the negative variation's creditable amount ` +
            `(cap: ${variationCap.toFixed(2)}, already posted: ${alreadyPostedForVar.toFixed(2)}, ` +
            `this CN: ${totalAmount.toFixed(2)}).`,
          );
        }
      }

      // EVT-AR-007: Dr Revenue / Dr VAT / Cr AR
      const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
        {
          accountId: revAccount.id,
          debitAmount: netAmount,
          creditAmount: new Decimal(0),
          // The credit takes revenue back from the project the invoice recognised it on — the
          // invoice posts its revenue credit with the same projectId (EVT-AR-001).
          projectId: invoice?.projectId ?? undefined,
          contractId: invoice?.contractId ?? undefined,
        },
      ];

      if (vatAccount && vatAmount.gt(0)) {
        lines.push({
          accountId: vatAccount.id,
          debitAmount: vatAmount,
          creditAmount: new Decimal(0),
        });
      }

      lines.push({
        accountId: arAccount.id,
        debitAmount: new Decimal(0),
        creditAmount: totalAmount,
        sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const,
        clientId: invoice?.clientId ?? undefined,
        contractId: invoice?.contractId ?? undefined,
      });

      // Claimed before posting (same transaction) so the journal names the credit note's number.
      const cnNum = await this.sequenceRepo.claimNext(tx as never, orgId, 'CREDIT_NOTE');

      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: creditNote.accountingDate,
          documentDate: creditNote.accountingDate,
          description: `Credit note ${cnNum.formattedNumber}`,
          currencyCode: invoice?.currencyCode ?? 'USD',
          eventType: 'EVT-AR-007',
          sourceDocumentType: 'CREDIT_NOTE',
          sourceDocumentId: creditNote.id,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          createdBy: userId,
          lines,
        },
        tx as never,
      );

      // Update credit note
      const updatedCreditNote = await (tx as unknown as TenantPrisma).creditNote.update({
        where: { id: creditNote.id },
        data: {
          postingStatus: 'POSTED',
          postedJournalEntryId: postResult.journalEntryId,
          creditNoteNumber: cnNum.formattedNumber,
          postedAt: new Date(),
          postedBy: userId,
        },
      });

      // Reduce invoice.outstandingAmount — the ONE correct AR impact of a posted credit note.
      // Pass the Decimal directly (never .toNumber(), which drops to IEEE-754 float and reintroduces
      // the rounding drift the Decimal discipline exists to prevent on a 2-dp money column).
      await (tx as unknown as TenantPrisma).clientInvoice.update({
        where: { id: creditNote.invoiceId },
        data: {
          outstandingAmount: {
            decrement: totalAmount,
          },
        },
      });

      return updatedCreditNote;
    });
  }

  // ─── reverseCreditNote ─────────────────────────────────────────────────────

  /**
   * Phase 0 H2 — EVT-AR-008: reverse a posted credit note issued in error. The mirror of EVT-AR-007
   * (Dr AR / Cr Revenue / Cr VAT, every original dimension kept), dated on the reversal date; the
   * invoice's outstanding balance is restored by the credit note total.
   */
  async reverseCreditNote(
    identity: RequestIdentity,
    dto: { creditNoteId: string; invoiceId?: string; reversalDate: string; reason: string },
  ) {
    const outerPrisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const creditNote = await outerPrisma.creditNote.findFirst({
      where: { id: dto.creditNoteId, organizationId: orgId, ...(dto.invoiceId ? { invoiceId: dto.invoiceId } : {}) },
    });
    if (!creditNote) throw new NotFoundException(`CreditNote ${dto.creditNoteId} not found`);
    if (creditNote.postingStatus !== 'POSTED' || !creditNote.postedJournalEntryId) {
      throw new BadRequestException(`Only a POSTED credit note can be reversed (status: ${creditNote.postingStatus})`);
    }
    if (creditNote.reversalJournalEntryId) {
      throw new ConflictException(`CreditNote ${dto.creditNoteId} is already reversed`);
    }
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('A reason is required to reverse a credit note');

    const original = await outerPrisma.journalEntry.findUniqueOrThrow({
      where: { id: creditNote.postedJournalEntryId },
      include: { lines: true },
    });
    const reversalDate = new Date(dto.reversalDate);
    const totalAmount = new Decimal(creditNote.totalAmount.toString());

    return (outerPrisma as unknown as PrismaClient).$transaction(async (tx) => {
      // Lock the invoice: the reversal restores outstanding while receipts may be allocating to it.
      const locked = await (tx as unknown as PrismaClient).$queryRaw<Array<{ posting_status: string }>>`
        SELECT posting_status FROM client_invoices WHERE id = ${creditNote.invoiceId} AND organization_id = ${orgId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException(`ClientInvoice ${creditNote.invoiceId} not found`);
      if (locked[0].posting_status !== 'POSTED') {
        throw new BadRequestException(`The invoice is ${locked[0].posting_status}; only a credit note on a posted invoice is reversed.`);
      }

      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of credit note ${creditNote.creditNoteNumber ?? creditNote.id}: ${reason}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AR-008',
          sourceDocumentType: 'CREDIT_NOTE',
          sourceDocumentId: creditNote.id,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          createdBy: userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
            projectId: l.projectId ?? undefined,
            contractId: l.contractId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      const reversed = await (tx as unknown as TenantPrisma).creditNote.update({
        where: { id: creditNote.id },
        data: {
          postingStatus: 'REVERSED',
          reversalJournalEntryId: result.journalEntryId,
          reversedAt: new Date(),
          reversedBy: userId,
          reversalReason: reason,
        },
      });
      await (tx as unknown as TenantPrisma).clientInvoice.update({
        where: { id: creditNote.invoiceId },
        data: { outstandingAmount: { increment: totalAmount } },
      });
      return reversed;
    });
  }
}
