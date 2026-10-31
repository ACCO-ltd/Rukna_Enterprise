import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { JournalRepository } from '../../accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import type { GovernedEntity } from '@erp/types';
import {
  CANCELLABLE_STATUSES,
  JOURNAL_CURRENCY,
  journalAccountProblem,
  journalDay,
  journalProblem,
  reversalDateProblem,
  type JournalFacts,
} from '../domain/manual-journal-rules.js';

// The manual-journal governed entity name. Registering it in the shared `GovernedEntity`
// union lives in `packages/types` (owned by the parallel access-governance effort), so we
// consume the governance seam read-only with a localized cast rather than editing that file.
// At runtime the resolver takes `entityType: string`; the cast only satisfies the compiler.
const MANUAL_JOURNAL_ENTITY = 'ManualJournal' as GovernedEntity;

export interface ManualJournalLineDto {
  accountId: string;
  debitAmount?: number;
  creditAmount?: number;
  memo?: string;
  projectId?: string;
  departmentId?: string;
  costCenterId?: string;
}

export interface CreateManualJournalDto {
  accountingDate: string;
  documentDate?: string;
  description: string;
  currencyCode?: string;
  lines: ManualJournalLineDto[];
  /** G-2 — an accrual reverses itself on this date when it posts. */
  autoReverseOn?: string;
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

/** A draft journal line as typed; account snapshots are taken when the journal posts. */
function draftLine(line: ManualJournalLineDto, idx: number) {
  return {
    lineNumber: idx + 1,
    accountId: line.accountId,
    accountCodeSnapshot: '',
    accountNameSnapshot: '',
    accountVersionNumber: 0,
    debitAmount: new Decimal(line.debitAmount ?? 0),
    creditAmount: new Decimal(line.creditAmount ?? 0),
    postingOrigin: 'MANUAL' as const,
    description: line.memo ?? null,
    projectId: line.projectId ?? null,
    departmentId: line.departmentId ?? null,
    costCenterId: line.costCenterId ?? null,
  };
}

@Injectable()
export class ManualJournalService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly journalRepo: JournalRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async create(identity: RequestIdentity, dto: CreateManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    await this.assertWritable(prisma, orgId, dto);
    // Ensure sequence exists for manual journals
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'JOURNAL_ENTRY', 'JE-');

    return prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        journalCategory: 'GENERAL',
        entryPurpose: 'NORMAL',
        status: 'DRAFT',
        ...this.headerData(dto),
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId: `draft-${Date.now()}`,
        accountingEventId: null,
        createdBy: userId,
        lines: { create: dto.lines.map(draftLine) },
      },
      include: { lines: true },
    });
  }

  /**
   * Phase 0 H2 — edit a draft, or correct a rejected journal for resubmission. Replaces the header
   * and every line; a REJECTED journal returns to DRAFT (its rejection reason stays on record until
   * the next decision). Only the preparer edits: anyone else editing would become a second preparer
   * who could then approve it as the "second person" (ADR-022 CONST-DOA-003).
   */
  async update(identity: RequestIdentity, journalId: string, dto: CreateManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const journal = await prisma.journalEntry.findFirst({
      where: { id: journalId, organizationId: orgId, sourceDocumentType: 'MANUAL_JOURNAL' },
    });
    if (!journal) throw new NotFoundException(`Journal ${journalId} not found`);
    if (journal.status !== 'DRAFT' && journal.status !== 'REJECTED') {
      throw new ConflictException({
        errorCode: 'JOURNAL_NOT_EDITABLE',
        message: `Only a draft or rejected journal can be edited (status: ${journal.status}).`,
      });
    }
    if (journal.createdBy !== userId) {
      throw new ForbiddenException({
        errorCode: 'JOURNAL_NOT_PREPARER',
        message: 'Only the person who prepared this journal can edit it.',
      });
    }
    await this.assertWritable(prisma, orgId, dto);

    return prisma.$transaction(async (tx) => {
      // Guarded on the status read above, so a concurrent submit or approval wins.
      const claimed = await tx.journalEntry.updateMany({
        where: { id: journal.id, status: journal.status },
        data: {
          status: 'DRAFT',
          ...this.headerData(dto),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('The journal changed while it was being edited; reload and retry.');
      await tx.journalLine.deleteMany({ where: { journalEntryId: journal.id } });
      await tx.journalLine.createMany({ data: dto.lines.map((line, idx) => ({ journalEntryId: journal.id, ...draftLine(line, idx) })) });
      return tx.journalEntry.findUniqueOrThrow({ where: { id: journal.id }, include: { lines: true } });
    });
  }

  async submit(identity: RequestIdentity, journalId: string) {
    const prisma = this.tenancyService.getClient();
    const journal = await this.requireDraft(prisma, identity.activeOrganizationId, journalId);
    // A draft saved before these rules existed, or whose account has since become a heading or
    // gone inactive, is stopped here rather than in the approver's queue.
    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: journal.id }, orderBy: { lineNumber: 'asc' } });
    await this.assertWritable(prisma, identity.activeOrganizationId, {
      accountingDate: journal.accountingDate.toISOString().slice(0, 10),
      currencyCode: journal.currencyCode,
      lines: lines.map((l) => ({ accountId: l.accountId, debitAmount: Number(l.debitAmount), creditAmount: Number(l.creditAmount) })),
    });

    // Governance seam (ADR-011). When an active binding exists for this manual-journal
    // transition, the seam opens an approval instance and this throws 409 with the
    // approvalInstanceId — the journal stays DRAFT until a REAL authorized approval
    // completes. When no binding is configured the gate is null and we proceed, WITHOUT
    // writing any approval metadata (approvedBy/approvedAt stay null — see post()).
    const amount = await this.journalAmount(prisma, journal.id);
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        MANUAL_JOURNAL_ENTITY,
        'DRAFT',
        'SUBMITTED',
        journal.id,
        amount,
      ),
      'Manual journal submission requires workflow approval.',
    );

    const moved = await prisma.journalEntry.updateMany({
      where: { id: journal.id, status: 'DRAFT' },
      data: {
        status: 'SUBMITTED',
        submittedBy: identity.userId,
        submittedAt: new Date(),
      },
    });
    this.changed(moved.count);
    return prisma.journalEntry.findUniqueOrThrow({ where: { id: journal.id } });
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

    // ADR-022 CONST-DOA-003: the journal preparer cannot approve the same journal — unless they
    // hold `post-own:journal` (ADR-022 amendment 2026-10-27).
    if (dto.approved && !this.mayActOnOwnJournal(identity, journal.createdBy)) {
      await this.sod.assertAllowed({
        organizationId: orgId,
        action: 'APPROVE_MANUAL_JOURNAL',
        actorUserId: userId,
        journalPreparerUserId: journal.createdBy,
      });
    }

    if (!dto.approved) {
      if (!dto.rejectionReason?.trim()) {
        throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the journal is being returned.' });
      }
      const rejected = await prisma.journalEntry.updateMany({
        where: { id: journal.id, status: 'SUBMITTED' },
        data: { status: 'REJECTED', rejectedBy: userId, rejectedAt: new Date(), rejectionReason: dto.rejectionReason.trim() },
      });
      this.changed(rejected.count);
      return prisma.journalEntry.findUniqueOrThrow({ where: { id: journal.id } });
    }

    const approved = await prisma.journalEntry.updateMany({
      where: { id: journal.id, status: 'SUBMITTED' },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() },
    });
    this.changed(approved.count);
    return prisma.journalEntry.findUniqueOrThrow({ where: { id: journal.id } });
  }

  async post(identity: RequestIdentity, journalId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    // A journal is post-eligible from SUBMITTED or APPROVED. Reaching SUBMITTED already
    // cleared the ADR-011 governance gate (see submit()): either no binding was configured
    // (ungoverned — approvedBy stays null), or a binding was configured and the workflow
    // approval completed and was consumed by the seam before the transition proceeded. An
    // APPROVED status carries a real approver recorded by approve(). Either way, approvedBy
    // below is only ever a genuine value — never fabricated.
    const journal = await prisma.journalEntry.findFirst({
      where: {
        id: journalId,
        organizationId: orgId,
        status: { in: ['SUBMITTED', 'APPROVED'] },
      },
      include: { lines: true },
    });
    if (!journal) {
      throw new NotFoundException(
        `Journal ${journalId} not found in a postable status (SUBMITTED or APPROVED)`,
      );
    }

    // ADR-022 CONST-DOA-003: journal preparer ≠ journal approver. A journal posted straight from
    // SUBMITTED has no recorded approver, so the person posting it is its only second pair of
    // eyes — the preparer must not be that person, or they could draft, submit and post alone.
    // The check honours the org's JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL toggle, like approve(),
    // and is waived for a preparer holding `post-own:journal` (ADR-022 amendment 2026-10-27).
    if (
      journal.status === 'SUBMITTED' &&
      !journal.approvedBy &&
      !this.mayActOnOwnJournal(identity, journal.createdBy)
    ) {
      await this.sod.assertAllowed({
        organizationId: orgId,
        action: 'APPROVE_MANUAL_JOURNAL',
        actorUserId: userId,
        journalPreparerUserId: journal.createdBy,
      });
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

          return {
            accountId: line.accountId,
            debitAmount: line.debitAmount as unknown as Decimal,
            creditAmount: line.creditAmount as unknown as Decimal,
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

      // The posting engine has created the canonical GL entry, with its own copy of
      // every line. This record was only ever the authoring/workflow staging row, so
      // its lines must go: every report aggregates `JournalLine` filtered on
      // `entry.status = 'POSTED'`, and leaving them here counted each manual journal
      // twice in the trial balance, both P&Ls, the balance sheet and project actual
      // cost. Debits and credits doubled together, so nothing that checks balance
      // could ever catch it.
      //
      // The row itself stays — it carries who drafted, submitted and approved — and
      // points at the entry that replaced it, so the workflow trail leads to the
      // posting rather than competing with it.
      await tx.journalLine.deleteMany({ where: { journalEntryId: journalId } });
      await tx.journalEntry.update({
        where: { id: journalId },
        data: {
          status: 'POSTED',
          postedBy: userId,
          postedAt: new Date(),
          replacedByJournalEntryId: result.journalEntryId,
        },
      });

      // Carry the submission evidence onto the entry that actually posted, so the
      // audit trail reads off the canonical journal instead of only the staging row.
      await tx.journalEntry.update({
        where: { id: result.journalEntryId },
        data: { submittedBy: journal.submittedBy, submittedAt: journal.submittedAt },
      });

      // G-2 — an accrual reverses itself: the mirror posts now, dated the reversal day, in the same
      // transaction (both post or neither does). Its period must be open, like any posting.
      if (journal.autoReverseOn) {
        const reversal = await this.postingPort.post(
          {
            organizationId: orgId,
            accountingDate: journal.autoReverseOn,
            documentDate: journal.autoReverseOn,
            description: `Automatic reversal of ${result.journalNumber}: ${journal.description}`,
            currencyCode: journal.currencyCode,
            eventType: `MANUAL-REVERSAL-${result.journalEntryId}`,
            sourceDocumentType: 'MANUAL_JOURNAL',
            sourceDocumentId: `reversal-${result.journalEntryId}`,
            journalCategory: journal.journalCategory,
            entryPurpose: 'REVERSAL',
            postingOrigin: 'MANUAL',
            reversalOfJournalEntryId: result.journalEntryId,
            createdBy: userId,
            approvedBy: journal.approvedBy ?? undefined,
            lines: lines.map((line) => ({
              ...line,
              debitAmount: line.creditAmount,
              creditAmount: line.debitAmount,
              memo: `Reversal: ${line.memo ?? ''}`,
            })),
          },
          tx as never,
        );
        await tx.journalEntry.update({
          where: { id: result.journalEntryId },
          data: { autoReverseOn: journal.autoReverseOn, reversedBy: userId, reversalReason: 'Automatic reversal (accrual)' },
        });
        return { ...result, autoReversal: reversal };
      }

      return result;
    });
  }

  async reverse(identity: RequestIdentity, dto: ReverseManualJournalDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const requested = await prisma.journalEntry.findFirst({
      where: { id: dto.journalId, organizationId: orgId },
      include: { lines: true },
    });
    if (!requested) throw new NotFoundException(`Journal ${dto.journalId} not found`);

    // A manual journal's authoring row is replaced at post time by the canonical GL
    // entry (see post()). Reversing has to target whichever of the two actually
    // carries the lines, so callers holding either id land on the same journal.
    const journal = requested.replacedByJournalEntryId
      ? await prisma.journalEntry.findFirstOrThrow({
          where: { id: requested.replacedByJournalEntryId, organizationId: orgId },
          include: { lines: true },
        })
      : requested;

    if (journal.status !== 'POSTED') {
      throw new NotFoundException(`Journal ${dto.journalId} is ${journal.status} — only a POSTED journal can be reversed`);
    }
    if (journal.reversalOfJournalEntryId) {
      throw new ConflictException(`Journal ${dto.journalId} is already a reversal — cannot reverse a reversal`);
    }
    // Only a manual journal is reversed here. A system journal (invoice, bill, receipt, payment,
    // opening balance, year-end close) has a source document whose balances move with it;
    // mirroring the journal alone would leave that document's subledger disagreeing with the GL.
    // Such journals are reversed through their own document's reverse command.
    if (journal.sourceDocumentType !== 'MANUAL_JOURNAL') {
      throw new BadRequestException(
        `Journal ${journal.journalNumber ?? journal.id} was posted by a ${journal.sourceDocumentType} — reverse it from that document, not as a manual journal`,
      );
    }

    // Reversing twice would post the mirror entry twice and take the accounts to the
    // opposite of the original. One reversal per journal.
    const existingReversal = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, reversalOfJournalEntryId: journal.id, status: 'POSTED' },
      select: { id: true, journalNumber: true },
    });
    if (existingReversal) {
      throw new ConflictException(
        `Journal ${journal.journalNumber ?? journal.id} is already reversed by ${existingReversal.journalNumber ?? existingReversal.id}`,
      );
    }

    const dateProblem = reversalDateProblem(dto.reversalDate, journal.accountingDate);
    if (dateProblem) throw new BadRequestException(dateProblem);
    const reversalDate = journalDay(dto.reversalDate)!;

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
            memo: `Reversal: ${line.description ?? ''}`,
            projectId: line.projectId ?? undefined,
            departmentId: line.departmentId ?? undefined,
            costCenterId: line.costCenterId ?? undefined,
          })),
        },
        tx as never,
      );

      // The original stays POSTED. A reversal is a second posting that offsets the
      // first, not an erasure of it: every report filters on `status = 'POSTED'`, so
      // moving the original out of that set would remove its lines *and* add the
      // mirror lines, leaving the accounts at minus the original amount. Reversal is
      // recorded by the link and the stamps below, and read back through
      // `reversalOfJournalEntryId`.
      await tx.journalEntry.update({
        where: { id: journal.id },
        data: { reversedBy: userId, reversalReason: dto.reason },
      });

      return result;
    });
  }

  async findAll(identity: RequestIdentity, projectId?: string) {
    const prisma = this.tenancyService.getClient();
    // `replacedByJournalEntryId: null` hides the authoring rows of journals that have
    // already posted, so the list shows one row per journal instead of the staging
    // record and the GL entry side by side. Unposted drafts have no replacement and
    // still appear.
    return prisma.journalEntry.findMany({
      where: {
        organizationId: identity.activeOrganizationId,
        sourceDocumentType: 'MANUAL_JOURNAL',
        replacedByJournalEntryId: null,
        // ADR-043: a journal belongs to a project when any of its lines is coded to it.
        ...(projectId ? { lines: { some: { projectId } } } : {}),
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * One journal with who did what by name, the journals around it (its reversal, what it reverses)
   * and the person who prepared it — for a posted manual journal that is the draft's author, not
   * whoever pressed Post.
   */
  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const journal = await this.journalRepo.findById(prisma, orgId, id);
    if (!journal) throw new NotFoundException({ errorCode: 'JOURNAL_NOT_FOUND', message: 'This journal does not exist.' });
    const related = await this.journalRepo.related(prisma, orgId, journal);
    const preparedBy = related.draft?.createdBy ?? journal.createdBy;
    const names = await this.journalRepo.userNames(prisma, [
      preparedBy, journal.createdBy, journal.submittedBy, journal.approvedBy, journal.postedBy,
      journal.rejectedBy, journal.reversedBy, journal.cancelledBy,
    ]);
    const name = (u: string | null | undefined) => (u ? (names.get(u) ?? null) : null);
    return {
      ...journal,
      preparedBy,
      preparedByName: name(preparedBy),
      submittedByName: name(journal.submittedBy),
      approvedByName: name(journal.approvedBy),
      postedByName: name(journal.postedBy ?? (journal.status === 'POSTED' ? journal.createdBy : null)),
      rejectedByName: name(journal.rejectedBy),
      reversedByName: name(journal.reversedBy),
      cancelledByName: name(journal.cancelledBy),
      reversals: related.reversals,
      reversalOf: related.reversalOf,
    };
  }

  /**
   * GL-J — set aside a journal that has not reached the ledger (a draft, one waiting for approval,
   * one approved but not posted, one returned). Nothing posts; the row stays, marked, with why.
   */
  async cancel(identity: RequestIdentity, journalId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    if (!reason?.trim()) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the journal is being cancelled.' });
    const journal = await prisma.journalEntry.findFirst({
      where: { id: journalId, organizationId: orgId, sourceDocumentType: 'MANUAL_JOURNAL' },
      select: { id: true, status: true },
    });
    if (!journal) throw new NotFoundException({ errorCode: 'JOURNAL_NOT_FOUND', message: 'This journal does not exist.' });
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(journal.status)) {
      throw new ConflictException({
        errorCode: 'JOURNAL_NOT_CANCELLABLE',
        message: journal.status === 'POSTED'
          ? 'A posted journal is in the ledger; reverse it instead.'
          : 'This journal is already cancelled.',
      });
    }
    const moved = await prisma.journalEntry.updateMany({
      where: { id: journal.id, status: journal.status },
      data: { status: 'CANCELLED', cancelledBy: userId, cancelledAt: new Date(), cancellationReason: reason.trim() },
    });
    this.changed(moved.count);
    return this.findById(identity, journal.id);
  }

  /** GL-J — every posted entry, whatever posted it, dated in the range (the ledger's day book). */
  async entries(identity: RequestIdentity, fromDate: string, toDate: string) {
    const from = journalDay(fromDate);
    const to = journalDay(toDate);
    if (!from || !to) throw new BadRequestException({ errorCode: 'JOURNAL_DATE_INVALID', message: 'fromDate and toDate must be real dates written YYYY-MM-DD.' });
    if (from > to) throw new BadRequestException({ errorCode: 'DATE_RANGE_INVALID', message: 'fromDate must not be after toDate.' });
    return this.journalRepo.postedEntries(this.tenancyService.getClient(), identity.activeOrganizationId, from, to);
  }

  private headerData(dto: CreateManualJournalDto) {
    const accountingDate = journalDay(dto.accountingDate)!;
    return {
      accountingDate,
      documentDate: journalDay(dto.documentDate) ?? accountingDate,
      description: dto.description.trim(),
      currencyCode: JOURNAL_CURRENCY,
      autoReverseOn: journalDay(dto.autoReverseOn),
    };
  }

  /** The journal as written, and every account it names, must be usable — or a 400 saying which line. */
  private async assertWritable(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    dto: Omit<JournalFacts, 'lines'> & { lines: readonly { accountId: string; debitAmount?: number | null; creditAmount?: number | null }[] },
  ) {
    const problem = journalProblem(dto);
    if (problem) throw new BadRequestException(problem);
    const facts = await this.journalRepo.accountFacts(prisma, organizationId, dto.lines.map((l) => l.accountId), journalDay(dto.accountingDate)!);
    for (const [i, line] of dto.lines.entries()) {
      const accountProblem = journalAccountProblem(i + 1, facts.get(line.accountId) ?? null);
      if (accountProblem) throw new BadRequestException(accountProblem);
    }
  }

  /** A guarded status move that matched nothing: someone else acted on the journal first. */
  private changed(count: number) {
    if (count !== 1) {
      throw new ConflictException({ errorCode: 'JOURNAL_CHANGED', message: 'The journal changed while you were working on it; reload and try again.' });
    }
  }

  /**
   * ADR-022 amendment (2026-10-27): a preparer holding `post-own:journal` may approve and post their
   * own journal without a second person. ACCO's finance team is small; the CFO and Finance Officer
   * hold it, other journal users still need a second pair of eyes. It never widens what anyone else
   * may do: for a journal prepared by someone else the ordinary rule applies.
   */
  private mayActOnOwnJournal(identity: RequestIdentity, preparerUserId: string): boolean {
    return (
      identity.userId === preparerUserId &&
      identity.permissions.includes(PERMISSIONS.journalsPostOwn)
    );
  }

  private async requireDraft(prisma: ReturnType<TenancyService['getClient']>, organizationId: string, journalId: string) {
    const journal = await prisma.journalEntry.findFirst({
      where: { id: journalId, organizationId, status: 'DRAFT' },
    });
    if (!journal) throw new NotFoundException(`Journal ${journalId} not found in DRAFT status`);
    return journal;
  }

  /**
   * The journal's monetary size for ADR-022 amount-band routing: the total debit side
   * (equal to the total credit side for a balanced journal). Returns null when there are
   * no lines, so amount-less bindings still resolve via catch-all.
   */
  private async journalAmount(
    prisma: ReturnType<TenancyService['getClient']>,
    journalId: string,
  ): Promise<Decimal | null> {
    const agg = await prisma.journalLine.aggregate({
      where: { journalEntryId: journalId },
      _sum: { debitAmount: true },
    });
    const total = agg._sum.debitAmount;
    return total === null || total === undefined ? null : new Decimal(total.toString());
  }
}
