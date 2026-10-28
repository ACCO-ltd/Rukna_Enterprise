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
