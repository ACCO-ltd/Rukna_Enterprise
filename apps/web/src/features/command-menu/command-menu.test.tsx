import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { CommandMenu } from './command-menu';
import { closeCommandMenu, openCommandMenu } from './command-menu-store';
import { buildCommandEntries, filterCommandEntries, type Gate } from './command-items';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

// Every sidebar domain visible, plus the finer create permissions the actions gate on.
const FULL_ACCESS = [
  'view:project',
  'create:project',
  'view:client',
  'view:accounting',
  'view:procurement',
  'create:material-request',
  'create:purchase-order',
  'create:goods-receipt',
  'manage:payable',
  'manage:user',
];

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  act(() => closeCommandMenu());
});

function renderMenu(permissions: string[] = FULL_ACCESS) {
  const result = renderWithProviders(<CommandMenu />, { permissions });
  // The store mutation must be flushed inside act() so the Dialog re-renders open.
  act(() => openCommandMenu());
  return result;
}

// ─── Pure gating/filtering logic (no DOM) ─────────────────────────────────────

describe('buildCommandEntries', () => {
  const t = (key: string) => key; // identity translator — assert on keys, not copy

  it('includes a domain destination only when its module is visible', () => {
    const gate: Gate = {
      can: () => true,
      moduleVisible: (m) => m === 'accounting',
    };
    const entries = buildCommandEntries(gate, t);
    const hrefs = entries.map((e) => e.href);

    expect(hrefs).toContain('/finance/accounting/journals');
    // Procurement module hidden → none of its destinations or actions appear.
    expect(hrefs).not.toContain('/procurement/orders');
    expect(hrefs).not.toContain('/procurement/orders/new');
  });

  it('hides a nav item whose permissionKey the user lacks', () => {
    const gate: Gate = {
      can: (p) => p !== 'manage:procurement-config',
      moduleVisible: () => true,
    };
    const entries = buildCommandEntries(gate, t);
    const hrefs = entries.map((e) => e.href);

    // Setup items are gated on manage:procurement-config.
    expect(hrefs).not.toContain('/procurement/setup/materials');
    // An ungated workflow item in the same domain still shows.
    expect(hrefs).toContain('/procurement/orders');
  });

  it('hides an action whose finer permission the user lacks even when the module is visible', () => {
    const gate: Gate = {
      can: (p) => p !== 'create:purchase-order',
      moduleVisible: () => true,
    };
    const actions = buildCommandEntries(gate, t).filter((e) => e.group === 'action');
    const hrefs = actions.map((e) => e.href);

    expect(hrefs).not.toContain('/procurement/orders/new');
    // An action gated only on module visibility still shows.
    expect(hrefs).toContain('/finance/accounting/journals/new');
  });
});

describe('filterCommandEntries', () => {
  const t = (key: string) => key;
  const gate: Gate = { can: () => true, moduleVisible: () => true };

  it('matches case-insensitively over label and context', () => {
    const entries = buildCommandEntries(gate, t);
    // Labels are the raw nav keys under identity translation, e.g. "nav.journals".
    const matches = filterCommandEntries(entries, 'JOURNAL');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((e) => `${e.label} ${e.context ?? ''}`.toLowerCase().includes('journal'))).toBe(
      true,
    );
  });

  it('returns everything for an empty query', () => {
    const entries = buildCommandEntries(gate, t);
    expect(filterCommandEntries(entries, '   ')).toHaveLength(entries.length);
  });
});

// ─── Component behaviour ──────────────────────────────────────────────────────

describe('CommandMenu', () => {
  it('opens via the store and shows grouped destinations and actions', () => {
    renderMenu();

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    // A destination and a create-action are both present.
    expect(screen.getByRole('option', { name: /Journals/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Create project' })).toBeInTheDocument();
  });

  it('filters results as the user types', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.type(screen.getByRole('combobox'), 'purchase');

    expect(screen.getByRole('option', { name: 'New purchase order' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Journals/ })).not.toBeInTheDocument();
  });

  it('navigates and closes on Enter', async () => {
    const user = userEvent.setup();
    renderMenu();

    const input = screen.getByRole('combobox');
    await user.type(input, 'clients');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/clients');
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('moves the highlight with the arrow keys and activates the highlighted row', async () => {
    const user = userEvent.setup();
    renderMenu();

    const input = screen.getByRole('combobox');
    await user.type(input, 'new');
    // Down once, then Enter opens the second matching row.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatch(/\/new$|\/new\?/);
  });

  it('shows a real empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.type(screen.getByRole('combobox'), 'zzzznomatch');

    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('gates entries by permission: hides a domain the user cannot see', () => {
    // Only portfolio visible — no accounting or procurement.
    renderMenu(['view:project', 'view:client', 'create:project']);

    expect(screen.getByRole('option', { name: 'Create project' })).toBeInTheDocument();
    // Accounting destination and its actions are absent.
    expect(screen.queryByRole('option', { name: /Journals/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'New payment' })).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderMenu();

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });
});
