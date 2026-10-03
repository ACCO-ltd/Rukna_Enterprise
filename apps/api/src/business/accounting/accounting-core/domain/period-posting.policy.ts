/**
 * May a journal of `journalCategory` be posted into this accounting period? The ONE rule behind
 * `PeriodValidator.resolve` (the ledger's posting gate) and the "why blocked" read models
 * (ADR-043 Phase 2), so a screen never says "period open" over a posting the ledger refuses.
 *
 * Pure: the caller resolves the period covering the accounting date (and, when posting, reads its
 * status under a row lock); this decides.
 */
export type PeriodPostingBlock = 'NO_PERIOD' | 'PERIOD_CLOSED' | 'PERIOD_LOCKED';

/**
 * A LOCKED period is closed to ordinary business but still open to the entries that finish it:
 * December adjustments, and the year-end closing journal itself (`YearEndCloseService` requires
 * period 12 to be LOCKED before it runs).
 */
export const LOCKED_PERIOD_CATEGORIES = ['CLOSING_ADJUSTMENT', 'YEAR_END_CLOSE'] as const;

export interface PeriodPostingFacts {
  name: string;
  status: string;
}

export function periodPostingBlock(
  period: PeriodPostingFacts | null,
  journalCategory: string,
): PeriodPostingBlock | null {
  if (!period) return 'NO_PERIOD';
  if (period.status === 'CLOSED') return 'PERIOD_CLOSED';
  if (period.status === 'LOCKED' && !(LOCKED_PERIOD_CATEGORIES as readonly string[]).includes(journalCategory)) {
    return 'PERIOD_LOCKED';
  }
  return null;
}

/** The refusal in words — the exact messages the ledger has always returned. */
export function periodPostingBlockMessage(
  block: PeriodPostingBlock,
  ctx: { accountingDate: Date; periodName?: string; journalCategory: string },
): string {
  switch (block) {
    case 'NO_PERIOD':
      return `No accounting period covers ${ctx.accountingDate.toISOString().slice(0, 10)} for this organization`;
    case 'PERIOD_CLOSED':
      return `Accounting period "${ctx.periodName}" is CLOSED — no further postings allowed`;
    case 'PERIOD_LOCKED':
      return (
        `Period "${ctx.periodName}" is LOCKED — only ${LOCKED_PERIOD_CATEGORIES.join(' and ')} journals are accepted. ` +
        `Received category: ${ctx.journalCategory}`
      );
  }
}
