import { describe, expect, it } from 'vitest';
import type { AccountingGuideResponse, GuideStep } from '@erp/types';

import { awaitingCount, noPeriodAction } from './use-accounting-guide';

function step(key: string, overrides: Partial<GuideStep> = {}): GuideStep {
  return { key, label: key, detail: '', status: 'TODO', href: null, ...overrides };
}

function guide(setupSteps: GuideStep[], dailySteps: GuideStep[] = []): AccountingGuideResponse {
  return {
    ready: false,
    cycles: [
      { key: 'setup', title: 'Setup', summary: '', status: 'IN_PROGRESS', steps: setupSteps },
      { key: 'daily', title: 'Daily', summary: '', status: 'IN_PROGRESS', steps: dailySteps },
    ],
    currentPeriod: null,
    fiscalYear: null,
    checkedAt: '2026-09-30T00:00:00.000Z',
  };
}

const SETUP_HREF = '/finance/accounting/chart-of-accounts?setup=template';
const PERIODS_HREF = '/finance/accounting/periods';

describe('noPeriodAction', () => {
  it('offers the one-step setup while the chart is empty — no period can exist before it', () => {
    const g = guide([
      step('chart-of-accounts', { status: 'NEXT', href: SETUP_HREF }),
      step('fiscal-year', { href: PERIODS_HREF }),
    ]);
    expect(noPeriodAction(g)).toEqual({ kind: 'setUp', href: SETUP_HREF });
  });

  it('offers the periods screen once the chart exists', () => {
    const g = guide([
      step('chart-of-accounts', { status: 'DONE', href: '/finance/accounting/chart-of-accounts' }),
      step('fiscal-year', { status: 'NEXT', href: PERIODS_HREF }),
    ]);
    expect(noPeriodAction(g)).toEqual({ kind: 'openPeriod', href: PERIODS_HREF });
  });

  it('offers nothing to someone who cannot act — the guide sends RESTRICTED steps without a link', () => {
    const g = guide([
      step('chart-of-accounts', { status: 'RESTRICTED', href: null }),
      step('fiscal-year', { status: 'RESTRICTED', href: null }),
    ]);
    expect(noPeriodAction(g)).toBeNull();
  });

  it('offers nothing while the guide is unknown', () => {
    expect(noPeriodAction(undefined)).toBeNull();
  });
});

describe('awaitingCount', () => {
  it('sums only the daily steps that need attention', () => {
    const g = guide(
      [],
      [
        step('bills', { status: 'ATTENTION', count: 3 }),
        step('receipts', { status: 'ATTENTION', count: 2 }),
        step('journals', { status: 'DONE', count: 9 }),
      ],
    );
    expect(awaitingCount(g)).toBe(5);
  });
});
