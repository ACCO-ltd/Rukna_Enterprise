import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { buildRows } from '../boq-rows';
import { testNode } from '../test-node';
import { BoqGrid } from './boq-grid';

const tree = () => [
  testNode({
    id: 's1',
    code: '01',
    description: 'Preliminaries',
    children: [
      testNode({
        id: 'i1',
        code: '01.001',
        description: 'Site office',
        isLeaf: true,
        unit: 'LS',
        quantity: '1.000',
        unitRate: '45000.00',
        computedTotal: '45000.00',
      }),
      testNode({
        id: 'i2',
        code: '01.002',
        description: 'Fencing',
        isLeaf: true,
        unit: 'm',
        quantity: '620.000',
      }),
    ],
  }),
];

function render(overrides: Partial<Parameters<typeof BoqGrid>[0]> = {}) {
  const onSelect = vi.fn();
  const onToggle = vi.fn();

  renderWithProviders(
    <BoqGrid
      rows={buildRows(tree(), { collapsed: new Set(), search: '', pricing: 'all' })}
      totalRows={3}
      currency="USD"
      totalAmount="45000.00"
      visibleAmount="45000.00"
      sectionTotals={new Map([['s1', '45000.00']])}
      isFiltered={false}
      canManage
      canViewCommercials
      highlighted={new Set()}
      collapsed={new Set()}
      onToggle={onToggle}
      onSelect={onSelect}
      commands={null}
      emptyMessage="Nothing here"
      {...overrides}
    />,
  );

  const rows = screen.getAllByRole('row').slice(1); // drop the header row
  return { rows, onSelect, onToggle };
}

/**
 * The grid shipped as `<tr onClick>` with `cursor-pointer` and no `tabIndex`, `role` or key
 * handler, so opening a BOQ item could not be done from a keyboard at all — WCAG 2.1.1,
 * Level A, on the primary interaction of the densest screen in the product.
 */
describe('BoqGrid — keyboard access', () => {
  it('exposes exactly one tab stop, so 67 rows do not become 67 tab stops', () => {
    const { rows } = render();

    expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('moves focus down and up with the arrow keys', () => {
    const { rows } = render();

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(rows[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('jumps to the ends with Home and End', () => {
    const { rows } = render();

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(rows[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('opens the focused row with Enter', () => {
    const { rows, onSelect } = render();

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: '01.001' }));
  });

  it('folds a section with the shallower arrow', () => {
    const { rows, onToggle } = render();

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowLeft' });

    expect(onToggle).toHaveBeenCalledWith('s1');
  });

  /** Otherwise typing a code into a row's own control would steer the grid instead. */
  it('ignores keys it does not own', () => {
    const { rows, onSelect } = render();

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'a' });

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(rows[0]);
  });

  it('announces itself as a grid so arrow navigation is expected', () => {
    render();

    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});

describe('BoqGrid — reading the rows', () => {
  /**
   * A section has no unit by definition. Printing a dash says "missing", which is the signal
   * the amber row edge already carries for data that genuinely is absent.
   */
  it('leaves a section blank under Unit rather than printing a dash', () => {
    const { rows } = render();

    const sectionCells = rows[0]!.querySelectorAll('td');
    const itemCells = rows[1]!.querySelectorAll('td');

    expect(sectionCells[3]?.textContent).toBe('');
    expect(itemCells[3]?.textContent).toBe('LS');
  });

  /**
   * The footer used to pair a filtered row count with a total covering every row, so the
   * count and the figure described different sets. Filtered, it must show both and label
   * which is which.
   */
  it('distinguishes the BOQ total from the visible total while filtered', () => {
    render({ isFiltered: true, visibleAmount: '11470.00', totalAmount: '56470.00' });

    expect(screen.getByText(/11,470\.00/)).toBeInTheDocument();
    expect(screen.getByText(/56,470\.00/)).toBeInTheDocument();
  });

  it('shows only the BOQ total when nothing is filtered', () => {
    render({ isFiltered: false, totalAmount: '56470.00', visibleAmount: '11470.00' });

    expect(screen.getByText(/56,470\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/11,470\.00/)).not.toBeInTheDocument();
  });
});
