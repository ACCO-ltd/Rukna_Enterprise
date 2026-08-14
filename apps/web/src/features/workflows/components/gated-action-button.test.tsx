import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowTransactionType } from '@erp/types';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { GatedActionButton } from './gated-action-button';

/**
 * The gate button ties `useGatedCommand` to the `ApprovalPanel`. The panel itself is covered by
 * its own test and needs several hooks to render; here it is stubbed so the assertions are about
 * the button's own flow — run, gate, re-drive — not the panel's internals.
 */
vi.mock('./approval-panel', () => ({
  ApprovalPanel: ({ instanceId }: { instanceId: string | null }) => (
    <div data-testid="approval-panel">panel:{instanceId}</div>
  ),
}));

function gate409(id: string): ApiError {
  return new ApiError(409, 'Requires approval', undefined, [], { approvalInstanceId: id });
}

function render(command: () => Promise<unknown>, onDone = vi.fn()) {
  renderWithProviders(
    <GatedActionButton
      command={command}
      transactionType={WorkflowTransactionType.PURCHASE_ORDER}
      label="Submit"
      onDone={onDone}
    />,
  );
  return { onDone };
}

describe('GatedActionButton', () => {
  it('runs the command and reports done when nothing gates it', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const { onDone } = render(command);

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
  });

  it('surfaces the approval panel and the re-drive control when the command gates', async () => {
    const command = vi.fn().mockRejectedValue(gate409('ai-9'));
    const { onDone } = render(command);

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByTestId('approval-panel')).toHaveTextContent('panel:ai-9');
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('completes once the re-drive succeeds after approval', async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(gate409('ai-9'))
      .mockResolvedValueOnce(undefined);
    const { onDone } = render(command);

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
  });

  it('shows a non-gate error and does not report done', async () => {
    const command = vi
      .fn()
      .mockRejectedValue(new ApiError(400, 'Bad request', undefined, ['Bad request']));
    const { onDone } = render(command);

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Bad request')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
  });
});
