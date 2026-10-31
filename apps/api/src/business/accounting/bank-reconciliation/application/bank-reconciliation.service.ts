import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  BankLedgerLine,
  BankStatementSummary,
  BankStatementWorkspace,
  ImportBankStatementRequest,
  PostStatementLineRequest,
  RequestIdentity,
} from '@erp/types';

import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from '../../accounting-core/application/ports/accounting-posting.port.js';
import { parseDateOnly } from '../../accounting-core/domain/calendar-day.js';
import { cancelledOutLines, reconcile, statementAddsUp, suggestMatches } from '../domain/matching.js';
import { BankStatementRepository } from '../infrastructure/bank-statement.repository.js';

/** A real calendar day written YYYY-MM-DD (2026-02-31 is not one). */
const isDay = (value: string | undefined) => typeof value === 'string' && value.length === 10 && parseDateOnly(value) !== null;
const AMOUNT = /^-?\d+(\.\d{1,2})?$/;
const MAX_LINES = 5000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? '0');

type LedgerRow = {
  id: string;
  debitAmount: { toString(): string };
  creditAmount: { toString(): string };
  description: string | null;
  entry: { id: string; journalNumber: string | null; accountingDate: Date; reversalOfJournalEntryId?: string | null };
};

function ledgerView(l: LedgerRow, cutoff: Date | null = null, cancelled: Set<string> = new Set()): BankLedgerLine {
  return {
    broughtForward: cutoff !== null && l.entry.accountingDate < cutoff,
    cancelledOut: cancelled.has(l.id),
    journalLineId: l.id,
    journalEntryId: l.entry.id,
    journalNumber: l.entry.journalNumber,
    accountingDate: day(l.entry.accountingDate),
    description: l.description,
    amount: dec(l.debitAmount).minus(dec(l.creditAmount)).toFixed(2),
  };
}

/** A statement line changed by someone else between reading it and writing it. */
function changed(count: number): void {
  if (count !== 1) throw new ConflictException({ errorCode: 'LINE_CHANGED', message: 'This line changed a moment ago. Reload the statement.' });
}

function bad(errorCode: string, message: string, details?: Record<string, unknown>) {
  return new BadRequestException({ errorCode, message, ...(details ? { details } : {}) });
}

/**
 * Step 6 — bank reconciliation.
 *
 * Import a statement for a bank account (it must add up: opening plus lines equals closing). Each
 * statement line is then either matched to the posted ledger line on the bank's GL account that
 * moved the same money — the system suggests the unambiguous matches, a person accepts them — or,
 * for a charge or interest the ledger has never seen, posted from the line as a journal against an
 * account the person chooses (and matched to that journal's bank line). The statement reconciles
 * once every line is matched or posted and the ledger, less what the bank has not seen yet, equals
 * the statement's closing balance. A reconciled statement is frozen.
 *
 * Reconciliation of an account begins with its first imported statement: ledger lines dated before
 * that statement's start are taken as part of its opening balance (brought forward), not as
 * outstanding. An older cheque that has still not cleared therefore shows as the difference on
 * that first statement until it is presented and matched.
 *
 * Nothing here edits a posted journal: a match is a row on the statement side that points at the
 * ledger line, and a correction is a new posting.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly repo: BankStatementRepository,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly posting: IAccountingPostingPort,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async list(identity: RequestIdentity, bankAccountId?: string): Promise<BankStatementSummary[]> {
    const rows = await this.repo.list(this.repo.db(), identity.activeOrganizationId, bankAccountId);
    return rows.map((s) => ({
      id: s.id,
      bankAccountId: s.bankAccountId,
      bankName: s.bankAccount.bankName,
      accountName: s.bankAccount.accountName,
      periodStart: day(s.periodStart),
      statementDate: day(s.statementDate),
      openingBalance: dec(s.openingBalance).toFixed(2),
      closingBalance: dec(s.closingBalance).toFixed(2),
      status: s.status,
      lineCount: s._count.lines,
      unmatchedCount: s.lines.length,
      reconciledAt: s.reconciledAt?.toISOString() ?? null,
    }));
  }

  async import(identity: RequestIdentity, dto: ImportBankStatementRequest): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const db = this.repo.db();
    const bank = await this.repo.bankAccount(db, orgId, dto.bankAccountId);
    if (!bank) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: 'Bank account not found' });

    for (const [field, value] of [['periodStart', dto.periodStart], ['statementDate', dto.statementDate]] as const) {
      if (!isDay(value)) throw bad('DATE_INVALID', `${field} must be a real date written YYYY-MM-DD`, { field });
    }
    if (dto.periodStart > dto.statementDate) throw bad('PERIOD_INVALID', 'The statement period must start on or before its end date.');
    for (const [field, value] of [['openingBalance', dto.openingBalance], ['closingBalance', dto.closingBalance]] as const) {
      if (!AMOUNT.test(value)) throw bad('AMOUNT_INVALID', `${field} must be an amount`, { field });
    }
    if (dto.lines.length === 0) throw bad('NO_LINES', 'The statement has no lines.');
    if (dto.lines.length > MAX_LINES) throw bad('TOO_MANY_LINES', `Import at most ${MAX_LINES} lines at a time.`);

    const lines = dto.lines.map((l, index) => {
      const lineNumber = index + 1;
      if (!isDay(l.transactionDate)) throw bad('LINE_DATE_INVALID', `Line ${lineNumber}: the date must be a real date written YYYY-MM-DD`, { lineNumber });
      if (l.transactionDate < dto.periodStart || l.transactionDate > dto.statementDate) {
        throw bad('LINE_OUTSIDE_PERIOD', `Line ${lineNumber} is dated ${l.transactionDate}, outside the statement period.`, { lineNumber });
      }
      if (!AMOUNT.test(l.amount) || new Decimal(l.amount).isZero()) throw bad('LINE_AMOUNT_INVALID', `Line ${lineNumber}: the amount must be a non-zero amount`, { lineNumber });
      const description = l.description?.trim();
      if (!description) throw bad('LINE_DESCRIPTION_REQUIRED', `Line ${lineNumber} has no description.`, { lineNumber });
      return {
        lineNumber,
        transactionDate: new Date(`${l.transactionDate}T00:00:00.000Z`),
        description: description.slice(0, 500),
        reference: l.reference?.trim() ? l.reference.trim().slice(0, 100) : null,
        amount: new Decimal(l.amount),
      };
    });

    const opening = new Decimal(dto.openingBalance);
    const closing = new Decimal(dto.closingBalance);
    const check = statementAddsUp(opening, lines.map((l) => l.amount), closing);
    if (!check.adds) {
      throw bad('STATEMENT_DOES_NOT_ADD_UP', `Opening ${opening.toFixed(2)} plus the lines comes to ${check.computedClosing.toFixed(2)}, not the closing ${closing.toFixed(2)}. Check the file or the balances.`, {
        computedClosing: check.computedClosing.toFixed(2),
      });
    }

    // B-3 — statements follow each other: no overlapping period, and each opens where the last one
    // closed. A break means a statement is missing or the balances were keyed wrong; either way
    // reconciling it would hide the gap.
    const last = await this.repo.latest(db, orgId, bank.id);
    if (last) {
      const lastDay = last.statementDate.toISOString().slice(0, 10);
      const lastClosing = new Decimal(last.closingBalance.toString());
      if (dto.periodStart <= lastDay) {
        throw bad('STATEMENT_PERIOD_OVERLAPS', `The last statement for this account runs to ${lastDay}; this one must start after it.`, { lastStatementDate: lastDay });
      }
      if (!opening.eq(lastClosing)) {
        throw bad('OPENING_BALANCE_BREAK', `The last statement closed at ${lastClosing.toFixed(2)} on ${lastDay}; this one opens at ${opening.toFixed(2)}. Import the statement in between, or check the opening balance.`, {
          expectedOpening: lastClosing.toFixed(2),
          lastStatementDate: lastDay,
        });
      }
    }

    const created = await db.$transaction(async (tx) => {
      const statement = await this.repo.create(tx, {
        organizationId: orgId,
        bankAccountId: bank.id,
        periodStart: new Date(`${dto.periodStart}T00:00:00.000Z`),
        statementDate: new Date(`${dto.statementDate}T00:00:00.000Z`),
        currencyCode: bank.currencyCode,
        openingBalance: opening,
        closingBalance: closing,
        fileName: dto.fileName?.trim() ? dto.fileName.trim().slice(0, 255) : null,
        createdBy: identity.userId,
        lines,
      });
      await this.audit(tx, identity, statement.id, 'BANK_STATEMENT_IMPORTED', { bankAccountId: bank.id, lines: lines.length, closingBalance: closing.toFixed(2) });
      return statement;
    });
    return this.workspace(identity, created.id);
  }

  async workspace(identity: RequestIdentity, id: string): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const db = this.repo.db();
    const s = await this.requireStatement(orgId, id);
    const glAccountId = s.bankAccount.glAccountId;
    const [uncleared, balance, previous, cutoff, earlierOpen] = await Promise.all([
      this.repo.uncleared(db, orgId, glAccountId, s.statementDate),
      this.repo.ledgerBalance(db, orgId, glAccountId, s.statementDate),
      this.repo.previousReconciled(db, orgId, s.bankAccountId, s.statementDate),
      this.repo.firstPeriodStart(db, orgId, s.bankAccountId),
      s.status === 'OPEN' ? this.repo.earlierOpen(db, orgId, s.bankAccountId, s.statementDate) : Promise.resolve(null),
    ]);
    // Ledger lines dated before reconciliation began are in the first statement's opening balance.
    const broughtForward = (l: LedgerRow) => cutoff !== null && l.entry.accountingDate < cutoff;
    // BR-4 — a line and its reversal, both uncleared, cancel out: not outstanding, not a match.
    // Once both predate this statement they have nothing more to say and drop off the list.
    const cancelled = cancelledOutLines(
      uncleared.filter((l) => !broughtForward(l)).map((l) => ({
        id: l.id,
        journalEntryId: l.entry.id,
        reversalOfJournalEntryId: l.entry.reversalOfJournalEntryId ?? null,
        amount: dec(l.debitAmount).minus(dec(l.creditAmount)),
      })),
    );
    const shown = uncleared.filter((l) => !cancelled.has(l.id) || l.entry.accountingDate >= s.periodStart);
    const outstandingLines = uncleared.filter((l) => !broughtForward(l) && !cancelled.has(l.id));

    const unmatched = s.lines.filter((l) => l.matchStatus === 'UNMATCHED');
    const suggestions = s.status === 'OPEN'
      ? suggestMatches(
          unmatched.map((l) => ({ id: l.id, transactionDate: l.transactionDate, amount: dec(l.amount) })),
          uncleared.filter((l) => !cancelled.has(l.id)).map((l) => ({ id: l.id, accountingDate: l.entry.accountingDate, amount: dec(l.debitAmount).minus(dec(l.creditAmount)) })),
        )
      : [];
    const unclearedById = new Map(uncleared.map((l) => [l.id, l]));
    const suggestionOf = new Map(suggestions.map((x) => [x.statementLineId, unclearedById.get(x.journalLineId)!]));

    const ledgerBalance = dec(balance.debit).minus(dec(balance.credit));
    const r = reconcile({
      ledgerBalance,
      uncleared: outstandingLines.map((l) => dec(l.debitAmount).minus(dec(l.creditAmount))),
      statementClosing: dec(s.closingBalance),
    });

    return {
      statement: {
        id: s.id,
        bankAccountId: s.bankAccountId,
        bankName: s.bankAccount.bankName,
        accountName: s.bankAccount.accountName,
        periodStart: day(s.periodStart),
        statementDate: day(s.statementDate),
        openingBalance: dec(s.openingBalance).toFixed(2),
        closingBalance: dec(s.closingBalance).toFixed(2),
        status: s.status,
        lineCount: s.lines.length,
        unmatchedCount: unmatched.length,
        reconciledAt: s.reconciledAt?.toISOString() ?? null,
      },
      lines: s.lines.map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        transactionDate: day(l.transactionDate),
        description: l.description,
        reference: l.reference,
        amount: dec(l.amount).toFixed(2),
        matchStatus: l.matchStatus,
        matched: l.matchedJournalLine ? ledgerView(l.matchedJournalLine, cutoff) : null,
        suggestion: suggestionOf.has(l.id) ? ledgerView(suggestionOf.get(l.id)!, cutoff) : null,
        adjustmentJournalEntryId: l.adjustmentJournalEntryId ?? null,
      })),
      uncleared: shown.map((l) => ledgerView(l, cutoff, cancelled)),
      reconciliation: {
        ledgerBalance: ledgerBalance.toFixed(2),
        outstanding: r.outstanding.toFixed(2),
        adjustedLedger: r.adjustedLedger.toFixed(2),
        statementClosing: dec(s.closingBalance).toFixed(2),
        difference: r.difference.toFixed(2),
        balanced: r.balanced,
      },
      previousClosing: previous ? dec(previous.closingBalance).toFixed(2) : null,
      canReconcile: s.status === 'OPEN' && unmatched.length === 0 && r.balanced && !earlierOpen,
      earlierOpenStatementDate: earlierOpen ? day(earlierOpen.statementDate) : null,
    };
  }

  /** Match one statement line to one ledger line on the bank's GL account. */
  async match(identity: RequestIdentity, id: string, lineId: string, journalLineId: string): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const s = await this.requireOpen(orgId, id);
    const line = s.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException({ errorCode: 'LINE_NOT_FOUND', message: 'Statement line not found' });
    if (line.matchStatus !== 'UNMATCHED') throw new ConflictException({ errorCode: 'LINE_ALREADY_MATCHED', message: 'This line is already matched. Unmatch it first.' });
    await this.cleared(() => this.repo.db().$transaction(async (tx) => {
      await this.assertMatchable(tx, orgId, s.bankAccount.glAccountId, line, journalLineId);
      changed(await this.repo.setMatch(tx, line.id, 'UNMATCHED', { matchStatus: 'MATCHED', matchedJournalLineId: journalLineId, matchedAt: new Date(), matchedBy: identity.userId }));
    }));
    return this.workspace(identity, id);
  }

  /** Accept every unambiguous suggestion at once. */
  async acceptSuggestions(identity: RequestIdentity, id: string): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const s = await this.requireOpen(orgId, id);
    const view = await this.workspace(identity, id);
    const toAccept = view.lines.filter((l) => l.matchStatus === 'UNMATCHED' && l.suggestion);
    if (toAccept.length === 0) return view;
    await this.cleared(() => this.repo.db().$transaction(async (tx) => {
      for (const l of toAccept) {
        const line = s.lines.find((x) => x.id === l.id)!;
        await this.assertMatchable(tx, orgId, s.bankAccount.glAccountId, line, l.suggestion!.journalLineId);
        changed(await this.repo.setMatch(tx, l.id, 'UNMATCHED', { matchStatus: 'MATCHED', matchedJournalLineId: l.suggestion!.journalLineId, matchedAt: new Date(), matchedBy: identity.userId }));
      }
    }));
    return this.workspace(identity, id);
  }

  /** Undo a match. A line posted from here keeps its journal: reverse that journal to undo it. */
  async unmatch(identity: RequestIdentity, id: string, lineId: string): Promise<BankStatementWorkspace> {
    const s = await this.requireOpen(identity.activeOrganizationId, id);
    const line = s.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException({ errorCode: 'LINE_NOT_FOUND', message: 'Statement line not found' });
    if (line.matchStatus === 'POSTED') {
      throw new ConflictException({ errorCode: 'LINE_POSTED', message: 'This line was posted as a journal. Undo the posting instead.' });
    }
    if (line.matchStatus === 'MATCHED') {
      await this.repo.db().$transaction(async (tx) =>
        changed(await this.repo.setMatch(tx, line.id, 'MATCHED', { matchStatus: 'UNMATCHED', matchedJournalLineId: null, matchedAt: null, matchedBy: null })));
    }
    return this.workspace(identity, id);
  }

  /**
   * A line the ledger has never seen — a bank charge, interest — posted as a journal dated on the
   * line: the bank on one side, the chosen account on the other. Its bank line is matched at once.
   */
  async postLine(identity: RequestIdentity, id: string, lineId: string, dto: PostStatementLineRequest): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const s = await this.requireOpen(orgId, id);
    const line = s.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException({ errorCode: 'LINE_NOT_FOUND', message: 'Statement line not found' });
    if (line.matchStatus !== 'UNMATCHED') throw new ConflictException({ errorCode: 'LINE_ALREADY_MATCHED', message: 'This line is already matched.' });

    const db = this.repo.db();
    const account = await this.repo.account(db, orgId, dto.accountId);
    const version = account?.versions[0];
    if (!account || !version) throw new NotFoundException({ errorCode: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
    if (account.id === s.bankAccount.glAccountId) throw bad('ACCOUNT_IS_THE_BANK', 'Choose the account the charge or interest belongs to, not the bank itself.');
    if (!version.isPostingAllowed || version.isControlAccount) {
      throw bad('ACCOUNT_NOT_POSTABLE', `${account.code} ${version.name} does not take direct postings. Choose an expense or income account.`);
    }

    const amount = dec(line.amount);
    const moneyIn = amount.isPositive();
    const size = amount.abs();
    const memo = dto.memo?.trim() || line.description;
    // After an undo the line may be posted again: each posting has its own source key.
    const earlier = await this.repo.postingsFromLine(db, orgId, line.id);
    await db.$transaction(async (tx) => {
      const result = await this.posting.post(
        {
          organizationId: orgId,
          accountingDate: line.transactionDate,
          documentDate: line.transactionDate,
          description: `Bank statement ${day(s.statementDate)}, line ${line.lineNumber}: ${memo}`.slice(0, 500),
          currencyCode: s.currencyCode,
          eventType: 'EVT-BNK-001',
          sourceDocumentType: 'BANK_STATEMENT',
          sourceDocumentId: earlier === 0 ? line.id : `${line.id}:${earlier}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: identity.userId,
          lines: [
            {
              accountId: s.bankAccount.glAccountId,
              debitAmount: moneyIn ? size : new Decimal(0),
              creditAmount: moneyIn ? new Decimal(0) : size,
              sourceSubledgerType: 'BANK',
              memo,
            },
            {
              accountId: account.id,
              debitAmount: moneyIn ? new Decimal(0) : size,
              creditAmount: moneyIn ? size : new Decimal(0),
              memo,
            },
          ],
        },
        tx as never,
      );
      const bankLine = await this.repo.bankLineOf(tx, result.journalEntryId, s.bankAccount.glAccountId);
      changed(await this.repo.setMatch(tx, line.id, 'UNMATCHED', {
        matchStatus: 'POSTED',
        matchedJournalLineId: bankLine!.id,
        adjustmentJournalEntryId: result.journalEntryId,
        matchedAt: new Date(),
        matchedBy: identity.userId,
      }));
      await this.audit(tx, identity, s.id, 'BANK_STATEMENT_LINE_POSTED', { lineId: line.id, journalEntryId: result.journalEntryId, accountId: account.id, amount: amount.toFixed(2) });
    });
    return this.workspace(identity, id);
  }

  /**
   * BR-3 — undo a line posted from the statement by mistake (wrong account, wrong line): the journal's
   * mirror posts on the same day and the line is unmatched, ready to match or post again. The
   * journal and its mirror cancel out, so neither is left outstanding.
   */
  async undoPost(identity: RequestIdentity, id: string, lineId: string): Promise<BankStatementWorkspace> {
    const orgId = identity.activeOrganizationId;
    const s = await this.requireOpen(orgId, id);
    const line = s.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException({ errorCode: 'LINE_NOT_FOUND', message: 'Statement line not found' });
    if (line.matchStatus !== 'POSTED' || !line.adjustmentJournalEntryId) {
      throw new ConflictException({ errorCode: 'LINE_NOT_POSTED', message: 'Only a line posted from the statement can be undone.' });
    }
    const db = this.repo.db();
    const original = await this.repo.journal(db, line.adjustmentJournalEntryId);
    if (!original) throw new NotFoundException({ errorCode: 'JOURNAL_NOT_FOUND', message: 'The journal posted from this line was not found.' });
    await db.$transaction(async (tx) => {
      changed(await this.repo.setMatch(tx, line.id, 'POSTED', { matchStatus: 'UNMATCHED', matchedJournalLineId: null, adjustmentJournalEntryId: null, matchedAt: null, matchedBy: null }));
      const result = await this.posting.post(
        {
          organizationId: orgId,
          accountingDate: original.accountingDate,
          documentDate: original.accountingDate,
          description: `Undo: ${original.description ?? ''}`.slice(0, 500),
          currencyCode: original.currencyCode,
          eventType: 'EVT-BNK-002',
          sourceDocumentType: 'BANK_STATEMENT',
          sourceDocumentId: `reversal-${original.id}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: new Decimal(l.creditAmount.toString()),
            creditAmount: new Decimal(l.debitAmount.toString()),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            memo: l.description ? `Undo: ${l.description}`.slice(0, 500) : undefined,
          })),
        },
        tx as never,
      );
      await this.audit(tx, identity, s.id, 'BANK_STATEMENT_LINE_UNDONE', { lineId: line.id, journalEntryId: original.id, reversalJournalEntryId: result.journalEntryId });
    });
    return this.workspace(identity, id);
  }

  async reconcileStatement(identity: RequestIdentity, id: string): Promise<BankStatementWorkspace> {
    await this.requireOpen(identity.activeOrganizationId, id);
    const view = await this.workspace(identity, id);
    // BR-2 — statements reconcile in order: a later one assumes the earlier one's lines cleared.
    if (view.earlierOpenStatementDate) {
      throw new ConflictException({
        errorCode: 'EARLIER_STATEMENT_OPEN',
        message: `Reconcile the statement to ${view.earlierOpenStatementDate} first.`,
        details: { statementDate: view.earlierOpenStatementDate },
      });
    }
    if (view.statement.unmatchedCount > 0) {
      throw new ConflictException({ errorCode: 'LINES_UNMATCHED', message: `${view.statement.unmatchedCount} statement line(s) are not matched yet.` });
    }
    if (!view.reconciliation.balanced) {
      throw new ConflictException({
        errorCode: 'NOT_BALANCED',
        message: `The ledger, less what the bank has not seen yet, differs from the statement by ${view.reconciliation.difference}.`,
        details: { difference: view.reconciliation.difference },
      });
    }
    await this.repo.db().$transaction(async (tx) => {
      await this.repo.markReconciled(tx, id, identity.userId);
      await this.audit(tx, identity, id, 'BANK_STATEMENT_RECONCILED', { closingBalance: view.statement.closingBalance, outstanding: view.reconciliation.outstanding });
    });
    return this.workspace(identity, id);
  }

  /** Remove a statement imported by mistake — only while open and with nothing posted from it. */
  async remove(identity: RequestIdentity, id: string): Promise<void> {
    const s = await this.requireOpen(identity.activeOrganizationId, id);
    if (s.lines.some((l) => l.matchStatus === 'POSTED')) {
      throw new ConflictException({ errorCode: 'STATEMENT_HAS_POSTINGS', message: 'Journals were posted from this statement. Undo them before removing it.' });
    }
    // BR-2 — removing one from the middle would break the chain the next one opens from.
    const later = await this.repo.later(this.repo.db(), identity.activeOrganizationId, s.bankAccountId, s.statementDate);
    if (later) {
      throw new ConflictException({
        errorCode: 'STATEMENT_NOT_LATEST',
        message: `A later statement (to ${day(later.statementDate)}) follows this one. Remove that one first.`,
      });
    }
    await this.repo.db().$transaction(async (tx) => {
      await this.repo.delete(tx, s.id);
      await this.audit(tx, identity, s.id, 'BANK_STATEMENT_REMOVED', { bankAccountId: s.bankAccountId });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** A ledger line taken by another statement line at the same moment (its unique index): 409. */
  private async cleared<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ errorCode: 'LEDGER_LINE_ALREADY_CLEARED', message: 'That ledger line is already matched to another statement line.' });
      }
      throw err;
    }
  }

  private async requireStatement(orgId: string, id: string) {
    const s = await this.repo.find(this.repo.db(), orgId, id);
    if (!s) throw new NotFoundException({ errorCode: 'STATEMENT_NOT_FOUND', message: 'Bank statement not found' });
    return s;
  }

  private async requireOpen(orgId: string, id: string) {
    const s = await this.requireStatement(orgId, id);
    if (s.status !== 'OPEN') throw new ConflictException({ errorCode: 'STATEMENT_RECONCILED', message: 'This statement is reconciled and can no longer change.' });
    return s;
  }

  private async assertMatchable(
    tx: Parameters<BankStatementRepository['ledgerLine']>[0],
    orgId: string,
    glAccountId: string,
    line: { amount: { toString(): string }; lineNumber: number },
    journalLineId: string,
  ): Promise<void> {
    const ledger = await this.repo.ledgerLine(tx, orgId, journalLineId);
    if (!ledger || ledger.accountId !== glAccountId) {
      throw new NotFoundException({ errorCode: 'LEDGER_LINE_NOT_FOUND', message: 'That ledger line is not a posted line on this bank account.' });
    }
    if (ledger.statementMatch) throw new ConflictException({ errorCode: 'LEDGER_LINE_ALREADY_CLEARED', message: 'That ledger line is already matched to another statement line.' });
    const ledgerAmount = dec(ledger.debitAmount).minus(dec(ledger.creditAmount));
    if (!ledgerAmount.eq(dec(line.amount))) {
      throw bad('AMOUNTS_DIFFER', `Line ${line.lineNumber} is ${dec(line.amount).toFixed(2)} but the ledger line is ${ledgerAmount.toFixed(2)}. Post the difference from the statement instead.`);
    }
  }

  private async audit(tx: Parameters<TransactionalAuditOutboxService['record']>[0], identity: RequestIdentity, statementId: string, eventType: string, after: Record<string, unknown>) {
    await this.auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: eventType === 'BANK_STATEMENT_REMOVED' ? 'DELETE' : 'UPDATE',
      resourceType: 'BankStatement',
      resourceId: statementId,
      sourceCommand: `bank-statement.${eventType.toLowerCase()}`,
      eventType,
      idempotencyKey: `${eventType}:${statementId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      after,
    });
  }
}
