import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { buildRows, siblingBounds } from '../boq-rows';
import { testNode } from '../test-node';
import { BoqGrid, type BoqRowCommands, type PendingLine } from './boq-grid';

beforeAll(() => {
  // jsdom has no matchMedia; the grid asks it whether a row tap should open the details sheet.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

const tree = () => [
  testNode({
    id: 's1',
    code: '1',
    description: 'Substructure',
    children: [
      testNode({
        id: 'i1',
        parentId: 's1',
        code: '1.1',
        description: 'Excavate foundation trenches',
        isLeaf: true,
        unit: 'm³',
        quantity: '180.000',
        unitRate: '6.50',
        computedTotal: '1170.00',
        sortOrder: 0,
      }),
      testNode({
        id: 'i2',
        parentId: 's1',
        code: '1.2',
        description: 'Site security, 24 hours',
        isLeaf: true,
        unit: 'nr',
        quantity: '16.000',
        sortOrder: 1,
      }),
    ],
  }),
  testNode({
    id: 's2',
    code: '2',
    description: 'Preliminaries',
    sortOrder: 1,
    children: [
      testNode({
        id: 'i3',
        parentId: 's2',
        code: '2.1',
        description: 'Site mobilisation',
        isLeaf: true,
        pricingBasis: 'LUMP_SUM',
        quantity: '1.000',
        unitRate: '9800.00',
        computedTotal: '9800.00',
      }),
    ],
  }),
  testNode({
    id: 's3',
    code: '3',
    description: 'Structure',
    sortOrder: 2,
    children: [testNode({ id: 's31', parentId: 's3', code: '3.1', description: 'Frame', children: [] })],
  }),
];

function commands(overrides: Partial<BoqRowCommands> = {}): BoqRowCommands {
  const nodes = tree();
  return {
    onEdit: vi.fn(),
    onAddSection: vi.fn(),
    onAddFromLibrary: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    bounds: (node) => siblingBounds(nodes, node),
    onEditField: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof BoqGrid>[0]> = {}) {
  const props: Parameters<typeof BoqGrid>[0] = {
    rows: buildRows(tree(), { collapsed: new Set(), search: '', pricing: 'all' }),
    currency: 'USD',
    totalAmount: '10970.00',
    sectionTotals: new Map([
      ['s1', '1170.00'],
      ['s2', '9800.00'],
    ]),
    isFiltered: false,
    canViewCommercials: true,
    showSource: false,
    collapsed: new Set(),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    commands: null,
    emptyMessage: 'Nothing here',
    ...overrides,
  };
  return { props, ...renderWithProviders(<BoqGrid {...props} />) };
}

describe('BoqGrid — reading', () => {
  it('marks an unpriced line "No rate" and a lump sum as such', () => {
    render();
    const security = screen.getByText('Site security, 24 hours').closest('tr')!;
    expect(within(security).getByText('No rate')).toHaveClass('text-warning');
    const mobilisation = screen.getByText('Site mobilisation').closest('tr')!;
    expect(within(mobilisation).getAllByText('Lump sum').length).toBeGreaterThan(0);
  });

  it('ends with the BOQ total, and no "Showing x of y rows"', () => {
    render();
    expect(screen.getByText('BOQ total')).toBeInTheDocument();
    expect(screen.getByText('$10,970.00')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  /** Money-blind roles: the figures never reached the browser, so neither do their columns. */
  it('drops the rate, amount and total for a reader who may not see money', () => {
    render({ canViewCommercials: false, totalAmount: null });
    expect(screen.queryByRole('columnheader', { name: /Rate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Amount/ })).not.toBeInTheDocument();
    expect(screen.queryByText('BOQ total')).not.toBeInTheDocument();
    expect(screen.queryByText('No rate')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('collapses sections with a real button that states its state', async () => {
    const user = userEvent.setup();
    const { props } = render();
    const toggle = screen.getByRole('button', { name: 'Collapse section 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(props.onToggle).toHaveBeenCalledWith('s1');
  });
});

describe('BoqGrid — editing a draft', () => {
  it('boxes every editable cell and saves one on blur', async () => {
    const user = userEvent.setup();
    const cmds = commands();
    render({ commands: cmds });

    const rate = screen.getByRole('textbox', { name: 'Edit rate of 1.2' });
    await user.click(rate);
    await user.type(rate, '12.5');
    await user.tab();

    await waitFor(() =>
      expect(cmds.onEditField).toHaveBeenCalledWith(expect.objectContaining({ id: 'i2' }), 'unitRate', '12.5'),
    );
  });

  it('keeps a failed value in the cell and says so', async () => {
    const user = userEvent.setup();
    const cmds = commands({ onEditField: vi.fn().mockRejectedValue(new Error('boom')) });
    render({ commands: cmds });

    const quantity = screen.getByRole('textbox', { name: 'Edit quantity of 1.1' });
    await user.clear(quantity);
    await user.type(quantity, '200{Enter}');

    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(quantity).toHaveValue('200');
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a rate with more decimals than the server accepts, before sending it', async () => {
    const user = userEvent.setup();
    const cmds = commands();
    render({ commands: cmds });
    const rate = screen.getByRole('textbox', { name: 'Edit rate of 1.1' });
    await user.clear(rate);
    await user.type(rate, '6.505{Enter}');
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(cmds.onEditField).not.toHaveBeenCalled();
  });

  it('ends each open section that takes items with "+ Add item", and focuses the new line', async () => {
    const user = userEvent.setup();
    const cmds = commands();
    let pending: PendingLine | null = null;
    const onPendingChange = vi.fn((next: PendingLine | null) => {
      pending = next;
    });
    const view = render({ commands: cmds, onPendingChange });

    // Section 3 holds a sub-section, so it is not offered an item (the server forbids mixing).
    expect(screen.getByRole('button', { name: 'Add item to 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add item to 3.1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item to 3' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add item to 1' }));
    expect(onPendingChange).toHaveBeenCalledWith({ parentId: 's1', kind: 'item' });

    view.rerender(<BoqGrid {...view.props} commands={cmds} onPendingChange={onPendingChange} pending={pending} />);
    const line = screen.getByRole('textbox', { name: 'New item in 1' });
    expect(line).toHaveFocus();
    await user.type(line, 'Blinding concrete{Enter}');
    await waitFor(() =>
      expect(cmds.onCreate).toHaveBeenCalledWith({
        parent: expect.objectContaining({ id: 's1' }),
        kind: 'item',
        description: 'Blinding concrete',
      }),
    );
  });

  it('abandons an empty new line on Escape without creating anything', async () => {
    const user = userEvent.setup();
    const cmds = commands();
    const onPendingChange = vi.fn();
    render({ commands: cmds, pending: { parentId: 's1', kind: 'item' }, onPendingChange });
    await user.keyboard('{Escape}');
    expect(onPendingChange).toHaveBeenCalledWith(null);
    expect(cmds.onCreate).not.toHaveBeenCalled();
  });

  it('offers only the moves and deletes a node can take, from a keyboard-reachable menu', async () => {
    const user = userEvent.setup();
    render({ commands: commands() });

    const trigger = screen.getByRole('button', { name: 'Actions for 1' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Add item' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toBeInTheDocument();
    // It has lines under it; the server would refuse the delete.
    expect(within(menu).queryByRole('menuitem', { name: 'Delete section' })).not.toBeInTheDocument();
  });

  it('reaches cells, toggles and menus with Tab alone', async () => {
    const user = userEvent.setup();
    render({ commands: commands() });
    // First stop: the scroll region itself, so a keyboard can scroll a wide table sideways.
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Collapse section 1' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Name of section 1' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Actions for 1' })).toHaveFocus();
    // An item row has no toggle, so its description is the next stop.
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Edit description of 1.1' })).toHaveFocus();
  });
});
