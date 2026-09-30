import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useRecordSignedContract, type RecordSignedContractInput } from './use-record-signed-contract';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({ recordSignedContract: vi.fn() }));
vi.mock('../api/record-signed-contract-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/record-signed-contract-api')>()),
  recordSignedContract: api.recordSignedContract,
}));

function RecordProbe() {
  const record = useRecordSignedContract('p1');
  return (
    <button
      type="button"
      onClick={() => record.mutate({ projectId: 'p1' } as unknown as RecordSignedContractInput)}
    >
      Record
    </button>
  );
}

describe('record signed contract feedback', () => {
  it('marks the contract going live with the success dialog, not a toast', async () => {
    api.recordSignedContract.mockResolvedValue({
      contract: { id: 'c-1', projectId: 'p1', contractNumber: 'CON-0007', status: 'ACTIVE' },
      originalContractValue: '412500.00',
      currentContractValue: '412500.00',
      sourceSnapshotMetadata: { description: '' },
    });
    renderWithProviders(<RecordProbe />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Contract CON-0007 is active');
    expect(dialog).toHaveTextContent(/Billing is now open/);
    expect(push).toHaveBeenCalledWith('/projects/p1/commercial');

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
