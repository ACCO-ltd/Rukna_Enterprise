import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MoneyInput, formatThousands, sanitizeMoney } from '@erp/ui';

describe('formatThousands', () => {
  it('groups the integer part in threes', () => {
    expect(formatThousands('1000')).toBe('1,000');
    expect(formatThousands('1000000')).toBe('1,000,000');
    expect(formatThousands('999')).toBe('999');
  });

  it('leaves the fraction and a trailing dot untouched', () => {
    expect(formatThousands('1234.5')).toBe('1,234.5');
    expect(formatThousands('1234567.89')).toBe('1,234,567.89');
    expect(formatThousands('1000.')).toBe('1,000.');
  });

  it('passes empty and partial input straight through', () => {
    expect(formatThousands('')).toBe('');
    expect(formatThousands('0')).toBe('0');
    expect(formatThousands('0.5')).toBe('0.5');
  });

  it('groups a negative integer part', () => {
    expect(formatThousands('-12000')).toBe('-12,000');
  });
});

describe('sanitizeMoney', () => {
  it('strips grouping and stray characters', () => {
    expect(sanitizeMoney('1,000', 2)).toBe('1000');
    expect(sanitizeMoney('1,234.50 USD', 2)).toBe('1234.50');
    expect(sanitizeMoney('abc12x3', 2)).toBe('123');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeMoney('1.2.3', 2)).toBe('1.23');
  });

  it('clamps the fraction to the given scale', () => {
    expect(sanitizeMoney('12.999', 2)).toBe('12.99');
    expect(sanitizeMoney('12.999', 3)).toBe('12.999');
  });

  it('drops leading zeros but preserves 0 and 0.x', () => {
    expect(sanitizeMoney('007', 2)).toBe('7');
    expect(sanitizeMoney('0', 2)).toBe('0');
    expect(sanitizeMoney('0.5', 2)).toBe('0.5');
  });
});

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput aria-label="amount" value={value} onValueChange={setValue} />
      <output data-testid="raw">{value}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('shows grouped digits while storing the raw comma-free string', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('amount') as HTMLInputElement;
    await user.type(input, '1000000');

    expect(input.value).toBe('1,000,000');
    expect(screen.getByTestId('raw')).toHaveTextContent('1000000');
  });

  it('preserves the decimal portion', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('amount') as HTMLInputElement;
    await user.type(input, '1234.5');

    expect(input.value).toBe('1,234.5');
    expect(screen.getByTestId('raw')).toHaveTextContent('1234.5');
  });

  it('renders an initial raw value grouped', () => {
    render(<Harness initial="4500000.00" />);
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    expect(input.value).toBe('4,500,000.00');
  });

  it('reformats when a digit is inserted in the middle', async () => {
    const user = userEvent.setup();
    render(<Harness initial="100" />);

    const input = screen.getByLabelText('amount') as HTMLInputElement;
    // Caret at end, type another 0 → 1000 → grouped 1,000
    input.setSelectionRange(3, 3);
    await user.type(input, '0');

    expect(input.value).toBe('1,000');
    expect(screen.getByTestId('raw')).toHaveTextContent('1000');
  });

  it('ignores non-numeric keystrokes', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<MoneyInput aria-label="amount" value="12" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('amount') as HTMLInputElement;
    await user.type(input, 'x');

    // Last emitted raw is still "12" — the letter never becomes a value.
    expect(onValueChange).toHaveBeenLastCalledWith('12');
  });
});
