import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewSwitcher } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

/**
 * ViewSwitcher — the quiet segmented control for a level-3 local view switch inside a module
 * (ux-doctrine §5). These pin the contract the Progress workspace relies on: a `tablist` of
 * `tab` buttons with a single selected segment, `onValueChange` on click, and roving arrow-key
 * navigation. It must NOT be the underline `Tabs` treatment — that distinction is visual, but
 * the accessibility model (tablist + roving focus + aria-selected) is what these tests fix.
 */
const ITEMS = [
  { value: 'reports', label: 'Daily Reports' },
  { value: 'packages', label: 'Work Packages' },
  { value: 'verified', label: 'Verified Progress' },
];

function Harness({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState('reports');
  return (
    <ViewSwitcher
      items={ITEMS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      aria-label="Progress views"
    />
  );
}

describe('ViewSwitcher', () => {
  it('renders a labelled tablist with a tab per item', () => {
    render(<Harness />);

    const list = screen.getByRole('tablist', { name: 'Progress views' });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toBeInTheDocument();
  });

  it('marks exactly the current value as selected', () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: 'Daily Reports' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onValueChange with the clicked value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('tab', { name: 'Verified Progress' }));

    expect(onValueChange).toHaveBeenCalledWith('verified');
    expect(screen.getByRole('tab', { name: 'Verified Progress' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves selection with the right arrow key (roving focus)', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    // Only the selected tab is tabbable; focus it, then arrow to the next.
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Daily Reports' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenLastCalledWith('packages');
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toHaveFocus();
  });

  it('wraps from the last tab to the first with the right arrow', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('tab', { name: 'Verified Progress' }));
    await user.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenLastCalledWith('reports');
  });
});
