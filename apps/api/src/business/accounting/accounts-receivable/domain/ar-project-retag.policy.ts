import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * AR project-tag reclassification (owner decision 2026-09-28, option C).
 *
 * Before 2026-09-28, invoice reversals (EVT-AR-002) and credit notes (EVT-AR-007) posted their
 * revenue line WITHOUT the project dimension the invoice's revenue credit carried. Company revenue
 * was right; each affected project's revenue — and its P&L — was overstated. Posting was fixed
 * forward in PR #226. Posted journals are never edited: each affected line is corrected by a
 * balanced reclassification in the same revenue account that moves the line's effect from "no
 * project" onto the intended project, linked back to the line it corrects.
 *
 * Pure: the script (`scripts/ar-project-retag.ts`) supplies the rows; this decides and verifies.
 */

export const RETAG_EVENT = 'RECLASS-AR-PROJECT-TAG';
export const RETAG_SOURCE_TYPE = 'MANUAL_JOURNAL';

/**
 * One correction per affected line, and the key that makes re-running a no-op. If an earlier
 * correction was itself reversed (e.g. from Manual Journals), the line is affected again and the
 * next correction gets a versioned key, so the posting service's idempotency never mistakes the
 * reversed one for a live correction.
 */
export function retagSourceId(lineId: string, priorCorrections = 0): string {
  return priorCorrections === 0 ? `ar-project-retag:${lineId}` : `ar-project-retag:${lineId}:v${priorCorrections + 1}`;
}

export type RetagSourceKind = 'INVOICE_REVERSAL' | 'CREDIT_NOTE';
export type RetagStatus =
  /** Ready to correct in the line's own accounting period. */
  | 'READY'
  /** A correction for this line is already posted — excluded. */
  | 'ALREADY_CORRECTED'
  /** The line's period is CLOSED or LOCKED: never posted silently; needs an explicit decision. */
  | 'BLOCKED_PERIOD';

/** An untagged reversal / credit-note revenue line, as the audit found it. */
export interface RetagLine {
  lineId: string;
  lineNumber: number;
  journalEntryId: string;
  journalNumber: string | null;
  accountingDate: string; // YYYY-MM-DD
  periodId: string | null;
  periodName: string | null;
  periodStatus: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  clientId: string | null;
  contractId: string | null;
  sourceKind: RetagSourceKind;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string | null;
  creditNoteId: string | null;
  creditNoteNumber: string | null;
  intendedProjectId: string;
  intendedProjectCode: string | null;
  /** A live (posted, not reversed) correction exists. */
  alreadyCorrected: boolean;
  /** Corrections posted for this line and later reversed — they no longer count. */
  priorCorrections: number;
}

export function retagStatus(line: RetagLine): RetagStatus {
  if (line.alreadyCorrected) return 'ALREADY_CORRECTED';
  if (line.periodStatus !== 'OPEN' && line.periodStatus !== 'REOPENED') return 'BLOCKED_PERIOD';
  return 'READY';
}

/**
 * The line's revenue effect that the intended project is missing, credit-normal: a reversal or
 * credit-note revenue DEBIT of 1,000 is −1,000 of revenue the project never saw. Correcting moves
 * exactly this onto the project, so project revenue changes by this amount (usually negative)
 * and the "no project" bucket by its negation; company revenue does not change.
 */
export function projectRevenueEffect(line: Pick<RetagLine, 'debit' | 'credit'>): Decimal {
  return new Decimal(line.credit).minus(new Decimal(line.debit));
}

export interface RetagCorrectionLine {
  accountId: string;
  debitAmount: Decimal;
  creditAmount: Decimal;
  projectId: string | null;
  clientId: string | null;
  contractId: string | null;
  memo: string;
}

/**
 * The balanced pair for one affected line, in the same account and for the exact amount:
 * the first line repeats the untagged line's effect WITH the intended project; the second
 * cancels it on the original untagged dimension. Every other dimension is carried unchanged on
 * both, so only the project moves.
 */
export function correctionLines(line: RetagLine): RetagCorrectionLine[] {
  const debit = new Decimal(line.debit);
  const credit = new Decimal(line.credit);
  const ref = `${line.journalNumber ?? line.journalEntryId} line ${line.lineNumber}`;
  return [
    {
      accountId: line.accountId,
      debitAmount: debit,
      creditAmount: credit,
      projectId: line.intendedProjectId,
      clientId: line.clientId,
      contractId: line.contractId,
      memo: `Project tag for ${ref}`,
    },
    {
      accountId: line.accountId,
      debitAmount: credit,
      creditAmount: debit,
      projectId: null,
      clientId: line.clientId,
      contractId: line.contractId,
      memo: `Clears untagged ${ref}`,
    },
  ];
}

export function correctionDescription(line: RetagLine, approvedBy: string): string {
  const source =
    line.sourceKind === 'CREDIT_NOTE'
      ? `credit note ${line.creditNoteNumber ?? line.creditNoteId} on invoice ${line.sourceInvoiceNumber ?? line.sourceInvoiceId}`
      : `reversal of invoice ${line.sourceInvoiceNumber ?? line.sourceInvoiceId}`;
  return (
    `Reclassification: revenue line ${line.journalNumber ?? line.journalEntryId}/${line.lineNumber} ` +
    `(${source}) was posted without project ${line.intendedProjectCode ?? line.intendedProjectId}. ` +
    `Approved by ${approvedBy}. Ref ${retagSourceId(line.lineId, line.priorCorrections)}.`
  );
}

/** Stable fingerprint of what the accountant approved: ids, amounts, intended projects. */
export function retagFingerprint(lines: RetagLine[]): string {
  const canonical = [...lines]
    .sort((a, b) => a.lineId.localeCompare(b.lineId))
    .map((l) =>
      [l.lineId, l.accountId, l.debit, l.credit, l.intendedProjectId, l.accountingDate, l.priorCorrections].join('|'),
    )
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Expected change in each project's revenue once `lines` are corrected. */
export function expectedProjectDeltas(lines: RetagLine[]): Map<string, Decimal> {
  const deltas = new Map<string, Decimal>();
  for (const line of lines) {
    const current = deltas.get(line.intendedProjectId) ?? new Decimal(0);
    deltas.set(line.intendedProjectId, current.plus(projectRevenueEffect(line)));
  }
  return deltas;
}

export interface RetagProof {
  ok: boolean;
  failures: string[];
}

/**
 * The post-condition, all of which must hold:
 * - every account's net balance is unchanged (so the trial balance and company revenue are);
 * - each affected project's revenue moved by exactly its expected delta;
 * - every other project's revenue (and the untagged bucket, beyond its expected delta) is unchanged.
 * Revenue maps are keyed by projectId, with '' for no project.
 */
export function proveRetag(input: {
  accountNetBefore: Map<string, Decimal>;
  accountNetAfter: Map<string, Decimal>;
  projectRevenueBefore: Map<string, Decimal>;
  projectRevenueAfter: Map<string, Decimal>;
  expectedDeltas: Map<string, Decimal>;
}): RetagProof {
  const failures: string[] = [];
  const zero = new Decimal(0);

  const accounts = new Set([...input.accountNetBefore.keys(), ...input.accountNetAfter.keys()]);
  for (const account of accounts) {
    const before = input.accountNetBefore.get(account) ?? zero;
    const after = input.accountNetAfter.get(account) ?? zero;
    if (!before.equals(after)) failures.push(`Account ${account} net changed: ${before} → ${after}`);
  }

  const untaggedDelta = [...input.expectedDeltas.values()].reduce((s, d) => s.minus(d), zero);
  const projects = new Set([...input.projectRevenueBefore.keys(), ...input.projectRevenueAfter.keys()]);
  for (const project of projects) {
    const before = input.projectRevenueBefore.get(project) ?? zero;
    const after = input.projectRevenueAfter.get(project) ?? zero;
    const expected = project === '' ? untaggedDelta : (input.expectedDeltas.get(project) ?? zero);
    if (!after.minus(before).equals(expected)) {
      failures.push(
        `Revenue for ${project || '(no project)'} moved ${after.minus(before)}, expected ${expected}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
