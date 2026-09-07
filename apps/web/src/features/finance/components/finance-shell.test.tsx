import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const navMocks = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => navMocks);

import { FinanceShell } from './finance-shell';

/**
 * Four views, named for the question each answers. The Finance tab used to be a single Project
 * Actual P&L — a subset presented as the whole project's finances.
 */
beforeEach(() => vi.clearAllMocks());

describe('FinanceShell', () => {
  it('offers the four Finance views', () => {
    navMocks.usePathname.mockReturnValue('/projects/p1/finance');
    renderWithProviders(
      <FinanceShell projectId="p1">
        <div />
      </FinanceShell>,
    );

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute(
      'href',
      '/projects/p1/finance',
    );
    expect(screen.getByRole('link', { name: /cost control/i })).toHaveAttribute(
      'href',
      '/projects/p1/finance/cost-control',
    );
    expect(screen.getByRole('link', { name: /profit & loss/i })).toHaveAttribute(
      'href',
      '/projects/p1/finance/profit-loss',
    );
    expect(screen.getByRole('link', { name: /ledger/i })).toHaveAttribute(
      'href',
      '/projects/p1/finance/ledger',
    );
  });

  it('marks the active view, and only that one', () => {
    navMocks.usePathname.mockReturnValue('/projects/p1/finance/cost-control');
    renderWithProviders(
      <FinanceShell projectId="p1">
        <div />
      </FinanceShell>,
    );

    expect(screen.getByRole('link', { name: /cost control/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Overview's href is a prefix of every other route, so it must not match on prefix alone.
    expect(screen.getByRole('link', { name: /overview/i })).not.toHaveAttribute('aria-current');
  });
});
