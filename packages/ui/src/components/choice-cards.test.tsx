import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChoiceCards, type ChoiceCardOption } from './choice-cards';

type Mode = 'UNIT_RATE' | 'LUMP_SUM' | 'PROVISIONAL';

const OPTIONS: ChoiceCardOption<Mode>[] = [
  { value: 'UNIT_RATE', label: 'Unit rate', hint: 'Quantity × rate' },
  { value: 'LUMP_SUM', label: 'Lump sum', hint: 'One fixed amount' },
  { value: 'PROVISIONAL', label: 'Provisional sum', hint: 'An allowance' },
];

function Harness({
  initial = 'UNIT_RATE',
  options = OPTIONS,
  onChange,
}: {
  initial?: Mode | '';
  options?: ChoiceCardOption<Mode>[];
  onChange?: (value: Mode) => void;
}) {
  const [value, setValue] = React.useState<Mode | ''>(initial);
  return (
    <ChoiceCards
      label="Pricing"
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('ChoiceCards', () => {
  it('is a labelled radiogroup of radios named by their label and described by their hint', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Pricing' })).toBeInTheDocument();
    const unitRate = screen.getByRole('radio', { name: 'Unit rate' });
    expect(unitRate).toHaveAttribute('aria-checked', 'true');
    expect(unitRate).toHaveAccessibleDescription('Quantity × rate');
    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('aria-checked', 'false');
  });

  it('has one tab stop: the selected card', () => {
    render(<Harness initial="LUMP_SUM" />);
    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveAttribute('tabindex', '-1');
  });

  it('with nothing selected, the first card is the tab stop', () => {
    render(<Harness initial="" />);
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveAttribute('tabindex', '0');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('selects on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Lump sum' }));
    expect(onChange).toHaveBeenCalledWith('LUMP_SUM');
    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('aria-checked', 'true');
  });

  it('arrow keys move focus and selection, wrapping; Home and End jump', async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    const lumpSum = screen.getByRole('radio', { name: 'Lump sum' });
    expect(lumpSum).toHaveFocus();
    expect(lumpSum).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Provisional sum' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Provisional sum' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Provisional sum' })).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Space selects the focused card', async () => {
    render(<Harness initial="" />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled options and ignores clicks on them', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        options={[OPTIONS[0]!, { ...OPTIONS[1]!, disabled: true }, OPTIONS[2]!]}
      />,
    );
    const disabled = screen.getByRole('radio', { name: 'Lump sum' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Provisional sum' })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith('PROVISIONAL');
  });
});
