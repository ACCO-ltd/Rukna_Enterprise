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
import { JournalRepository } from '../../accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';

export interface ManualJournalLineDto {
  accountId: string;
  debitAmount?: number;
  creditAmount?: number;
  transactionCurrencyCode?: string;
  memo?: string;
  projectId?: string;
  departmentId?: string;
  costCenterId?: string;
}

export interface CreateManualJournalDto {
  accountingDate: string;
  documentDate?: string;
  description: string;
  currencyCode: string;
  lines: ManualJournalLineDto[];
}

export interface SubmitManualJournalDto {
  journalId: string;
}

export interface ApproveManualJournalDto {
  journalId: string;
  approved: boolean;
  rejectionReason?: string;
}

export interface PostManualJournalDto {
  journalId: string;
}

export interface ReverseManualJournalDto {
  journalId: string;
  reversalDate: string;
  reason: string;
}

@Injectable()
export class ManualJournalService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly journalRepo: JournalRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  async create(identity: RequestIdentity, dto: CreateManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    // Ensure sequence exists for manual journals
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'JOURNAL_ENTRY', 'JE-');

    return prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        journalCategory: 'GENERAL',
        entryPurpose: 'NORMAL',
        status: 'DRAFT',
        documentDate: new Date(dto.documentDate ?? dto.accountingDate),
        accountingDate: new Date(dto.accountingDate),
        description: dto.description,
        currencyCode: dto.currencyCode,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId: `draft-${Date.now()}`,
        accountingEventId: null,
        createdBy: userId,
        lines: {
          create: dto.lines.map((line, idx) => ({
            lineNumber: idx + 1,
            accountId: line.accountId,
            accountCodeSnapshot: '',
            accountNameSnapshot: '',
            accountVersionNumber: 0,
            debitAmount: new Decimal(line.debitAmount ?? 0),
            creditAmount: new Decimal(line.creditAmount ?? 0),
            transactionCurrencyCode: line.transactionCurrencyCode ?? dto.currencyCode,
            baseCurrencyAmount: new Decimal(line.debitAmount ?? line.creditAmount ?? 0),
            postingOrigin: 'MANUAL',
            description: line.memo ?? null,
            projectId: line.projectId ?? null,
            departmentId: line.departmentId ?? null,
            costCenterId: line.costCenterId ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async submit(identity: RequestIdentity, journalId: string) {
    const prisma = this.tenancyService.getClient();
    const journal = await this.requireDraft(prisma, identity.activeOrganizationId, journalId);

    return prisma.journalEntry.update({
      where: { id: journal.id },
      data: {
        status: 'SUBMITTED',
        submittedBy: identity.userId,
        submittedAt: new Date(),
      },
    });
  }

  async approve(identity: RequestIdentity, dto: ApproveManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const journal = await prisma.journalEntry.findFirst({
      where: { id: dto.journalId, organizationId: orgId, status: 'SUBMITTED' },
    });
    if (!journal) {
      throw new NotFoundException(`Journal ${dto.journalId} not found in SUBMITTED status`);
    }

    if (!dto.approved) {
      if (!dto.rejectionReason) throw new BadRequestException('rejectionReason is required when rejecting');
      return prisma.journalEntry.update({
        where: { id: journal.id },
        data: { status: 'REJECTED', rejectedBy: userId, rejectedAt: new Date(), rejectionReason: dto.rejectionReason },
      });
    }

    return prisma.journalEntry.update({
      where: { id: journal.id },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() },
    });
  }

  async post(identity: RequestIdentity, journalId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const journal = await prisma.journalEntry.findFirst({
      where: { id: journalId, organizationId: orgId, status: 'APPROVED' },
      include: { lines: true },
    });
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} not found in APPROVED status`);
    }

    return prisma.$transaction(async (tx) => {
      // Resolve snapshots and re-validate at post time
      const lines = await Promise.all(
        journal.lines.map(async (line) => {
          const version = await tx.accountVersion.findFirst({
            where: {
              accountId: line.accountId,
              effectiveFrom: { lte: journal.accountingDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: journal.accountingDate } }],
            },
            orderBy: { effectiveFrom: 'desc' },
          });
          if (!version) throw new BadRequestException(`No effective version for account ${line.accountId}`);

          const account = await tx.account.findUniqueOrThrow({
            where: { id: line.accountId },
            select: { code: true },
          });

          return {
            accountId: line.accountId,
            debitAmount: line.debitAmount as unknown as Decimal,
            creditAmount: line.creditAmount as unknown as Decimal,
            transactionCurrencyCode: line.transactionCurrencyCode,
            baseCurrencyAmount: line.baseCurrencyAmount as unknown as Decimal,
            sourceSubledgerType: undefined,
            memo: line.description ?? undefined,
            projectId: line.projectId ?? undefined,
            departmentId: line.departmentId ?? undefined,
            costCenterId: line.costCenterId ?? undefined,
          };
        }),
      );

      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: journal.accountingDate,
          documentDate: journal.documentDate,
          description: journal.description,
          currencyCode: journal.currencyCode,
          eventType: `MANUAL-${journalId}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId: journalId,
          journalCategory: journal.journalCategory,
          entryPurpose: journal.entryPurpose,
          postingOrigin: 'MANUAL',
          createdBy: userId,
          approvedBy: journal.approvedBy ?? undefined,
          lines,
        },
        tx as never,
      );

      // Update the DRAFT journal to POSTED (the posting engine creates a new record)
      // For manual journals, we update status on the existing draft record
      await tx.journalEntry.update({
        where: { id: journalId },
        data: { status: 'POSTED', postedBy: userId, postedAt: new Date() },
      });

      return result;
    });
  }

  async reverse(identity: RequestIdentity, dto: ReverseManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const journal = await prisma.journalEntry.findFirst({
      where: { id: dto.journalId, organizationId: orgId, status: 'POSTED' },
      include: { lines: true },
    });
    if (!journal) throw new NotFoundException(`Journal ${dto.journalId} not found in POSTED status`);
    if (journal.reversalOfJournalEntryId) {
      throw new ConflictException(`Journal ${dto.journalId} is already a reversal — cannot reverse a reversal`);
    }

    const reversalDate = new Date(dto.reversalDate);

    return prisma.$transaction(async (tx) => {
      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of ${journal.journalNumber}: ${dto.reason}`,
          currencyCode: journal.currencyCode,
          eventType: `MANUAL-REVERSAL-${journal.id}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId: `reversal-${journal.id}`,
          journalCategory: journal.journalCategory,
          entryPurpose: 'REVERSAL',
          postingOrigin: 'MANUAL',
          reversalOfJournalEntryId: journal.id,
          createdBy: userId,
          lines: journal.lines.map((line) => ({
            accountId: line.accountId,
            // Swap debit/credit for reversal
            debitAmount: line.creditAmount as unknown as Decimal,
            creditAmount: line.debitAmount as unknown as Decimal,
            transactionCurrencyCode: line.transactionCurrencyCode,
            baseCurrencyAmount: line.baseCurrencyAmount as unknown as Decimal,
            memo: `Reversal: ${line.description ?? ''}`,
            projectId: line.projectId ?? undefined,
            departmentId: line.departmentId ?? undefined,
            costCenterId: line.costCenterId ?? undefined,
          })),
        },
        tx as never,
      );

      await tx.journalEntry.update({
        where: { id: journal.id },
        data: { status: 'REVERSED', reversedBy: userId, reversalReason: dto.reason },
      });

      return result;
    });
  }

  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    return prisma.journalEntry.findMany({
      where: { organizationId: identity.activeOrganizationId, sourceDocumentType: 'MANUAL_JOURNAL' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const journal = await this.journalRepo.findById(prisma, identity.activeOrganizationId, id);
    if (!journal) throw new NotFoundException(`Journal ${id} not found`);
    return journal;
  }

  private async requireDraft(prisma: ReturnType<TenancyService['getClient']>, organizationId: string, journalId: string) {
    const journal = await prisma.journalEntry.findFirst({
      where: { id: journalId, organizationId, status: 'DRAFT' },
    });
    if (!journal) throw new NotFoundException(`Journal ${journalId} not found in DRAFT status`);
    return journal;
  }
}
