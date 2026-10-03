import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useCanMarkReadyToBill, useMarkReadyToBill, useRevokeReadyToBill } from './use-mark-ready-to-bill';

const api = vi.hoisted(() => ({ mark: vi.fn(), revoke: vi.fn() }));
vi.mock('../api/commercial-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/commercial-api')>()),
  markInstallmentReadyToBill: api.mark,
  revokeInstallmentReadiness: api.revoke,
}));

function Probe() {
  const mark = useMarkReadyToBill('p1');
  const undo = useRevokeReadyToBill('p1');
  return (
    <>
      <button type="button" onClick={() => mark.mutate({ installmentId: 's1' })}>
        Mark
      </button>
      <button type="button" onClick={() => undo.mutate({ installmentId: 's1' })}>
        Undo
      </button>
    </>
  );
}

function Gate() {
  return <p>{useCanMarkReadyToBill() ? 'can' : 'cannot'}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('mark ready to bill — feedback and refresh', () => {
  it('confirms, and refreshes the schedule, Progress milestones and Finance’s portfolio ("To bill")', async () => {
    api.mark.mockResolvedValue({ installmentId: 's1', readyToBill: true, readyToBillAt: '2026-10-03T00:00:00Z' });
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderWithProviders(<Probe />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Mark' }));

    expect(await screen.findByText('Marked ready to bill — Finance will prepare the invoice')).toBeInTheDocument();
    expect(api.mark).toHaveBeenCalledWith('p1', 's1', undefined);
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([['commercial', 'p1'], ['programme', 'p1', 'milestones'], ['finance-portfolio']]));
  });

  it('confirms an undo', async () => {
    api.revoke.mockResolvedValue({ installmentId: 's1', readyToBill: false, readyToBillAt: null });
    renderWithProviders(<Probe />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Ready to bill undone')).toBeInTheDocument();
    expect(api.revoke).toHaveBeenCalledWith('p1', 's1', undefined);
  });
});

describe('useCanMarkReadyToBill', () => {
  it.each([
    [['view:contract', 'mark-ready:billing'], 'can'],
    [['view:contract', 'manage:receivable'], 'can'],
    [['mark-ready:billing'], 'cannot'],
    [['view:contract', 'manage:project'], 'cannot'],
    [['view:project', 'manage:project', 'record:progress'], 'cannot'],
  ])('%j → %s', (permissions, expected) => {
    renderWithProviders(<Gate />, { permissions });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
