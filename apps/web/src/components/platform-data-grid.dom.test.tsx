import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ListFilterField } from '@erp/ui';

import { renderWithProviders } from '@/test/render';

import { PlatformDataGrid, type GridColumn } from './platform-data-grid';

interface Row {
  id: string;
  number: string;
  supplier: string;
  amount: string;
}

const ROWS: Row[] = [
  { id: '1', number: 'BILL-2026-0042', supplier: 'Berbera Cement Co.', amount: '5660.00' },
  { id: '2', number: 'BILL-2026-0041', supplier: 'Mogadishu Steel Traders', amount: '18420.00' },
];

const FILTERS: ListFilterField[] = [
  {
    key: 'status',
    type: 'select',
    label: 'Approval status',
    options: [
      { value: 'APPROVED', label: 'Approved' },
      { value: 'DRAFT', label: 'Draft' },
    ],
  },
];

function columns(opts: { redactAmount?: boolean } = {}): GridColumn<Row>[] {
  return [
    { key: 'number', header: 'Bill', sticky: true, sortable: true, card: 'title', plainValue: (r) => r.number, render: (r) => r.number },
    { key: 'supplier', header: 'Supplier', sortable: true, card: 'subtitle', plainValue: (r) => r.supplier, render: (r) => r.supplier },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      sortable: true,
      card: 'amount',
      redacted: opts.redactAmount,
      plainValue: (r) => Number(r.amount),
      render: (r) => r.amount,
    },
  ];
}

describe('PlatformDataGrid — list page (ADR-035)', () => {
  it('shows applied filters as chips; removing one clears only that filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns()}
        data={ROWS}
        rowKey={(r) => r.id}
        label="Supplier bills"
        filters={FILTERS}
        filterValues={{ status: 'APPROVED' }}
        onFilterValuesChange={onChange}
      />,
    );

    expect(screen.getByText('Approved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remove filter: Approval status/ }));
    expect(onChange).toHaveBeenCalledWith({ status: '' });

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('commits nothing until the panel is applied, and Clear commits an empty set', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns()}
        data={ROWS}
        rowKey={(r) => r.id}
        label="Supplier bills"
        filters={FILTERS}
        filterValues={{ status: 'APPROVED' }}
        onFilterValuesChange={onChange}
      />,
    );

    // The trigger carries the applied count.
    await user.click(screen.getByRole('button', { name: /Filter\s*1/ }));
    expect(await screen.findByText('Filters')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ status: 'APPROVED' });

    await user.click(screen.getByRole('button', { name: /Filter\s*1/ }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('renders a redacted money column hidden, and never offers to sort it', () => {
    renderWithProviders(
      <PlatformDataGrid columns={columns({ redactAmount: true })} data={ROWS} rowKey={(r) => r.id} label="Supplier bills" />,
    );

    expect(screen.queryByText('5660.00')).toBeNull();
    expect(screen.getAllByText('Hidden by permission').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Amount/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Bill/ })).toBeInTheDocument();
  });

  it('builds phone row cards from the columns’ card roles, the title linking to the record', () => {
    renderWithProviders(
      <PlatformDataGrid
        columns={columns()}
        data={ROWS}
        rowKey={(r) => r.id}
        label="Supplier bills"
        rowHref={(r) => `/finance/accounting/bills/${r.id}`}
      />,
    );

    const cards = screen.getAllByRole('list', { name: 'Supplier bills' })[0]!;
    const first = within(cards).getAllByRole('listitem')[0]!;
    expect(within(first).getByRole('link', { name: 'BILL-2026-0042' })).toHaveAttribute(
      'href',
      '/finance/accounting/bills/1',
    );
    expect(within(first).getByText('Berbera Cement Co.')).toBeInTheDocument();
    expect(within(first).getByText('5660.00')).toBeInTheDocument();
  });

  it('offers exactly one way out of a filtered-empty list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns()}
        data={ROWS}
        rowKey={(r) => r.id}
        label="Supplier bills"
        filters={FILTERS}
        filterValues={{}}
        onFilterValuesChange={onChange}
      />,
    );

    await user.type(screen.getByRole('searchbox'), 'no such bill');
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    // One in the table's empty state and one in the phone card list — the same control twice
    // in two layouts that are never visible together, never two controls in one view.
    expect(clear.length).toBeLessThanOrEqual(2);
    await user.click(clear[0]!);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});
