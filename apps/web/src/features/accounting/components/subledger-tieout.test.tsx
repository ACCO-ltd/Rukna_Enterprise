import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getReconciliation } from '@/features/accounting/api/accounting-api';

import { SubledgerTieOut } from './subledger-tieout';

/** GL-L — the AR/AP tie-out, read on arrival. */
vi.mock('@/features/accounting/api/accounting-api', () => ({ getReconciliation: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const check = (over: Record<string, unknown>) => ({
  accountId: 'ar', accountCode: '11000', accountName: 'Accounts receivable (control)', subledgerType: 'AR',
  glBalance: '455247.00', subledgerBalance: '455247.00', variance: '0.00', reconciled: true, documentCount: 14, ...over,
});

beforeEach(() => {
  vi.mocked(getReconciliation).mockResolvedValue({
    organizationId: 'o', generatedAt: '2026-10-31T08:00:00.000Z', allReconciled: false, blocksClose: true,
    checks: [check({}), check({ accountId: 'ap', accountCode: '20000', accountName: 'Accounts payable (control)', subledgerType: 'AP', glBalance: '1130.00', subledgerBalance: '1180.00', variance: '-50.00', reconciled: false, documentCount: 3 })],
  } as never);
});

describe('SubledgerTieOut (GL-L)', () => {
  it('shows each control account against its open documents, and says when they disagree', async () => {
    renderWithProviders(<SubledgerTieOut />);
    const ar = await screen.findByRole('region', { name: 'Receivables' });
    expect(within(ar).getByText('Agrees')).toBeInTheDocument();
    expect(within(ar).getByText('14 open invoices')).toBeInTheDocument();
    expect(within(ar).getByRole('link', { name: 'Open ledger' })).toHaveAttribute('href', '/finance/accounting/ledger?accountId=ar');

    const ap = screen.getByRole('region', { name: 'Payables' });
    expect(within(ap).getByText('Off by $50.00')).toBeInTheDocument();
    expect(within(ap).getByText('3 open bills')).toBeInTheDocument();
    expect(within(ap).getByRole('link', { name: 'Payables aging' })).toHaveAttribute('href', '/finance/accounting/aging/payables');
    expect(screen.getByText('The books and the documents disagree')).toBeInTheDocument();
  });
});
