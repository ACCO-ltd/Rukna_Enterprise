import { render, screen } from '@testing-library/react';
import { DatePicker, FormField, Input, Select, Textarea } from '@erp/ui';
import { describe, expect, it } from 'vitest';

/**
 * Field state precedence and the wiring it drives.
 *
 * The rule under test everywhere below: **error beats success.** A field showing a stale tick
 * beside a live failure is worse than showing no tick at all, and on a form that moves money
 * it is the difference between someone trusting a figure and checking it.
 */
describe('FormField — success', () => {
  it('renders a success message and points the control at it', () => {
    render(
      <FormField htmlFor="tax" label="Tax number" success="Verified — matches registered supplier">
        <Input id="tax" defaultValue="SO-0114" />
      </FormField>,
    );

    expect(screen.getByText('Verified — matches registered supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Tax number')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('tax-success'),
    );
  });

  it('announces success politely, never assertively', () => {
    render(
      <FormField htmlFor="tax" label="Tax number" success="Verified">
        <Input id="tax" />
      </FormField>,
    );

    // A confirmation must not interrupt what someone is reading. Unlike an error, it costs
    // nothing to hear a moment later.
    const node = screen.getByText('Verified');
    expect(node).toHaveAttribute('role', 'status');
    expect(node).not.toHaveAttribute('role', 'alert');
  });

  it('suppresses success entirely when an error is also present', () => {
    render(
      <FormField
        htmlFor="qty"
        label="Cumulative claimed"
        success="Verified"
        error="Exceeds BOQ quantity by 300.000. Remaining: 2 500.000"
      >
        <Input id="qty" defaultValue="2800" />
      </FormField>,
    );

    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(
      screen.getByText('Exceeds BOQ quantity by 300.000. Remaining: 2 500.000'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Cumulative claimed')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('FormField — counter', () => {
  it('shows the count and turns danger-toned past the limit', () => {
    const { rerender } = render(
      <FormField htmlFor="n" label="Notes" counter={{ value: 42, max: 120 }}>
        <Textarea id="n" />
      </FormField>,
    );
    expect(screen.getByText('42 / 120')).toBeInTheDocument();
    expect(screen.getByText('42 / 120').className).not.toContain('text-danger');

    rerender(
      <FormField htmlFor="n" label="Notes" counter={{ value: 130, max: 120 }}>
        <Textarea id="n" />
      </FormField>,
    );
    expect(screen.getByText('130 / 120').className).toContain('text-danger');
  });
});

describe('FormField — checking', () => {
  it('renders a status line so a pending verdict is not read as no verdict', () => {
    render(
      <FormField htmlFor="c" label="Contract number" checking checkingLabel="Checking availability…">
        <Input id="c" />
      </FormField>,
    );
    expect(screen.getByText('Checking availability…')).toHaveAttribute('role', 'status');
  });
});

describe('the whole field set honours the context', () => {
  // A field set where only one control can show success is worse than one where none can:
  // the reader learns the tick is unreliable and stops trusting it.
  const controls = [
    ['Input', (id: string) => <Input id={id} />],
    ['Select', (id: string) => <Select id={id}><option>a</option></Select>],
    ['Textarea', (id: string) => <Textarea id={id} />],
    ['DatePicker', (id: string) => <DatePicker id={id} value="" onChange={() => {}} />],
  ] as const;

  for (const [name, renderControl] of controls) {
  it(`${name} takes the success border and describedby from context`, () => {
      render(
        <FormField htmlFor="f" label={name} success="Verified">
          {renderControl('f')}
        </FormField>,
      );
      const control = screen.getByLabelText(name);
      expect(control.className).toContain('border-success');
      expect(control).toHaveAttribute('aria-describedby', expect.stringContaining('f-success'));
    });

    it(`${name} drops the success border when an error is present`, () => {
      render(
        <FormField htmlFor="f" label={name} success="Verified" error="Nope">
          {renderControl('f')}
        </FormField>,
      );
      const control = screen.getByLabelText(name);
      expect(control.className).not.toContain('border-success');
      expect(control).toHaveAttribute('aria-invalid', 'true');
    });
  }
});

describe('Input — slots', () => {
  it('renders no wrapper when neither slot is passed', () => {
    // Existing callers must be unaffected: 244 components render this control today and a
    // surprise wrapper div changes layouts that target the input directly.
    const { container } = render(<Input aria-label="bare" />);
    expect(container.firstElementChild?.tagName).toBe('INPUT');
  });

  it('wraps and pads only when a slot is passed', () => {
    const { container } = render(
      <Input aria-label="with slot" startSlot={<span>SOS</span>} />,
    );
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(screen.getByText('SOS')).toBeInTheDocument();
    expect(screen.getByLabelText('with slot').className).toContain('ps-10');
  });
});
