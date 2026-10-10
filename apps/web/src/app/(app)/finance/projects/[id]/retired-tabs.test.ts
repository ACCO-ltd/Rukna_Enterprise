import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import PayablesPage from './payables/page';
import PaymentsPage from './payments/page';
import PlPage from './pl/page';

const id = Promise.resolve({ id: 'p-1' });

/** ADR-043 amendment (2026-10-10): the retired Finance project tabs land on their Transactions view. */
describe('retired Finance project tabs → Transactions', () => {
  it.each([
    ['payables', () => PayablesPage({ params: id }), '/finance/projects/p-1/transactions?view=bills'],
    ['payments', () => PaymentsPage({ params: id }), '/finance/projects/p-1/transactions?view=receipts'],
    ['pl', () => PlPage({ params: id }), '/finance/projects/p-1/transactions?view=pl'],
  ])('/finance/projects/:id/%s', async (_route, render, target) => {
    await expect(render()).rejects.toThrow(`NEXT_REDIRECT:${target}`);
  });

  it('keeps the old query string', async () => {
    await expect(PlPage({ params: id, searchParams: Promise.resolve({ from: '2026-01-01' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/finance/projects/p-1/transactions?view=pl&from=2026-01-01',
    );
  });
});
