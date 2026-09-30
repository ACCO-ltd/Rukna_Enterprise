import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqTreeNodeResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Success feedback for BOQ line commands. A line saved through the item dialog is confirmed with
 * a toast naming it — never its rate or amount, which money-blind readers must not see — while an
 * inline grid edit (`silent`) stays quiet: the cell already shows the saved value.
 */
vi.mock('../api/boq-api', () => ({
  addBoqNode: vi.fn(),
  updateBoqNode: vi.fn(),
  deleteBoqNode: vi.fn(),
}));

import { addBoqNode, updateBoqNode } from '../api/boq-api';
import { useAddNode, useUpdateNode } from './use-boq';

function node(overrides: Partial<BoqTreeNodeResponse> = {}): BoqTreeNodeResponse {
  return {
    id: 'n1',
    code: '2.3',
    description: 'Blockwork',
    isLeaf: true,
    unitRate: '48.50',
    totalAmount: '12125.00',
    ...overrides,
  } as BoqTreeNodeResponse;
}

function DialogSave() {
  const add = useAddNode('p1', 'v1');
  const update = useUpdateNode('p1', 'v1');
  return (
    <>
      <button type="button" onClick={() => add.mutate({ description: 'Blockwork', isLeaf: true })}>
        Add item
      </button>
      <button type="button" onClick={() => update.mutate({ nodeId: 'n1', payload: {} })}>
        Save item
      </button>
    </>
  );
}

function InlineEdit() {
  const update = useUpdateNode('p1', 'v1', { silent: true });
  return (
    <button type="button" onClick={() => update.mutate({ nodeId: 'n1', payload: {} })}>
      Commit cell
    </button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BOQ line commands — success feedback', () => {
  it('confirms an item saved from the dialog by its code, with no money in the message', async () => {
    vi.mocked(updateBoqNode).mockResolvedValue(node());
    const user = userEvent.setup();
    renderWithProviders(<DialogSave />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(await screen.findByText('Item 2.3 updated')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/48\.50|12,?125/);
  });

  it('names a new section as a section', async () => {
    vi.mocked(addBoqNode).mockResolvedValue(node({ code: '3', isLeaf: false }));
    const user = userEvent.setup();
    renderWithProviders(<DialogSave />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(await screen.findByText('Section 3 added')).toBeInTheDocument();
  });

  it('stays silent for an inline cell edit', async () => {
    vi.mocked(updateBoqNode).mockResolvedValue(node());
    const user = userEvent.setup();
    renderWithProviders(<InlineEdit />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Commit cell' }));

    await waitFor(() => expect(updateBoqNode).toHaveBeenCalled());
    // Let the mutation settle before asserting nothing was raised.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Item 2.3 updated')).not.toBeInTheDocument();
  });
});
