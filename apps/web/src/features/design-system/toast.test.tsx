import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, ToastProvider, useToast } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

/**
 * The three rules that make a toast trustworthy, pinned.
 *
 * These are behavioural, not cosmetic, and each one is a bug someone would otherwise ship:
 * an error that disappeared before it was read, a success that interrupted a screen-reader
 * user mid-sentence, a toast that vanished while they tabbed to its Undo.
 *
 * Lives under `features/design-system` rather than in `packages/ui` because the UI package
 * has no test runner of its own — the same reason the primitives' other tests sit in the app.
 */

function Harness() {
  const { toast } = useToast();
  return (
    <div>
      <Button
        onClick={() => toast({ tone: 'success', title: 'Certificate issued', duration: 4000 })}
      >
        raise success
      </Button>
      <Button onClick={() => toast({ tone: 'error', title: 'Journal could not be posted' })}>
        raise error
      </Button>
      <Button
        onClick={() =>
          toast({ tone: 'info', title: 'Draft saved', action: { label: 'Undo', onClick: onUndo } })
        }
      >
        raise with action
      </Button>
    </div>
  );
}

const onUndo = vi.fn();

function renderHarness() {
  return render(
    <ToastProvider regionLabel="Notifications" dismissLabel="Dismiss">
      <Harness />
    </ToastProvider>,
  );
}

describe('toast', () => {
  it('announces a failure assertively and everything else politely', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'raise success' }));
    await user.click(screen.getByRole('button', { name: 'raise error' }));

    // Two regions, not one. aria-live is a property of the region, so a single region would
    // either interrupt for every success or bury the failure behind it.
    const assertive = document.querySelector('[aria-live="assertive"]');
    const polite = document.querySelector('[aria-live="polite"]');

    expect(assertive).not.toBeNull();
    expect(polite).not.toBeNull();
    expect(assertive?.textContent).toContain('Journal could not be posted');
    expect(assertive?.textContent).not.toContain('Certificate issued');
    expect(polite?.textContent).toContain('Certificate issued');
  });

  it('never auto-dismisses a failure, however long it sits there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderHarness();

      await user.click(screen.getByRole('button', { name: 'raise error' }));
      expect(screen.getByText('Journal could not be posted')).toBeInTheDocument();

      // Far past any plausible auto-dismiss window. An error explaining why a journal did not
      // post has to still be there when the user looks back at the screen.
      act(() => {
        vi.advanceTimersByTime(120_000);
      });

      expect(screen.getByText('Journal could not be posted')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-dismisses a success once its duration elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderHarness();

      await user.click(screen.getByRole('button', { name: 'raise success' }));
      expect(screen.getByText('Certificate issued')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4100);
      });

      await waitFor(() => expect(screen.queryByText('Certificate issued')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the timer while the toast is hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderHarness();

      await user.click(screen.getByRole('button', { name: 'raise success' }));
      const card = screen.getByText('Certificate issued').closest('div');
      expect(card).not.toBeNull();

      await user.hover(card as HTMLElement);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      // Still there: someone reading it must not have it vanish mid-sentence.
      expect(screen.getByText('Certificate issued')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the action and closes, so an Undo cannot be pressed twice', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'raise with action' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Draft saved')).not.toBeInTheDocument());
  });

  it('dismisses on the close button', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'raise error' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() =>
      expect(screen.queryByText('Journal could not be posted')).not.toBeInTheDocument(),
    );
  });

  it('throws when used outside a provider rather than silently doing nothing', () => {
    // A mutation whose confirmation vanishes because a provider was not mounted is exactly
    // the bug this component exists to prevent. It must fail loudly.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Harness />)).toThrow(/ToastProvider/);
    } finally {
      quiet.mockRestore();
    }
  });
});
