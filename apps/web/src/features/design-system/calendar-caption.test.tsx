import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from '@erp/ui';

import { renderWithProviders } from '@/test/render';

/**
 * The calendar caption in dropdown layout.
 *
 * react-day-picker renders two elements per control there — a real `<select>` and, beside it,
 * an `aria-hidden` span carrying the selected label and a caret. The span is what is meant to
 * be seen; the select is meant to lie over it transparently as the hit target. Style both as
 * visible and the header reads "August August 2026 2026" with two orphaned carets under it,
 * which is exactly what shipped.
 *
 * Nothing about that is visible to the DOM: both elements render either way, and only CSS
 * decides which one a person sees. So these assertions are on class names, deliberately —
 * they encode the contract with react-day-picker's markup that the styling got wrong.
 */
describe('Calendar caption (dropdown layout)', () => {
  const open = async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatePicker id="d" value="2026-09-04" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));
    return user;
  };

  it('keeps the native selects transparent, so the styled label is what shows', async () => {
    await open();

    const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT');
    expect(selects).toHaveLength(2); // month and year

    for (const select of selects) {
      expect(select).toHaveClass('opacity-0');
    }
  });

  it('hides the label span from assistive technology, since the select carries the name', async () => {
    await open();

    // Both halves announce the same value; only one of them should be readable.
    const month = screen.getByRole('combobox', { name: /choose the month/i });
    const labelSpan = month.parentElement?.querySelector('[aria-hidden="true"]');
    expect(labelSpan).not.toBeNull();
  });

  it('does not dim the selected day when it falls in a neighbouring month', async () => {
    // 1 Oct 2026 sits in September's trailing row. Both `outside` and `selected` land on that
    // cell, and an unscoped opacity on `outside` washed the selection out to a pale blue.
    const user = userEvent.setup();
    renderWithProviders(<DatePicker id="d" value="2026-09-04" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));

    const outsideDay = document.querySelector('[data-day="2026-10-01"][data-outside]');
    expect(outsideDay).not.toBeNull();
    expect(outsideDay?.className).toContain(':not([data-selected])');
  });
});
