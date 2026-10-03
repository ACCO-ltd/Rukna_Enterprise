import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-043 Phase 3 — every retired project route is a server redirect to where the work now lives.
 * The real `redirect()` throws to halt rendering; the mock reproduces that.
 */
const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import FinancePage from './finance/page';
import CostControlPage from './finance/cost-control/page';
import ProfitLossPage from './finance/profit-loss/page';
import LedgerPage from './finance/ledger/page';
import LedgerBillPage from './finance/ledger/bills/[billId]/page';
import PlPage from './pl/page';
import IpcPage from './ipc/page';
import ContractsPage from './contracts/page';
import CommercialBillingPage from './commercial/billing/page';
import BillingCollectionPage from './commercial/billing-collection/page';
import { withQuery } from '@/features/finance-projects/redirects';

const id = Promise.resolve({ id: 'p-1' });

beforeEach(() => {
  mocks.redirect.mockClear();
});

describe('retired project routes → their new home', () => {
  const routes: Array<{ route: string; render: () => Promise<unknown>; target: string }> = [
    { route: '/projects/:id/finance', render: () => FinancePage({ params: id }), target: '/finance/projects/p-1' },
    { route: '/projects/:id/finance/cost-control', render: () => CostControlPage({ params: id }), target: '/finance/projects/p-1/cost' },
    { route: '/projects/:id/finance/profit-loss', render: () => ProfitLossPage({ params: id }), target: '/finance/projects/p-1/pl' },
    { route: '/projects/:id/finance/ledger', render: () => LedgerPage({ params: id }), target: '/finance/projects/p-1/pl#ledger' },
    { route: '/projects/:id/finance/ledger/bills/:billId', render: () => LedgerBillPage({ params: Promise.resolve({ id: 'p-1', billId: 'b-9' }) }), target: '/finance/accounting/bills/b-9' },
    { route: '/projects/:id/pl', render: () => PlPage({ params: id }), target: '/finance/projects/p-1/pl' },
    { route: '/projects/:id/ipc', render: () => IpcPage({ params: id }), target: '/projects/p-1/commercial' },
    { route: '/projects/:id/contracts', render: () => ContractsPage({ params: id }), target: '/projects/p-1/commercial/contract' },
    { route: '/projects/:id/commercial/billing', render: () => CommercialBillingPage({ params: id }), target: '/finance/projects/p-1/billing' },
    { route: '/projects/:id/commercial/billing-collection', render: () => BillingCollectionPage({ params: id }), target: '/finance/projects/p-1/billing' },
  ];

  it.each(routes)('$route → $target', async ({ render, target }) => {
    await expect(render()).rejects.toThrow(`NEXT_REDIRECT:${target}`);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith(target);
  });
});

describe('query strings survive the redirect', () => {
  it('carries ?filter / ?from onto the target, before any #fragment', async () => {
    await expect(
      CommercialBillingPage({ params: id, searchParams: Promise.resolve({ filter: 'needsAction' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/finance/projects/p-1/billing?filter=needsAction');
    await expect(
      LedgerPage({ params: id, searchParams: Promise.resolve({ from: '2026-01-01', tag: ['a', 'b'] }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/finance/projects/p-1/pl?from=2026-01-01&tag=a&tag=b#ledger');
  });

  it('withQuery leaves a target alone when there is no query', () => {
    expect(withQuery('/finance/projects/p-1/pl#ledger', {})).toBe('/finance/projects/p-1/pl#ledger');
    expect(withQuery('/x', undefined)).toBe('/x');
  });
});
