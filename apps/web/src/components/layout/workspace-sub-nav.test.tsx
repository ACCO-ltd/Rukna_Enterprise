import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { currentView, WorkspaceSubNav } from './workspace-sub-nav';

let pathname = '/projects/p1/finance/ledger/je-1';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const ITEMS = [
  { value: 'overview', label: 'Overview', href: '/projects/p1/finance' },
  { value: 'ledger', label: 'Ledger', href: '/projects/p1/finance/ledger' },
];

describe('currentView', () => {
  it('picks the longest matching href, so a nested route keeps its view', () => {
    expect(currentView(ITEMS, '/projects/p1/finance/ledger/je-1')).toBe('ledger');
    expect(currentView(ITEMS, '/projects/p1/finance')).toBe('overview');
    expect(currentView(ITEMS, '/projects/p1/finance/')).toBe('overview');
  });

  it('matches nothing outside the workspace', () => {
    expect(currentView(ITEMS, '/projects/p1/boq')).toBeNull();
  });
});

describe('WorkspaceSubNav', () => {
  it('renders text-only links to each view and marks only the current one', () => {
    pathname = '/projects/p1/finance/ledger/je-1';
    renderWithProviders(<WorkspaceSubNav label="Finance views" items={ITEMS} />);

    const nav = screen.getByRole('navigation', { name: 'Finance views' });
    expect(nav.querySelectorAll('svg')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Ledger' })).toHaveAttribute('href', '/projects/p1/finance/ledger');
    expect(screen.getByRole('link', { name: 'Ledger' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/projects/p1/finance');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('lets an explicit value override the pathname match', () => {
    pathname = '/projects/p1/finance/ledger';
    renderWithProviders(<WorkspaceSubNav label="Finance views" items={ITEMS} value="overview" />);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Ledger' })).not.toHaveAttribute('aria-current');
  });

  it('names a counted view by its count label, and shows no count at zero', () => {
    pathname = '/p/today';
    renderWithProviders(
      <WorkspaceSubNav
        label="Progress views"
        items={[
          { value: 'today', label: 'Today', href: '/p/today', count: 0, countLabel: 'Today, 0 waiting' },
          { value: 'review', label: 'Review', href: '/p/review', count: 3, countLabel: 'Review, 3 waiting' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Review, 3 waiting' })).toHaveAttribute('href', '/p/review');
    // Zero is never shown, so the plain label names the link.
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
