import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SuccessDialog } from './success-dialog';

describe('SuccessDialog', () => {
  it('names what happened, and Done closes it', async () => {
    const onOpenChange = vi.fn();
    render(
      <SuccessDialog
        open
        onOpenChange={onOpenChange}
        title="Invoice INV-0042 posted"
        description="It now sits in receivables."
        doneLabel="Done"
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Invoice INV-0042 posted' });
    expect(dialog).toHaveTextContent('It now sits in receivables.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('runs the follow-up action after closing', async () => {
    const calls: string[] = [];
    render(
      <SuccessDialog
        open
        onOpenChange={() => calls.push('close')}
        title="Period closed"
        doneLabel="Done"
        action={{ label: 'View trial balance', onClick: () => calls.push('action') }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'View trial balance' }));
    expect(calls).toEqual(['close', 'action']);
  });
});
