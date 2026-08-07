import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from './ports/accounting-posting.port.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { JournalRepository } from '../infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../infrastructure/document-sequence.repository.js';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface TrialBalanceLineDto {
  accountCode: string;
  debitBalance?: number;
  creditBalance?: number;
}

export interface OpenArInvoiceDto {
  clientId: string;
  invoiceRef: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

export interface OpenApBillDto {
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  currencyCode: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  expenseProfileCode: string;
}

export interface OpeningBalanceWizardDto {
  cutoverDate: string;
  batchReference: string;
  arAccountCode: string;
  apAccountCode: string;
  trialBalance: TrialBalanceLineDto[];
  openArInvoices?: OpenArInvoiceDto[];
  openApBills?: OpenApBillDto[];
}

export interface ReconciliationLine {
  label: string;
  glBalance: string;
  subledgerBalance: string;
  variance: string;
  reconciled: boolean;
}

export interface MigrationReport {
  batchReference: string;
  cutoverDate: string;
  openingBalanceJournalId: string;
  openingBalanceJournalNumber: string;
  arInvoicesImported: number;
  apBillsImported: number;
  reconciliation: ReconciliationLine[];
  zeroVariance: boolean;
  readyForCfoApproval: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly accountRepo: AccountRepository,
    private readonly journalRepo: JournalRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  async runWizard(identity: RequestIdentity, dto: OpeningBalanceWizardDto): Promise<MigrationReport> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    const cutoverDate = new Date(dto.cutoverDate);

    // Guard: idempotency
    const existing = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, sourceDocumentType: 'OPENING_BALANCE', accountingEventId: 'EVT-OPB-001' },
    });
    if (existing) {
      throw new ConflictException(
        `Opening balance already imported (journal ${existing.journalNumber}). Reverse it first to re-import.`,
      );
    }

    // ── 1. Validate trial balance ──────────────────────────────────────────────
    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);
    for (const line of dto.trialBalance) {
      totalDebits = totalDebits.plus(new Decimal(line.debitBalance ?? 0));
      totalCredits = totalCredits.plus(new Decimal(line.creditBalance ?? 0));
    }
    if (!totalDebits.eq(totalCredits)) {
      throw new BadRequestException(
        `Trial balance out of balance: ∑Debits ${totalDebits.toFixed(2)} ≠ ∑Credits ${totalCredits.toFixed(2)}`,
      );
    }

    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'JOURNAL_ENTRY', 'JE-');

    return prisma.$transaction(async (tx) => {
      // ── 2. Build journal lines from trial balance ──────────────────────────
      const journalLines: Parameters<typeof this.postingPort.post>[0]['lines'] = [];

      for (const tbLine of dto.trialBalance) {
        const account = await this.accountRepo.findByCode(prisma, orgId, tbLine.accountCode);
        if (!account) {
          throw new NotFoundException(
            `Trial balance account "${tbLine.accountCode}" not found in COA`,
          );
        }
        const amount = new Decimal(tbLine.debitBalance ?? tbLine.creditBalance ?? 0);
        if (amount.lte(0)) continue;

        journalLines.push({
          accountId: account.id,
          debitAmount: tbLine.debitBalance ? new Decimal(tbLine.debitBalance) : new Decimal(0),
          creditAmount: tbLine.creditBalance ? new Decimal(tbLine.creditBalance) : new Decimal(0),
          transactionCurrencyCode: 'USD',
          baseCurrencyAmount: amount,
          memo: `Opening balance — ${tbLine.accountCode}`,
        });
      }

      // ── 3. Post EVT-OPB-001 ───────────────────────────────────────────────
      const postResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: cutoverDate,
          documentDate: cutoverDate,
          description: `Opening Balance Migration — ${dto.batchReference}`,
          currencyCode: 'USD',
          eventType: 'EVT-OPB-001',
          sourceDocumentType: 'OPENING_BALANCE',
          sourceDocumentId: dto.batchReference,
          journalCategory: 'OPENING_BALANCE',
          entryPurpose: 'OPENING_BALANCE',
          postingOrigin: 'SYSTEM_OPENING',
          createdBy: userId,
          lines: journalLines,
        },
        tx as never,
      );

      // ── 4. Import open AR invoices (postingStatus = OPENING_BALANCE) ───────
      let arImported = 0;
      for (const inv of dto.openArInvoices ?? []) {
        const subtotal = new Decimal(inv.subtotal);
        const vatAmount = new Decimal(inv.vatAmount);
        const totalAmount = new Decimal(inv.totalAmount);

        await tx.clientInvoice.create({
          data: {
            organizationId: orgId,
            clientId: inv.clientId,
            sourceIpcId: null,
            invoiceDate: new Date(inv.invoiceDate),
            dueDate: new Date(inv.dueDate),
            currencyCode: inv.currencyCode,
            exchangeRateSnapshot: new Decimal(1),
            exchangeRateDate: cutoverDate,
            exchangeRateSource: 'MIGRATION',
            subtotal,
            vatAmount,
            totalAmount,
            outstandingAmount: totalAmount,
            billingAddressSnapshot: { migratedFrom: 'QuickBooks', invoiceRef: inv.invoiceRef },
            documentStatus: 'APPROVED',
            postingStatus: 'OPENING_BALANCE',
            migrationBatchId: dto.batchReference,
            createdBy: userId,
          },
        });
        arImported++;
      }

      // ── 5. Import open AP bills (postingStatus = OPENING_BALANCE) ──────────
      let apImported = 0;
      for (const bill of dto.openApBills ?? []) {
        const subtotal = new Decimal(bill.subtotal);
        const vatAmount = new Decimal(bill.vatAmount);
        const totalAmount = new Decimal(bill.totalAmount);
        const norm = bill.supplierInvoiceNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        await tx.supplierBill.create({
          data: {
            organizationId: orgId,
            supplierId: bill.supplierId,
            supplierInvoiceNumber: bill.supplierInvoiceNumber,
            supplierInvoiceNumberNorm: norm,
            billDate: new Date(bill.billDate),
            dueDate: new Date(bill.dueDate),
            currencyCode: bill.currencyCode,
            exchangeRateSnapshot: new Decimal(1),
            exchangeRateDate: cutoverDate,
            exchangeRateSource: 'MIGRATION',
            subtotal,
            vatAmount,
            totalAmount,
            outstandingAmount: totalAmount,
            documentStatus: 'APPROVED',
            postingStatus: 'OPENING_BALANCE',
            migrationBatchId: dto.batchReference,
            createdBy: userId,
          },
        });
        apImported++;
      }

      // ── 6. Reconciliation ──────────────────────────────────────────────────
      const reconciliation: ReconciliationLine[] = [];

      const arGl = await this.accountRepo.findByCode(prisma, orgId, dto.arAccountCode);
      if (arGl) {
        const arGlBalance = (await this.journalRepo.getGlBalance(prisma, orgId, arGl.id)).abs();
        const arAgg = await tx.clientInvoice.aggregate({
          where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
          _sum: { outstandingAmount: true },
        });
        const arSubledger = new Decimal(arAgg._sum.outstandingAmount?.toString() ?? '0');
        const arVariance = arGlBalance.minus(arSubledger).abs();
        reconciliation.push({
          label: `Accounts Receivable (${dto.arAccountCode})`,
          glBalance: arGlBalance.toFixed(2),
          subledgerBalance: arSubledger.toFixed(2),
          variance: arVariance.toFixed(2),
          reconciled: arVariance.lte(new Decimal('0.01')),
        });
      }

      const apGl = await this.accountRepo.findByCode(prisma, orgId, dto.apAccountCode);
      if (apGl) {
        const apGlBalance = (await this.journalRepo.getGlBalance(prisma, orgId, apGl.id)).abs();
        const apAgg = await tx.supplierBill.aggregate({
          where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
          _sum: { outstandingAmount: true },
        });
        const apSubledger = new Decimal(apAgg._sum.outstandingAmount?.toString() ?? '0');
        const apVariance = apGlBalance.minus(apSubledger).abs();
        reconciliation.push({
          label: `Accounts Payable (${dto.apAccountCode})`,
          glBalance: apGlBalance.toFixed(2),
          subledgerBalance: apSubledger.toFixed(2),
          variance: apVariance.toFixed(2),
          reconciled: apVariance.lte(new Decimal('0.01')),
        });
      }

      const zeroVariance = reconciliation.every((r) => r.reconciled);

      return {
        batchReference: dto.batchReference,
        cutoverDate: dto.cutoverDate,
        openingBalanceJournalId: postResult.journalEntryId,
        openingBalanceJournalNumber: postResult.journalNumber,
        arInvoicesImported: arImported,
        apBillsImported: apImported,
        reconciliation,
        zeroVariance,
        readyForCfoApproval: zeroVariance,
      };
    });
  }
}
