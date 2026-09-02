import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Choose a value from a `Select`.
 *
 * ─── Why `selectOptions` stopped working ─────────────────────────────────────────
 *
 * `Select` is no longer a native `<select>` — its option list is now rendered by the app
 * instead of by the operating system, which is the only way it could be styled at all.
 * `user.selectOptions` drives the native element's own selection API and has nothing to talk
 * to any more, so the forty-five tests that used it needed a way to say the same thing.
 *
 * ─── Why it matches on value, not on the visible text ────────────────────────────
 *
 * The tests it replaces passed values — `'d-wbr'`, `'COMMERCIAL'`, `'client-1'` — and those
 * are the things the assertions then check were submitted. Matching on display text instead
 * would couple every one of them to translated copy, and in lists like accounts or invoices
 * that text is not even unique. `Select` stamps `data-value` on each row for exactly this.
 */
export async function chooseOption(
  user: UserEvent,
  trigger: HTMLElement,
  /** The option's value, or a pattern matched against its visible text. */
  value: string | RegExp,
): Promise<void> {
  await user.click(trigger);

  if (value instanceof RegExp) {
    await user.click(await screen.findByRole('option', { name: value }));
    return;
  }

  // Radix renders the list in a portal, so this is a document query rather than a `within`.
  // It waits rather than reading once: most of these lists are fed by a query, and the option
  // appears only after it resolves. Waiting here is what lets the call sites drop the
  // `await screen.findByRole('option', …)` line they each used to need first.
  let option: HTMLElement | null = null;
  await waitFor(() => {
    option = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    if (!option) {
      const offered = Array.from(document.querySelectorAll('[role="option"]'))
        .map((el) => el.getAttribute('data-value'))
        .join(', ');
      throw new Error(`chooseOption: no option with value "${value}". Offered: ${offered || 'none'}.`);
    }
  });

  await user.click(option as unknown as HTMLElement);
}

/**
 * Open a `Select` and leave its list on screen, for tests that assert on what is *offered*
 * rather than choosing something.
 *
 * A native `<select>` kept every `<option>` in the DOM whether or not it was open, so those
 * assertions could run against a closed control. Radix mounts the list only while open — which
 * is what makes it stylable — so the list has to be opened first. Nothing else about the
 * assertions changes.
 */
export async function openSelect(user: UserEvent, trigger: HTMLElement): Promise<void> {
  await user.click(trigger);
  await screen.findByRole('listbox');
}
