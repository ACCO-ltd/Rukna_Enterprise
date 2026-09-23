import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

describe('DateRangePicker', () => {
  it('shows the placeholder when no range is set', () => {
    render(
      <DateRangePicker
        id="dr-empty"
        fromValue=""
        toValue=""
        onChange={vi.fn()}
        placeholder="Select a date range"
      />,
    );

    expect(screen.getByRole('button', { name: 'Select a date range' })).toBeInTheDocument();
  });

  it('shows a single formatted date when from and to are the same day', () => {
    render(
      <DateRangePicker id="dr-one" fromValue="2026-04-15" toValue="2026-04-15" onChange={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: '15 Apr 2026' })).toBeInTheDocument();
  });

  it('shows a formatted range when from and to differ', () => {
    render(
      <DateRangePicker id="dr-range" fromValue="2026-04-01" toValue="2026-04-30" onChange={vi.fn()} />,
    );

    expect(
      screen.getByRole('button', { name: '1 Apr 2026 – 30 Apr 2026' }),
    ).toBeInTheDocument();
  });

  it('opens a calendar when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker id="dr-open" fromValue="" toValue="" onChange={vi.fn()} placeholder="Pick" />,
    );

    await user.click(screen.getByRole('button', { name: 'Pick' }));

    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('shows the clear action only once a range is set, and it clears both bounds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangePicker
        id="dr-clear"
        fromValue="2026-04-01"
        toValue="2026-04-30"
        onChange={onChange}
        clearLabel="Clear"
      />,
    );

    await user.click(screen.getByRole('button', { name: '1 Apr 2026 – 30 Apr 2026' }));
    const clear = screen.getByRole('button', { name: 'Clear' });
    await user.click(clear);

    expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
  });

  it('offers no clear action when no range is set', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker id="dr-noclear" fromValue="" toValue="" onChange={vi.fn()} clearLabel="Clear" placeholder="Pick" />,
    );

    await user.click(screen.getByRole('button', { name: 'Pick' }));

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});
