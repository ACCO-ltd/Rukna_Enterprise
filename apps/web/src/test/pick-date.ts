import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Choose a date through the calendar popover.
 *
 * ─── Why tests need this at all ──────────────────────────────────────────────────
 *
 * Date fields used to be `<input type="date">`, so a test set one with
 * `clear()` + `type('2026-03-31')`. `DatePicker` is a button that opens a calendar, and
 * `clear()` refuses outright on a non-editable element — which is what twenty-four tests
 * started reporting the moment the control changed. Rewriting each of them to open a popover,
 * page to a month and find a cell would put the same twenty lines in twenty-four places, and
 * every one of them would be a place the calendar's internals leak into a test about billing.
 *
 * ─── How it finds the day ────────────────────────────────────────────────────────
 *
 * `react-day-picker` stamps every grid cell with `data-day="yyyy-MM-dd"`, so the target is
 * addressable exactly rather than by reading day numbers out of a grid where the leading and
 * trailing cells repeat them. Cells carrying `data-outside` are the neighbouring month's
 * spill-over and are skipped: clicking one is legal in the UI but would make the assertion
 * depend on which month happened to be displayed.
 *
 * Paging is driven by comparing the first in-month cell with the target, so the helper walks
 * in the right direction from wherever the picker opened — which is the selected month when
 * there is a value, and today when there is not.
 */
export async function pickDate(user: UserEvent, trigger: HTMLElement, isoDate: string): Promise<void> {
  await openAtMonth(user, trigger, isoDate);

  const cell = document.querySelector<HTMLElement>(`[data-day="${isoDate}"]:not([data-outside])`);
  if (!cell) throw new Error(`pickDate: ${isoDate} is not in the displayed month.`);

  const dayButton = within(cell).queryByRole('button');
  if (!dayButton) {
    throw new Error(`pickDate: ${isoDate} is present but not selectable (disabled or hidden).`);
  }
  await user.click(dayButton);
}

/**
 * Open a picker and put the target's month on screen, via the caption dropdowns.
 *
 * Paging with the chevrons costs one interaction per month, and the dates this product records
 * are routinely years from today — a contract completing in 2029 was forty clicks, which is
 * slow enough that the tests doing it began timing out under a full-suite run. The dropdowns
 * make it two selections whatever the distance, which is also why they exist for users.
 *
 * The year is set before the month: react-day-picker rebuilds the month list against the new
 * year, so setting them the other way round can leave the month selection discarded.
 */
async function openAtMonth(user: UserEvent, trigger: HTMLElement, isoDate: string): Promise<void> {
  await user.click(trigger);

  const [year, month] = isoDate.split('-');
  if (!year || !month) throw new Error(`pickDate: "${isoDate}" is not yyyy-MM-dd.`);

  const yearSelect = screen.queryByRole('combobox', { name: /choose the year/i });
  const monthSelect = screen.queryByRole('combobox', { name: /choose the month/i });
  if (!yearSelect || !monthSelect) throw new Error('pickDate: no calendar is open.');

  await user.selectOptions(yearSelect, year);
  // Month values are zero-based in react-day-picker's dropdown.
  await user.selectOptions(monthSelect, String(Number(month) - 1));
}

/** Clear a date through the popover's Clear action. Only present when `clearLabel` is set. */
export async function clearDate(user: UserEvent, trigger: HTMLElement, clearLabel: RegExp): Promise<void> {
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: clearLabel }));
}

/**
 * Open a picker and page to the month holding `isoDate`, returning that day's grid cell
 * without selecting it.
 *
 * For asserting on a day rather than choosing one — that it is disabled, say. The calendar
 * opens on the month of its own value, which is often not the month of the day under test, so
 * "query the document for the cell" only works by accident.
 */
export async function findDayCell(
  user: UserEvent,
  trigger: HTMLElement,
  isoDate: string,
): Promise<HTMLElement> {
  await openAtMonth(user, trigger, isoDate);

  const cell = document.querySelector<HTMLElement>(`[data-day="${isoDate}"]`);
  if (!cell) throw new Error(`findDayCell: ${isoDate} is not in the displayed month.`);
  return cell;
}
