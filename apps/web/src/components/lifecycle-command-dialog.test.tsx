import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { LifecycleCommandDialog } from './lifecycle-command-dialog';

function renderDialog(overrides: Partial<Parameters<typeof LifecycleCommandDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  renderWithProviders(
    <LifecycleCommandDialog
      open
      onClose={onClose}
      commandName="Start a revision"
      currentStatus="COMMITTED"
      nextStatus="DRAFT"
      statusVocabulary="boqVersion"
      businessImpact="A new working draft is created from the current version."
      reason={{ required: true, label: 'Notes' }}
      confirmLabel="Start revision"
      isPending={false}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

describe('LifecycleCommandDialog (FormDialog)', () => {
  it('names the dialog by the command and starts in the reason field', async () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Start a revision' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveFocus());
  });

  it('requires the reason, then confirms with it trimmed', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Start revision' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a reason')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), '  Client asked for a change  ');
    await userEvent.click(screen.getByRole('button', { name: 'Start revision' }));
    expect(onConfirm).toHaveBeenCalledWith('Client asked for a change');
  });

  it('closes at once when nothing was typed', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('holds a typed reason behind the discard question', async () => {
    const { onClose } = renderDialog();
    await userEvent.type(screen.getByLabelText('Notes'), 'Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be dismissed while the command runs', async () => {
    const { onClose } = renderDialog({ isPending: true });
    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
