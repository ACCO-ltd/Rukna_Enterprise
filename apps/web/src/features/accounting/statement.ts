import { toMinorUnits } from '@/lib/money';

import { accountName, currentVersion } from './account-display';
import { chartSections } from './coa-tree';
import type { Account, AccountClass } from './types';

/**
 * R — a financial statement laid out like the chart of accounts: each class a section, sub-accounts
 * under their heading, a heading carrying the sum of what is under it. One or more amount columns
 * (a comparative balance sheet has two, a monthly comparison thirteen).
 */
export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  depth: number;
  heading: boolean;
  /** Minor units on the class's side, one per column. */
  amounts: number[];
}

export interface StatementSection {
  accountClass: AccountClass;
  lines: StatementLine[];
  totals: number[];
}

/** An account's figure on its class's side (income and liabilities as credits), as a decimal string. */
export type ColumnFigures = ReadonlyMap<string, string>;

const DEBIT_SIDE: ReadonlySet<AccountClass> = new Set(['ASSET', 'EXPENSE', 'COST_OF_SALES']);

function asBalances(accounts: readonly Account[], figures: ColumnFigures) {
  const cls = new Map(accounts.map((a) => [a.id, currentVersion(a)?.accountClass]));
  const map = new Map<string, { debit: string; credit: string }>();
  for (const [id, amount] of figures) {
    const c = cls.get(id);
    map.set(id, c && DEBIT_SIDE.has(c) ? { debit: amount, credit: '0' } : { debit: '0', credit: amount });
  }
  return map;
}

/**
 * The sections for `classes`, with one amount per column. A line is kept when any column carries
 * a figure; a heading is kept when anything under it does. Accounts in `figures` that the chart
 * does not list (it should not happen) are added at the top level so no figure is lost.
 */
export function statementSections(
  accounts: readonly Account[],
  columns: readonly ColumnFigures[],
  classes: readonly AccountClass[],
  /** What the report says about each account, for one the chart does not list. */
  fallback: ReadonlyMap<string, { accountClass: AccountClass; code: string; name: string }> = new Map(),
): StatementSection[] {
  const known = new Set(accounts.map((a) => a.id));
  const perColumn = columns.map((figures) => chartSections(accounts, asBalances(accounts, figures), { showInactive: true }));

  const result: StatementSection[] = [];
  for (const accountClass of classes) {
    const sectionsByColumn = perColumn.map((sections) => sections.find((s) => s.accountClass === accountClass));
    const base = sectionsByColumn[0];
    const amountsById = new Map<string, number[]>();
    sectionsByColumn.forEach((section, col) => {
      for (const row of section?.rows ?? []) {
        const amounts = amountsById.get(row.account.id) ?? columns.map(() => 0);
        amounts[col] = row.balanceMinor;
        amountsById.set(row.account.id, amounts);
      }
    });

    const lines: StatementLine[] = (base?.rows ?? [])
      .map((row) => ({
        accountId: row.account.id,
        code: row.account.code,
        name: accountName(row.account),
        depth: row.depth,
        heading: row.heading,
        amounts: amountsById.get(row.account.id) ?? columns.map(() => 0),
      }))
      .filter((line) => line.amounts.some((m) => m !== 0));

    const totals = sectionsByColumn.map((s) => s?.totalMinor ?? 0);
    result.push({ accountClass, lines, totals });
  }

  // Figures for accounts the chart does not list, so no amount silently drops.
  columns.forEach((figures, col) => {
    for (const [id, amount] of figures) {
      if (known.has(id)) continue;
      const minor = toMinorUnits(amount, 2);
      const section = result.find((r) => r.accountClass === fallback.get(id)?.accountClass) ?? result[0];
      if (!section || minor === 0) continue;
      const existing = section.lines.find((l) => l.accountId === id);
      if (existing) existing.amounts[col] = minor;
      else {
        const amounts = columns.map(() => 0);
        amounts[col] = minor;
        section.lines.push({ accountId: id, code: fallback.get(id)?.code ?? '', name: fallback.get(id)?.name ?? id, depth: 0, heading: false, amounts });
      }
      section.totals[col] = (section.totals[col] ?? 0) + minor;
    }
  });

  return result;
}

/** Figures from a report's lines: account id → amount. */
export function figuresOf(lines: ReadonlyArray<{ accountId: string; amount?: string; balance?: string }>): Map<string, string> {
  return new Map(lines.map((l) => [l.accountId, l.amount ?? l.balance ?? '0']));
}

export const REPORT_RANGES = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** The first and last day of a reporting period, from today. Quarters are calendar quarters. */
export function reportRange(range: ReportRange, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (range) {
    case 'month':
      return { from: day(y, m, 1), to: day(y, m + 1, 0) };
    case 'lastMonth':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: day(y, q, 1), to: day(y, q + 3, 0) };
    }
    case 'year':
      return { from: day(y, 1, 1), to: day(y, 12, 31) };
    case 'lastYear':
      return { from: day(y - 1, 1, 1), to: day(y - 1, 12, 31) };
  }
}

export const AS_OF_PRESETS = ['today', 'endLastMonth', 'endLastYear'] as const;
export type AsOfPreset = (typeof AS_OF_PRESETS)[number];

export function asOfDate(preset: AsOfPreset, today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (preset === 'endLastMonth') return day(y, m, 0);
  if (preset === 'endLastYear') return day(y - 1, 12, 31);
  return today;
}
