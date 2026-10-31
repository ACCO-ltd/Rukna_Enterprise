import { describe, expect, it } from 'vitest';

import { chartSections, searchSections } from './coa-tree';
import type { Account } from './types';

const acct = (id: string, code: string, name: string, over: Record<string, unknown> = {}, status: Account['status'] = 'ACTIVE'): Account => ({
  id, code, organizationId: 'o', normalBalance: 'DEBIT', status, createdAt: '', createdBy: '',
  versions: [{
    id: `v-${id}`, accountId: id, versionNumber: 1, name, parentAccountId: null, accountClass: 'ASSET', accountSubtype: 'OTHER_CURRENT_ASSET',
    isPostingAllowed: true, isControlAccount: false, controlledSubledgerType: null, controlPostingPolicy: 'UNRESTRICTED',
    effectiveFrom: '2026-01-01', effectiveTo: null, ...over,
  }],
} as Account);

const CHART = [
  acct('h', '15000', 'Non-current assets', { isPostingAllowed: false }),
  acct('v', '15300', 'Vehicles', { parentAccountId: 'h' }),
  acct('d', '15900', 'Accumulated depreciation', { parentAccountId: 'h', accountSubtype: 'ACCUMULATED_DEPRECIATION' }),
  acct('x', '15400', 'Old furniture', { parentAccountId: 'h' }, 'INACTIVE'),
];
const balances = new Map([
  ['v', { debit: '40000.00', credit: '0.00' }],
  ['d', { debit: '0.00', credit: '8000.00' }],
]);

describe('chart tree (GL-C)', () => {
  it('nests by heading, nets a contra account, and leaves inactive accounts out unless asked', () => {
    const [assets] = chartSections(CHART, balances);
    expect(assets.rows.map((r) => [r.account.code, r.depth])).toEqual([['15000', 0], ['15300', 1], ['15900', 1]]);
    expect(assets.rows[0]).toMatchObject({ heading: true, balanceMinor: 3_200_000 });
    expect(assets.rows[2].balanceMinor).toBe(-800_000);
    expect(assets.totalMinor).toBe(3_200_000);
    expect(chartSections(CHART, balances, { showInactive: true })[0].rows).toHaveLength(4);
  });

  it('keeps the heading above a match', () => {
    const found = searchSections(chartSections(CHART, balances), 'vehic', (a) => a.versions[0].name);
    expect(found[0].rows.map((r) => r.account.code)).toEqual(['15000', '15300']);
  });
});
