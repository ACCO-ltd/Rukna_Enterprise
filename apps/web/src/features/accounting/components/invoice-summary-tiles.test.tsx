import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { InvoiceSummary } from '../invoice-summary';
import { InvoiceSummaryTiles } from './invoice-summary-tiles';

const summary: InvoiceSummary = {
  currency: 'USD',
  mixedCurrencies: false,
  draft: { count: 2, totalMinor: 18420000 },
  overdue: { count: 9, outstandingMinor: 41265000, oldestDaysLate: 47 },
  notDue: { count: 21, outstandingMinor: 96830000 },
  collected: { paidCount: 18, collectedMinor: 110540000 },
  retentionHeld: { contracts: 4, heldMinor: 13694000 },
};

describe('InvoiceSummaryTiles (Step 2c)', () => {
  it('shows each figure with its context, and opens the list behind a tile', async () => {
    const onShowOverdue = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <InvoiceSummaryTiles summary={summary} onShowDrafts={vi.fn()} onShowOverdue={onShowOverdue} onShowNotDue={vi.fn()} />,
    );
    expect(screen.getByText('9 invoices · oldest 47 days late')).toBeInTheDocument();
    expect(screen.getByText('18 invoices paid in full')).toBeInTheDocument();
    expect(screen.getByText('4 contracts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show Overdue invoices/ }));
    expect(onShowOverdue).toHaveBeenCalled();
    // Collected and retention have no list behind them — figures, not buttons.
    expect(screen.queryByRole('button', { name: /Collected/ })).not.toBeInTheDocument();
  });

  it('shows no totals across currencies', () => {
    renderWithProviders(
      <InvoiceSummaryTiles
        summary={{ ...summary, mixedCurrencies: true, currency: null }}
        onShowDrafts={vi.fn()}
        onShowOverdue={vi.fn()}
        onShowNotDue={vi.fn()}
      />,
    );
    expect(screen.getByText(/more than one currency/)).toBeInTheDocument();
  });
});
