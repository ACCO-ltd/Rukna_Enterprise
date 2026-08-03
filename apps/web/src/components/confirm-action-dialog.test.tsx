import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ConfirmActionDialog } from './confirm-action-dialog';

function setup(overrides: Partial<Parameters<typeof ConfirmActionDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onDismiss = vi.fn();

  renderWithProviders(
    <ConfirmActionDialog
      title="Cancel project"
      description="This cannot be undone."
      confirmLabel="Cancel project"
      isPending={false}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );

  return { onConfirm, onDismiss, user: userEvent.setup() };
}

describe('ConfirmActionDialog — dismissal', () => {
  it('dismisses on Escape when idle', async () => {
    const { onDismiss, user } = setup();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  // The commands behind this dialog are irreversible, and while one is in flight the user
  // cannot tell from the outside whether it has already been sent. Closing the dialog at
  // that moment leaves them guessing, so every dismissal path is blocked — not just the
  // keyboard one, which was the bug in the hand-rolled implementation this replaced.
  it('cannot be dismissed by Escape while the command is in flight', async () => {
    const { onDismiss, user } = setup({ isPending: true });

    await user.keyboard('{Escape}');

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Dispatched directly rather than through `user.click`: while a modal is open Radix marks
  // everything outside it `pointer-events: none`, and user-event refuses to click an inert
  // element. That containment is itself part of the protection — this asserts the guard
  // underneath it, for the case where a real pointer event still reaches the document.
  it('cannot be dismissed by an outside pointer while the command is in flight', () => {
    const { onDismiss } = setup({ isPending: true });

    fireEvent.pointerDown(document.body);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables both buttons while the command is in flight', () => {
    setup({ isPending: true });

    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

describe('ConfirmActionDialog — reason', () => {
  it('opens focus on the reason field so it can be typed into immediately', async () => {
    setup({ reason: { required: true } });

    await waitFor(() => {
      expect(screen.getByLabelText('Reason')).toHaveFocus();
    });
  });

  it('blocks confirmation until a required reason is supplied', async () => {
    const { onConfirm, user } = setup({ reason: { required: true } });

    await user.click(screen.getByRole('button', { name: 'Cancel project' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a reason')).toBeInTheDocument();
  });

  it('passes the trimmed reason through on confirmation', async () => {
    const { onConfirm, user } = setup({ reason: { required: true } });

    await user.type(screen.getByLabelText('Reason'), '  Client suspended funding  ');
    await user.click(screen.getByRole('button', { name: 'Cancel project' }));

    expect(onConfirm).toHaveBeenCalledWith('Client suspended funding');
  });

  it('rejects a reason longer than the server would accept', async () => {
    const { onConfirm, user } = setup({ reason: { required: true, maxLength: 10 } });

    await user.type(screen.getByLabelText('Reason'), 'far too long to be accepted');
    await user.click(screen.getByRole('button', { name: 'Cancel project' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Reason cannot exceed 10 characters')).toBeInTheDocument();
  });

  it('confirms straight away when no reason is required', async () => {
    const { onConfirm, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel project' }));

    expect(onConfirm).toHaveBeenCalledWith('');
  });
});
