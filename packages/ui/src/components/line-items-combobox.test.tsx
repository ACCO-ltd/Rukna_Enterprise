import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LineItemsEditor, comboboxColumn, type LineColumn } from './form-layout';

interface Material {
  id: string;
  code: string;
  name: string;
}

interface Row {
  key: string;
  materialId: string;
  description: string;
  quantity: string;
}

const MATERIALS: Material[] = [
  { id: 'm1', code: 'RB-12', name: 'Rebar 12mm' },
  { id: 'm2', code: 'CM-50', name: 'Cement 50kg' },
];

function Harness({
  initial,
  onCreateSpy,
  readOnly,
}: {
  initial?: Row[];
  onCreateSpy?: (text: string) => void;
  readOnly?: boolean;
}) {
  const [rows, setRows] = React.useState<Row[]>(
    initial ?? [{ key: 'a', materialId: '', description: '', quantity: '' }],
  );
  const update = (i: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const columns: LineColumn<Row>[] = [
    comboboxColumn<Row, Material>({
      type: 'combobox',
      key: 'item',
      header: 'Item',
      required: true,
      width: 'minmax(0,2fr)',
      options: MATERIALS,
      getOptionValue: (m) => m.id,
      getOptionLabel: (m) => m.name,
      getOptionHint: (m) => m.code,
      value: (row) => row.materialId,
      valueLabel: (row) => (row.materialId ? undefined : row.description || undefined),
      onPick: (_row, i, m) => update(i, { materialId: m.id, description: m.name }),
      onCreate: (_row, i, text) => {
        onCreateSpy?.(text);
        update(i, { materialId: '', description: text });
      },
      createLabel: (text) => (text ? `Add "${text}" as a one-off item` : 'Add a one-off item'),
      placeholder: 'Search materials',
    }),
    {
      key: 'qty',
      header: 'Quantity',
      width: '6rem',
      controlId: (i) => `qty-${i}`,
      cell: (row, i) => (
        <input id={`qty-${i}`} value={row.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
      ),
    },
  ];

  return (
    <>
      <LineItemsEditor
        label="Request lines"
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        cardTitle={(_r, i) => `Line ${i + 1}`}
        readOnly={readOnly}
      />
      <output data-testid="state">{JSON.stringify(rows)}</output>
    </>
  );
}

function state(): Row[] {
  return JSON.parse(screen.getByTestId('state').textContent ?? '[]') as Row[];
}

describe('LineItemsEditor — combobox column', () => {
  it('labels the combobox with its column header and picks an option by keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('combobox', { name: /Item/ });
    expect(trigger).toHaveTextContent('Search materials');
    trigger.focus();
    await user.keyboard('{Enter}');
    const filter = await screen.findByPlaceholderText('Search materials');
    await user.type(filter, 'cem');
    await user.keyboard('{Enter}');

    expect(state()[0]).toMatchObject({ materialId: 'm2', description: 'Cement 50kg' });
    expect(screen.getByRole('combobox', { name: /Item/ })).toHaveTextContent('Cement 50kg');
  });

  it('hands the typed text to onCreate from the pinned row and shows it on the trigger', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Harness onCreateSpy={onCreate} />);

    await user.click(screen.getByRole('combobox', { name: /Item/ }));
    await user.type(await screen.findByPlaceholderText('Search materials'), 'Site signage');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0);
    await user.click(screen.getByRole('option', { name: 'Add "Site signage" as a one-off item' }));

    expect(onCreate).toHaveBeenCalledWith('Site signage');
    expect(state()[0]).toMatchObject({ materialId: '', description: 'Site signage' });
    expect(screen.getByRole('combobox', { name: /Item/ })).toHaveTextContent('Site signage');
  });

  it('keeps plain cell columns working beside it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Quantity'), '12');
    expect(state()[0]!.quantity).toBe('12');
  });

  it('renders the chosen label as text when the editor is read-only', () => {
    render(
      <Harness
        readOnly
        initial={[{ key: 'a', materialId: 'm1', description: 'Rebar 12mm', quantity: '3' }]}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Rebar 12mm')).toBeInTheDocument();
  });
});
