import { fromMinorUnits, toMinorUnits } from '@/lib/money';

import { currentVersion } from './account-display';
import type { Account, AccountClass } from './types';

/** GL-C — the chart reads in this order, as a balance sheet then a profit and loss. */
export const CLASS_ORDER: AccountClass[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COST_OF_SALES', 'EXPENSE'];

/** Debit-side classes add debits; the rest add credits. A contra account (accumulated depreciation) reads negative. */
const DEBIT_SIDE: ReadonlySet<AccountClass> = new Set(['ASSET', 'EXPENSE', 'COST_OF_SALES']);

export interface ChartRow {
  account: Account;
  depth: number;
  heading: boolean;
  /** Kept by the system: a control account or a system-only one. */
  systemKept: boolean;
  /** On the class's side, in minor units; a heading's is the sum of everything under it. */
  balanceMinor: number;
  hasChildren: boolean;
}

export interface ChartSection {
  accountClass: AccountClass;
  rows: ChartRow[];
  totalMinor: number;
}

export const minorToText = (minor: number) => fromMinorUnits(minor, 2);

/**
 * The chart as sections by class, each depth-first by code with sub-accounts under their heading,
 * and a heading's balance rolled up from the accounts under it. `balances` holds each account's
 * posted debits and credits (decimal strings).
 */
export function chartSections(
  accounts: readonly Account[],
  balances: ReadonlyMap<string, { debit: string; credit: string }>,
  opts: { showInactive?: boolean } = {},
): ChartSection[] {
  const versions = new Map(accounts.map((a) => [a.id, currentVersion(a)] as const));
  const children = new Map<string | null, Account[]>();
  for (const a of accounts) {
    const parent = versions.get(a.id)?.parentAccountId ?? null;
    const key = parent && versions.has(parent) ? parent : null;
    children.set(key, [...(children.get(key) ?? []), a]);
  }
  for (const list of children.values()) list.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));

  const own = (a: Account, cls: AccountClass) => {
    const b = balances.get(a.id);
    if (!b) return 0;
    const net = toMinorUnits(b.debit, 2) - toMinorUnits(b.credit, 2);
    return DEBIT_SIDE.has(cls) ? net : -net;
  };

  const sections = new Map<AccountClass, ChartSection>(CLASS_ORDER.map((c) => [c, { accountClass: c, rows: [], totalMinor: 0 }]));
  const walk = (a: Account, depth: number, seen: Set<string>): number => {
    if (seen.has(a.id)) return 0;
    seen.add(a.id);
    const v = versions.get(a.id);
    const cls = v?.accountClass ?? 'ASSET';
    const section = sections.get(cls)!;
    const kids = children.get(a.id) ?? [];
    const row: ChartRow = {
      account: a,
      depth,
      heading: !!v && !v.isPostingAllowed && !v.isControlAccount && v.controlPostingPolicy !== 'SYSTEM_ONLY',
      systemKept: !!v && (v.isControlAccount || v.controlPostingPolicy === 'SYSTEM_ONLY'),
      balanceMinor: 0,
      hasChildren: kids.length > 0,
    };
    const visible = opts.showInactive || a.status === 'ACTIVE';
    if (visible) section.rows.push(row);
    let total = own(a, cls);
    for (const k of kids) total += walk(k, visible ? depth + 1 : depth, seen);
    row.balanceMinor = total;
    return total;
  };
  const seen = new Set<string>();
  for (const top of children.get(null) ?? []) {
    const cls = versions.get(top.id)?.accountClass ?? 'ASSET';
    sections.get(cls)!.totalMinor += walk(top, 0, seen);
  }
  return CLASS_ORDER.map((c) => sections.get(c)!).filter((s) => s.rows.length > 0);
}

/** Rows matching a search on code or name — with the headings above them, so they keep their place. */
export function searchSections(sections: readonly ChartSection[], query: string, name: (a: Account) => string): ChartSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections
    .map((s) => {
      const keep = new Set<number>();
      s.rows.forEach((r, i) => {
        if (!r.account.code.toLowerCase().includes(q) && !name(r.account).toLowerCase().includes(q)) return;
        keep.add(i);
        // Walk back to each heading above it.
        let depth = r.depth;
        for (let j = i - 1; j >= 0 && depth > 0; j--) {
          if (s.rows[j].depth < depth) {
            keep.add(j);
            depth = s.rows[j].depth;
          }
        }
      });
      return { ...s, rows: s.rows.filter((_, i) => keep.has(i)) };
    })
    .filter((s) => s.rows.length > 0);
}
