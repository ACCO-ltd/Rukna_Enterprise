import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { testNode as node } from '../test-node';
import { BoqTree } from './boq-tree';

const substructure = node({
  id: 'root',
  code: '01',
  description: 'Substructure Works',
  computedTotal: 54000,
  children: [
    node({
      id: 'leaf',
      parentId: 'root',
      depth: 1,
      code: '01.01',
      description: 'Excavation',
      isLeaf: true,
      unit: 'm³',
      quantity: '1200.000',
      unitRate: '45.00',
      currency: 'USD',
      totalAmount: '54000.00',
      computedTotal: 54000,
    }),
  ],
});

describe('BoqTree — structure', () => {
  it('renders sections and their items', () => {
    renderWithProviders(<BoqTree nodes={[substructure]} />);

    expect(screen.getByText('Substructure Works')).toBeInTheDocument();
    expect(screen.getByText('Excavation')).toBeInTheDocument();
  });

  it('collapses and expands a section', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BoqTree nodes={[substructure]} />);

    // Sections start open — a BOQ is read top to bottom.
    expect(screen.getByText('Excavation')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse 01' }));
    expect(screen.queryByText('Excavation')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand 01' }));
    expect(screen.getByText('Excavation')).toBeInTheDocument();
  });

  it('orders siblings by sortOrder rather than array order', () => {
    const roots = [
      node({ id: 'b', code: '02', description: 'Second', sortOrder: 2 }),
      node({ id: 'a', code: '01', description: 'First', sortOrder: 1 }),
    ];

    renderWithProviders(<BoqTree nodes={roots} />);

    const rendered = screen.getAllByText(/First|Second/).map((el) => el.textContent);
    expect(rendered).toEqual(['First', 'Second']);
  });
});

describe('BoqTree — amounts', () => {
  it('formats a leaf amount with its currency', () => {
    renderWithProviders(<BoqTree nodes={[substructure]} />);

    // Section total and leaf total are both 54,000 USD.
    expect(screen.getAllByText('$54,000.00').length).toBeGreaterThan(0);
  });

  /**
   * D1. The server sums computedTotal across children without checking currency, so this
   * parent carries a number that is USD 100 + AED 200. Printing it under one symbol would
   * be confidently wrong in a document used for contract valuation.
   */
  it('withholds a section total when the section mixes currencies', () => {
    const mixed = node({
      id: 'root',
      code: '01',
      description: 'Mixed section',
      computedTotal: 300,
      children: [
        node({
          id: 'usd',
          parentId: 'root',
          depth: 1,
          code: '01.01',
          description: 'Priced in dollars',
          isLeaf: true,
          currency: 'USD',
          totalAmount: '100.00',
          computedTotal: 100,
        }),
        node({
          id: 'aed',
          parentId: 'root',
          depth: 1,
          sortOrder: 2,
          code: '01.02',
          description: 'Priced in dirhams',
          isLeaf: true,
          currency: 'AED',
          totalAmount: '200.00',
          computedTotal: 200,
        }),
      ],
    });

    renderWithProviders(<BoqTree nodes={[mixed]} />);

    expect(screen.queryByText('$300.00')).not.toBeInTheDocument();
    expect(screen.getAllByText('Mixed currencies').length).toBeGreaterThan(0);
    // And the reason is explained, not just flagged.
    expect(
      screen.getByText(/Totals for those sections are hidden/),
    ).toBeInTheDocument();
  });

  it('sums the grand total across sections that agree on currency', () => {
    const roots = [
      node({ id: 'a', code: '01', currency: 'USD', totalAmount: '100.00', isLeaf: true, computedTotal: 100 }),
      node({ id: 'b', code: '02', sortOrder: 2, currency: 'USD', totalAmount: '200.00', isLeaf: true, computedTotal: 200 }),
    ];

    renderWithProviders(<BoqTree nodes={roots} />);

    expect(screen.getByText('$300.00')).toBeInTheDocument();
  });

  it('withholds the grand total when sections disagree on currency', () => {
    const roots = [
      node({ id: 'a', code: '01', currency: 'USD', totalAmount: '100.00', isLeaf: true, computedTotal: 100 }),
      node({ id: 'b', code: '02', sortOrder: 2, currency: 'AED', totalAmount: '200.00', isLeaf: true, computedTotal: 200 }),
    ];

    renderWithProviders(<BoqTree nodes={roots} />);

    expect(screen.queryByText('$300.00')).not.toBeInTheDocument();
    expect(screen.getAllByText('Mixed currencies').length).toBeGreaterThan(0);
  });

  it('shows a dash rather than zero for an unpriced item', () => {
    renderWithProviders(<BoqTree nodes={[node({ id: 'a', code: '01', isLeaf: true })]} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
