import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { getAccountingReadiness } from '../api/finance-api';
import { AccountingSetupNotice } from './accounting-setup-notice';

vi.mock('../api/finance-api', () => ({ getAccountingReadiness: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('AccountingSetupNotice (flow plan A7)', () => {
  it('says why posting is unavailable and links to the page that fixes the first blocker', async () => {
    vi.mocked(getAccountingReadiness).mockResolvedValue({
      ready: false,
      checkedAt: '2026-09-28T00:00:00Z',
      blockers: [
        { code: 'NO_OPEN_PERIOD', label: 'An open accounting period', detail: '' },
        { code: 'NO_POSTING_PROFILES', label: 'A posting profile', detail: '' },
      ],
    });
    renderWithProviders(<AccountingSetupNotice />, { permissions: ['view:accounting'] });

    expect(
      await screen.findByText("Invoices can't be posted until accounting setup is finished"),
    ).toBeInTheDocument();
    expect(screen.getByText(/An open accounting period, A posting profile/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open accounting setup' })).toHaveAttribute(
      'href',
      '/finance/accounting/periods',
    );
  });

  it('shows nothing when the ledger is ready', async () => {
    vi.mocked(getAccountingReadiness).mockResolvedValue({ ready: true, blockers: [], checkedAt: '' });
    const { container } = renderWithProviders(<AccountingSetupNotice />, {
      permissions: ['view:accounting'],
    });
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not ask a reader who cannot view accounting', () => {
    vi.mocked(getAccountingReadiness).mockClear();
    renderWithProviders(<AccountingSetupNotice />, { permissions: [] });
    expect(getAccountingReadiness).not.toHaveBeenCalled();
  });
});
