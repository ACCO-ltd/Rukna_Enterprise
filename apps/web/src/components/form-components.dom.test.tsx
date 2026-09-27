import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  FormField,
  Input,
  LineItemsEditor,
  MoneyInput,
  QuantityInput,
  sanitizeMoney,
  SwitchField,
} from '@erp/ui';

describe('FormField warning (ADR-037)', () => {
  it('shows a warning politely and marks the control, without making it invalid', () => {
    render(
      <FormField htmlFor="inv" label="Supplier invoice number" warning="Already recorded on BILL-2026-0042.">
        <Input id="inv" defaultValue="BCC/INV/5531" />
      </FormField>,
    );
    const input = screen.getByLabelText('Supplier invoice number');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby')).toContain('inv-warning');
    expect(screen.getByRole('status')).toHaveTextContent('Already recorded on BILL-2026-0042.');
  });

  it('lets an error win over a warning', () => {
    render(
      <FormField htmlFor="inv" label="Invoice" warning="Looks like a duplicate." error="Enter a number.">
        <Input id="inv" />
      </FormField>,
    );
    expect(screen.queryByText('Looks like a duplicate.')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.');
  });
});

describe('MoneyInput and QuantityInput (ADR-037)', () => {
  it('keeps a leading minus only where credits are allowed', () => {
    expect(sanitizeMoney('-1,250.00', 2, true)).toBe('-1250.00');
    expect(sanitizeMoney('-1,250.00', 2)).toBe('1250.00');
    expect(sanitizeMoney('12-50', 2, true)).toBe('1250');
  });

  it('shows the currency mark by default and groups digits', () => {
    function Harness() {
      const [value, setValue] = useState('48250.5');
      return <MoneyInput aria-label="Contract value" value={value} onValueChange={setValue} />;
    }
    render(<Harness />);
    expect(screen.getByLabelText('Contract value')).toHaveValue('48,250.5');
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('shows a quantity with its unit and no currency', () => {
    render(<QuantityInput aria-label="Received" value="180" onValueChange={() => {}} unit="bag" />);
    expect(screen.getByLabelText('Received')).toHaveValue('180');
    expect(screen.getByText('bag')).toBeInTheDocument();
    expect(screen.queryByText('$')).toBeNull();
  });
});

describe('SwitchField (ADR-037)', () => {
  it('toggles by click and keyboard and reports its state', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <SwitchField id="email" label="Email invoices to the contact" checked={on} onCheckedChange={setOn} />;
    }
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Email invoices to the contact' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

describe('LineItemsEditor (ADR-037)', () => {
  interface Line {
    id: string;
    description: string;
  }
  const columns = [
    {
      key: 'description',
      header: 'Description',
      required: true,
      width: 'minmax(0,2fr)',
      controlId: (i: number) => `line-${i}-description`,
      cell: (row: Line, i: number) => <Input id={`line-${i}-description`} defaultValue={row.description} />,
    },
  ];

  it('renders each control once, labelled, with its error, a row note, and remove/add', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <LineItemsEditor<Line>
        label="Invoice lines"
        rows={[{ id: 'a', description: 'Site mobilisation' }, { id: 'b', description: '' }]}
        rowKey={(row) => row.id}
        columns={columns}
        cardTitle={(row, i) => `Line ${i + 1} — ${row.description}`}
        errors={(i) => (i === 1 ? { description: 'Enter a description.' } : undefined)}
        note={(_row, i) => (i === 0 ? { tone: 'warning', text: 'Billing 20 bag more than received.' } : null)}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );
    // One control per cell — not a table copy plus a card copy.
    expect(screen.getAllByDisplayValue('Site mobilisation')).toHaveLength(1);
    expect(document.querySelectorAll('#line-0-description')).toHaveLength(1);
    expect(screen.getAllByLabelText(/Description/)[0]).toHaveAttribute('id', 'line-0-description');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a description.');
    expect(screen.getByText('Billing 20 bag more than received.')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Invoice lines' });
    await user.click(within(table).getAllByRole('button', { name: 'Remove line 2' })[0]!);
    expect(onRemove).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('offers neither add nor remove when the lines come from a source document', () => {
    render(
      <LineItemsEditor<Line>
        label="Invoice lines"
        rows={[{ id: 'a', description: 'Milestone 3 of 4' }]}
        rowKey={(row) => row.id}
        columns={[{ ...columns[0]!, cell: (row: Line) => row.description }]}
        cardTitle={(row) => row.description}
        onAdd={() => {}}
        onRemove={() => {}}
        readOnly
      />,
    );
    expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a line' })).toBeNull();
  });
});
