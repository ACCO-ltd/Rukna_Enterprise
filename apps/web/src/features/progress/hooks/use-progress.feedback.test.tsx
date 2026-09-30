import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useAddMeasurement, useSubmitDpr } from './use-progress';

const api = vi.hoisted(() => ({ submitDpr: vi.fn(), addMeasurement: vi.fn() }));
vi.mock('../api/progress-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/progress-api')>()),
  submitDpr: api.submitDpr,
  addMeasurement: api.addMeasurement,
}));

function SubmitProbe() {
  const submit = useSubmitDpr('p1', 'dpr-1');
  return (
    <button type="button" onClick={() => submit.mutate()}>
      Submit
    </button>
  );
}

function AddProbe({ silent }: { silent: boolean }) {
  const add = useAddMeasurement('dpr-1', { silent });
  return (
    <button
      type="button"
      onClick={() => add.mutate({ boqNodeId: 'leaf-1', quantity: 2 })}
      data-settled={add.isSuccess ? 'yes' : 'no'}
    >
      Add
    </button>
  );
}

beforeEach(() => {
  api.submitDpr.mockReset();
  api.addMeasurement.mockReset();
});

describe('progress mutation feedback', () => {
  it('confirms a submitted daily report by its date', async () => {
    api.submitDpr.mockResolvedValue({ id: 'dpr-1', reportDate: '2026-09-30', status: 'SUBMITTED' });
    renderWithProviders(<SubmitProbe />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(
      await screen.findByText('Daily report for Sep 30, 2026 submitted for review'),
    ).toBeInTheDocument();
  });

  it('confirms a quantity recorded on its own', async () => {
    api.addMeasurement.mockResolvedValue({ id: 'm-1' });
    renderWithProviders(<AddProbe silent={false} />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Quantity recorded')).toBeInTheDocument();
  });

  it('stays quiet when the row is one step of a larger save', async () => {
    api.addMeasurement.mockResolvedValue({ id: 'm-1' });
    renderWithProviders(<AddProbe silent />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('data-settled', 'yes'),
    );
    expect(screen.queryByText('Quantity recorded')).not.toBeInTheDocument();
  });
});
