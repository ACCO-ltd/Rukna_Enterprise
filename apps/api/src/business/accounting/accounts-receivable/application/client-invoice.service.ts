import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { AccountWithCurrentVersion } from '../../accounting-core/infrastructure/account.repository.js';
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
import { ClientInvoiceRepository } from '../infrastructure/client-invoice.repository.js';

export interface GenerateInvoiceFromIpcDto {
  ipcId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export interface GenerateInvoiceFromInstallmentDto {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export interface ApproveInvoiceDto {
  invoiceId: string;
}

export interface PostInvoiceDto {
  invoiceId: string;
  /** Optional override for the AR control account. Resolved server-side by role when absent (ACC-POST-001). */
  arAccountCode?: string;
  /** Optional override for the Revenue account. Resolved server-side by role when absent. */
  revenueAccountCode?: string;
  /** Optional override for the Output VAT account. Resolved server-side by role when vatAmount > 0. */
  vatAccountCode?: string;
}

@Injectable()
export class ClientInvoiceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientInvoiceRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  /**
   * Generate a draft ClientInvoice from an effective IPC.
   *
   * CONST-COM-006 — idempotent: one effective IPC maps to at most one ClientInvoice.
   * Repeating the command returns the existing invoice rather than creating a second AR
   * receivable. Concurrency is closed by the unique index on ClientInvoice.sourceIpcId:
   * a racing insert fails with P2002 and we return the invoice the winner created.
   */
  async generateFromIpc(identity: RequestIdentity, dto: GenerateInvoiceFromIpcDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByIpc(prisma, orgId, dto.ipcId);
    if (existing) return existing;

    const ipc = await prisma.interimPaymentCertificate.findFirst({
      where: { id: dto.ipcId, organizationId: orgId },
      include: {
        application: { include: { contract: { include: { client: true } } } },
      },
    });
    if (!ipc) throw new NotFoundException(`IPC ${dto.ipcId} not found`);
    if (!ipc.isEffective) throw new BadRequestException(`IPC ${dto.ipcId} is not effective yet`);

    const contract = ipc.application.contract;
    const subtotal = new Decimal(ipc.certifiedTotal.toString());
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        clientId: contract.clientId,
        sourceIpcId: dto.ipcId,
        projectId: contract.projectId,
        contractId: contract.id,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: ipc.currency,
        subtotal,
        vatAmount,
        totalAmount,
        paymentTerms: dto.paymentTerms,
        billingAddressSnapshot: { clientName: contract.client.name },
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent generation lost the race on the unique(source_ipc_id) index.
      // Return the invoice the winning request created — still exactly one receivable.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findByIpc(prisma, orgId, dto.ipcId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * ADR-023: generate a draft ClientInvoice from a payment-schedule installment (MILESTONE contract).
   *
   * Idempotent, exactly like generateFromIpc: one installment maps to at most one invoice, enforced by
   * the unique index on ClientInvoice.sourceInstallmentId. The amount is derived from
   * contract value × installment percentage — never re-keyed, so the invoice cannot drift from the plan.
   * This is ADR-023's BillableEntitlement → guarded invoice for the payment-schedule model.
   */
  async generateFromInstallment(identity: RequestIdentity, dto: GenerateInvoiceFromInstallmentDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByInstallment(prisma, orgId, dto.installmentId);
    if (existing) return existing;

    const installment = await this.repo.findInstallmentForBilling(prisma, orgId, dto.installmentId);
    if (!installment) {
      throw new NotFoundException(`Payment installment ${dto.installmentId} not found`);
    }

    const contract = installment.contract;
    if (contract.billingModel !== 'MILESTONE') {
      throw new BadRequestException(
        'Installment invoicing applies only to MILESTONE (payment-schedule) contracts.',
      );
    }
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Contract ${contract.contractNumber} must be ACTIVE to bill an installment (currently ${contract.status}).`,
      );
    }
    // ADR-023 CONST-COM-011 (soft gate): when an installment is linked to a programme milestone, the
    // milestone is its billing evidence — it must be VERIFIED before the invoice can be raised.
    // Unlinked installments bill on their label as before.
    if (installment.programmeMilestoneId && installment.programmeMilestone?.status !== 'VERIFIED') {
      throw new BadRequestException(
        'The linked programme milestone is not yet verified; this installment cannot be billed.',
      );
    }

    const subtotal = new Decimal(contract.contractValue.toString())
      .mul(new Decimal(installment.percentage.toString()))
      .toDecimalPlaces(2);
    const vatRate = new Decimal('0.05');
    const vatAmount = subtotal.mul(vatRate).toDecimalPlaces(2);
    const totalAmount = subtotal.plus(vatAmount);

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        clientId: contract.clientId,
        sourceInstallmentId: dto.installmentId,
        projectId: contract.projectId,
        contractId: contract.id,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: new Date(dto.dueDate),
        currencyCode: contract.currency,
        subtotal,
        vatAmount,
        totalAmount,
        paymentTerms: dto.paymentTerms,
        billingAddressSnapshot: { clientName: contract.client.name, installment: installment.name },
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent generation lost the race on unique(source_installment_id): return the winner's invoice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findByInstallment(prisma, orgId, dto.installmentId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  async approve(identity: RequestIdentity, invoiceId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${invoiceId} not found`);
    if (invoice.documentStatus !== 'DRAFT') {
      throw new BadRequestException(`Invoice is already ${invoice.documentStatus}`);
    }

    return this.repo.approve(prisma, invoiceId, userId);
  }

  /**
   * Post the ClientInvoice to the GL.
   * EVT-AR-001: Dr AR / Cr Revenue / Cr VAT Output
   */
  async post(identity: RequestIdentity, dto: PostInvoiceDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, dto.invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);
    if (invoice.documentStatus !== 'APPROVED') {
      throw new BadRequestException(`Invoice must be APPROVED before posting`);
    }
    if (invoice.postingStatus === 'POSTED') {
      throw new ConflictException(`Invoice ${dto.invoiceId} is already posted`);
    }

    // ADR-024 ACC-POST-001: control accounts are resolved server-side by role. A code in the
    // DTO still works as an explicit override (backward-compatible) but is no longer required.
    const arAccount = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.arAccountCode, 'ACCOUNTS_RECEIVABLE',
    );
    const revAccount = await this.resolver.resolveByCodeOrRole(
      prisma, orgId, dto.revenueAccountCode, 'PROJECT_REVENUE',
    );

    let vatAccount: ResolvedAccount | null = null;
    if (new Decimal(invoice.vatAmount.toString()).gt(0)) {
      vatAccount = await this.resolver.resolveByCodeOrRole(
        prisma, orgId, dto.vatAccountCode, 'VAT_OUTPUT_PAYABLE',
      );
    }

    await this.sequenceRepo.ensureSequence(
      prisma as never, orgId, 'CLIENT_INVOICE', 'INV-',
    );

    try {
      const result = await prisma.$transaction(async (tx) => {
        const subtotal = new Decimal(invoice.subtotal.toString());
        const vatAmount = new Decimal(invoice.vatAmount.toString());
        const totalAmount = new Decimal(invoice.totalAmount.toString());

        const lines: Parameters<typeof this.postingPort.post>[0]['lines'] = [
          {
            accountId: arAccount.id,
            debitAmount: totalAmount,
            creditAmount: new Decimal(0),
            sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const,
            clientId: invoice.clientId,
            contractId: invoice.contractId ?? undefined,
          },
          {
            accountId: revAccount.id,
            debitAmount: new Decimal(0),
            creditAmount: subtotal,
            projectId: invoice.projectId ?? undefined,
            contractId: invoice.contractId ?? undefined,
          },
        ];

        if (vatAccount && vatAmount.gt(0)) {
          lines.push({
            accountId: (vatAccount as AccountWithCurrentVersion).id,
            debitAmount: new Decimal(0),
            creditAmount: vatAmount,
          });
        }

        const postResult = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: invoice.invoiceDate,
            documentDate: invoice.invoiceDate,
            description: `Client Invoice — ${invoice.id}`,
            currencyCode: invoice.currencyCode,
            eventType: 'EVT-AR-001',
            sourceDocumentType: 'CLIENT_INVOICE',
            sourceDocumentId: invoice.id,
            journalCategory: 'ACCOUNTS_RECEIVABLE',
            entryPurpose: 'NORMAL',
            postingOrigin: 'SYSTEM_AR',
            createdBy: userId,
            lines,
          },
          tx as never,
        );

        // Claim invoice number
        const invNum = await this.sequenceRepo.claimNext(
          tx as never, orgId, 'CLIENT_INVOICE',
        );

        await this.repo.markPosted(prisma, invoice.id, postResult.journalEntryId, invNum.formattedNumber, userId);

        return { ...postResult, invoiceNumber: invNum.formattedNumber };
      });

      return result;
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message.slice(0, 50) : 'POSTING_FAILED';
      await this.repo.markPostingFailed(prisma, invoice.id, code);
      throw err;
    }
  }

  /**
   * Reverse a posted ClientInvoice.
   * EVT-AR-002: Dr Revenue + Dr VAT (if any) / Cr AR — the mirror of EVT-AR-001.
   * Guard: invoice must have zero active (POSTED) receipt allocations.
   */
  async reverse(
    identity: RequestIdentity,
    invoiceId: string,
    opts: { reversalDate: string; reason: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await this.repo.findById(prisma, orgId, invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${invoiceId} not found`);
    if (invoice.postingStatus !== 'POSTED') {
      throw new BadRequestException(`Only POSTED invoices can be reversed (status: ${invoice.postingStatus})`);
    }
    if (invoice.reversalJournalEntryId) {
      throw new ConflictException(`Invoice ${invoiceId} is already reversed`);
    }

    // Guard: no active receipt allocations
    const activeAllocs = await prisma.clientReceiptAllocation.count({
      where: { clientInvoiceId: invoiceId, postingStatus: 'POSTED' },
    });
    if (activeAllocs > 0) {
      throw new BadRequestException(
        `Cannot reverse invoice ${invoiceId} — it has ${activeAllocs} active receipt allocation(s). ` +
        `Reverse the receipt allocations first.`,
      );
    }

    if (!invoice.postedJournalEntryId) {
      throw new BadRequestException(`Invoice ${invoiceId} has no posted journal to reverse`);
    }

    // Load original journal lines
    const originalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: invoice.postedJournalEntryId },
      include: { lines: true },
    });

    const reversalDate = new Date(opts.reversalDate);

    return prisma.$transaction(async (tx) => {
      const reversalResult = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of Invoice ${invoice.invoiceNumber ?? invoiceId}: ${opts.reason}`,
          currencyCode: invoice.currencyCode,
          eventType: 'EVT-AR-002',
          sourceDocumentType: 'CLIENT_INVOICE',
          sourceDocumentId: `reversal-${invoiceId}`,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          reversalOfJournalEntryId: invoice.postedJournalEntryId ?? undefined,
          createdBy: userId,
          lines: originalJournal.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
            contractId: l.contractId ?? undefined,
            memo: `Reversal: ${l.description ?? ''}`,
          })),
        },
        tx as never,
      );

      await tx.clientInvoice.update({
        where: { id: invoiceId },
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

  async findAll(identity: RequestIdentity, clientId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, clientId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const invoice = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${id} not found`);
    return invoice;
  }
}
