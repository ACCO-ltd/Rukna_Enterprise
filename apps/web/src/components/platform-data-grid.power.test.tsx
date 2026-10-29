import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { PlatformDataGrid, type GridColumn } from './platform-data-grid';

const exportCsv = vi.fn();
const downloadXlsx = vi.fn();
vi.mock('@/features/accounting/lib/export-csv', () => ({ exportCsv: (...a: unknown[]) => exportCsv(...a) }));
vi.mock('@/lib/xlsx-export', () => ({ downloadXlsx: (...a: unknown[]) => downloadXlsx(...a) }));

type Row = { id: string; name: string; amount: number; secret: number };
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i}`,
  name: i % 2 === 0 ? `Even ${i}` : `Odd ${i}`,
  amount: i * 10,
  secret: 1,
}));
const columns: GridColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, plainValue: (r) => r.name, exportValue: (r) => `#${r.name}`, render: (r) => r.name },
  { key: 'amount', header: 'Amount', numeric: true, plainValue: (r) => r.amount, render: (r) => r.amount },
  { key: 'secret', header: 'Secret', redacted: true, plainValue: (r) => r.secret, render: () => '•' },
  { key: 'badge', header: 'Badge', render: () => 'x' },
];

describe('PlatformDataGrid export (Step 2b, ADR-047)', () => {
  it('exports every row the search keeps — not just the page — using exportValue, then plainValue', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        label="Rows"
        pagination={{ defaultPageSize: 10 }}
        exportAs={{ fileName: 'rows-2026-10-28', sheetName: 'Rows' }}
      />,
    );
    await user.type(screen.getByRole('searchbox'), 'Even');
    await user.click(screen.getByRole('button', { name: /Export/ }));
    await user.click(screen.getByRole('menuitem', { name: 'CSV · 15 rows' }));

    const [file, headers, body] = exportCsv.mock.calls[0] as [string, string[], unknown[][]];
    expect(file).toBe('rows-2026-10-28.csv');
    // The redacted column and the column with nothing to export are left out.
    expect(headers).toEqual(['Name', 'Amount']);
    expect(body).toHaveLength(15);
    expect(body[0]).toEqual(['#Even 0', 0]);

    await user.click(screen.getByRole('button', { name: /Export/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Excel · 15 rows' }));
    expect(downloadXlsx).toHaveBeenCalledWith('rows-2026-10-28.xlsx', [
      { name: 'Rows', rows: [['Name', 'Amount'], ...body] },
    ]);
  });
});

describe('PlatformDataGrid shortcuts (Step 2d, ADR-047)', () => {
  const linkRows = rows.slice(0, 3);
  it('/ focuses search; J/K walk the row links; X selects; N creates — never while typing', async () => {
    const onNew = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns}
        data={linkRows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/rows/${r.id}`}
        label="Rows"
        selection={{ selected: new Set(), onSelect, onSelectAll: vi.fn(), actions: null }}
        shortcuts={{ onNew }}
      />,
    );
    await user.keyboard('j');
    expect(screen.getByRole('link', { name: 'Even 0' })).toHaveFocus();
    await user.keyboard('j');
    expect(screen.getByRole('link', { name: 'Odd 1' })).toHaveFocus();
    await user.keyboard('k');
    expect(screen.getByRole('link', { name: 'Even 0' })).toHaveFocus();
    await user.keyboard('x');
    expect(onSelect).toHaveBeenCalledWith('r0', true);

    await user.keyboard('/');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('n');
    expect(onNew).not.toHaveBeenCalled(); // typed into search, not a shortcut
    expect(screen.getByRole('searchbox')).toHaveValue('n');

    (document.activeElement as HTMLElement).blur();
    await user.keyboard('n');
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});

describe('PlatformDataGrid group-by and totals (Step 2e, ADR-047)', () => {
  const sum = (list: Row[]) => String(list.reduce((s, r) => s + r.amount, 0));
  it('groups rows under a header with count and subtotal, and totals every filtered row in the footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PlatformDataGrid
        columns={columns}
        data={rows.slice(0, 6)}
        rowKey={(r) => r.id}
        label="Rows"
        pagination={{ defaultPageSize: 4 }}
        groupOptions={[{ key: 'parity', label: 'Parity', groupOf: (r) => ({ id: r.name.split(' ')[0]!, label: r.name.split(' ')[0]! }) }]}
        totals={{ label: (n) => `${n} rows`, columns: { amount: sum } }}
      />,
    );
    // Footer totals all six rows (0+10+…+50 = 150), not just the four on the page.
    const footer = screen.getByText('6 rows').closest('tr')!;
    expect(footer).toHaveTextContent('150');

    await user.click(screen.getByRole('button', { name: /Group:/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Parity' }));
    // "Even" sorts before "Odd": evens 0, 20, 40 → 3 rows, 60.
    const even = screen.getByText('Even · 3 rows').closest('tr')!;
    expect(even).toHaveTextContent('60');
    // Page 1 holds four rows: the three evens, then the first odd under its own header.
    expect(screen.getByText('Odd · 3 rows').closest('tr')).toHaveTextContent('90');
  });
});
