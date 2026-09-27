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
  it('renders text-only links and marks the current view', () => {
    pathname = '/projects/p1/finance/ledger/je-1';
    renderWithProviders(<WorkspaceSubNav label="Finance views" items={ITEMS} />);

    const nav = screen.getByRole('navigation', { name: 'Finance views' });
    expect(nav.querySelectorAll('svg')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Ledger' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});
