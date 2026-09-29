import { Injectable, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import type {
  IAccountingPostingPort,
  PostingCommand,
  PostingResult,
  TxClient,
} from '../application/ports/accounting-posting.port.js';
import { PeriodValidator } from '../application/validators/period.validator.js';
import { DoubleEntryValidator } from '../application/validators/double-entry.validator.js';
import { ControlAccountValidator } from '../application/validators/control-account.validator.js';
import { DocumentSequenceRepository } from './document-sequence.repository.js';
import { JournalRepository } from './journal.repository.js';

@Injectable()
export class AccountingPostingService implements IAccountingPostingPort {
  constructor(
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly journalRepo: JournalRepository,
  ) {}

  async post(command: PostingCommand, tx: TxClient): Promise<PostingResult> {
    // ── Idempotency guard ──────────────────────────────────────────────────────
    const existing = await this.journalRepo.findBySourceDocument(
      tx,
      command.organizationId,
      command.sourceDocumentType,
      command.sourceDocumentId,
      command.eventType,
    );
    if (existing) {
      if (existing.status === 'POSTED' || existing.status === 'REVERSED') {
        return {
          journalEntryId: existing.id,
          journalNumber: existing.journalNumber ?? '',
        };
      }
      // A non-terminal duplicate (DRAFT/SUBMITTED/APPROVED/REJECTED) is a state conflict, not a
      // server fault — 409 so monitoring and clients don't read it as an outage.
      throw new ConflictException(
        `Duplicate posting detected for ${command.sourceDocumentType}/${command.sourceDocumentId} ` +
        `event ${command.eventType} — existing journal ${existing.id} is in status ${existing.status}`,
      );
    }

    // ── Validate ───────────────────────────────────────────────────────────────
    DoubleEntryValidator.validate(command.lines);

    const period = await PeriodValidator.resolve(
      tx,
      command.organizationId,
      command.accountingDate,
      command.journalCategory,
    );

    await ControlAccountValidator.validate(tx, command.lines, command.postingOrigin);

    // ── Resolve account versions + build snapshot data ─────────────────────────
    const resolvedLines = await Promise.all(
      command.lines.map(async (line, idx) => {
        const version = await this.journalRepo.resolveAccountVersion(
          tx,
          line.accountId,
          command.accountingDate,
        );
        if (!version) {
          // Missing effective version is a chart-of-accounts/config condition, not an internal
          // fault — 422 so it is actionable (fix the account's effective dating) rather than a 500.
          throw new UnprocessableEntityException(
            `No effective account version found for account ${line.accountId} on ${command.accountingDate.toISOString().slice(0, 10)}`,
          );
        }

        const account = await tx.account.findUniqueOrThrow({
          where: { id: line.accountId },
          select: { code: true },
        });

        return {
          lineNumber: idx + 1,
          accountId: line.accountId,
          accountVersionId: version.id,
          accountCodeSnapshot: account.code,
          accountNameSnapshot: version.name,
          accountVersionNumber: version.versionNumber,
          debitAmount: line.debitAmount ?? new Decimal(0),
          creditAmount: line.creditAmount ?? new Decimal(0),
          description: line.memo ?? null,
          postingOrigin: command.postingOrigin,
          sourceSubledgerType: line.sourceSubledgerType ?? null,
          resolutionSource: line.resolutionSource ?? null,
          postingProfileVersionId: line.postingProfileVersionId ?? null,
          projectId: line.projectId ?? null,
          departmentId: line.departmentId ?? null,
          costCenterId: line.costCenterId ?? null,
          clientId: line.clientId ?? null,
          supplierId: line.supplierId ?? null,
          contractId: line.contractId ?? null,
          boqNodeId: line.boqNodeId ?? null,
          spendCategoryId: line.spendCategoryId ?? null,
          taxCodeId: line.taxCodeId ?? null,
        };
      }),
    );

    // ── Claim journal number ───────────────────────────────────────────────────
    const { formattedNumber } = await this.sequenceRepo.claimNext(
      tx,
      command.organizationId,
      'JOURNAL_ENTRY',
    );

    // ── Create journal entry + lines atomically ────────────────────────────────
    const now = new Date();
    let entry: { id: string; journalNumber: string | null };
    try {
      entry = await tx.journalEntry.create({
        data: {
          organizationId: command.organizationId,
          journalNumber: formattedNumber,
          accountingPeriodId: period.id,
          journalCategory: command.journalCategory,
          entryPurpose: command.entryPurpose,
          status: 'POSTED',
          documentDate: command.documentDate,
          accountingDate: command.accountingDate,
          postedAt: now,
          description: command.description,
          currencyCode: command.currencyCode,
          sourceDocumentType: command.sourceDocumentType,
          sourceDocumentId: command.sourceDocumentId,
          accountingEventId: command.eventType,
          reversalOfJournalEntryId: command.reversalOfJournalEntryId ?? null,
          createdBy: command.createdBy,
          approvedBy: command.approvedBy ?? null,
          approvedAt: command.approvedBy ? now : null,
          postedBy: command.createdBy,
          lines: {
            create: resolvedLines,
          },
        },
        select: { id: true, journalNumber: true },
      });
    } catch (err) {
      // Two concurrent posts of the same source event both passed the idempotency SELECT above
      // (neither saw the other's uncommitted row under READ COMMITTED); the loser hits the unique
      // key (org, sourceDocumentType, sourceDocumentId, accountingEventId). Surface a 409 (the
      // winner's journal is committed; the transaction is now aborted so we cannot re-read it here)
      // — retrying routes cleanly through the idempotency guard and returns the committed journal.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `Concurrent posting conflict for ${command.sourceDocumentType}/${command.sourceDocumentId} ` +
          `event ${command.eventType} — another transaction posted this journal first; retry to obtain it.`,
        );
      }
      throw err;
    }

    return {
      journalEntryId: entry.id,
      journalNumber: entry.journalNumber ?? formattedNumber,
    };
  }
}
