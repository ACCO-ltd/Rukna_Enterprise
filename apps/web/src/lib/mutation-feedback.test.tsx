import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ROW_SAVED_MS, flashRowId, useRecentlySavedRows } from './mutation-feedback';
import type { MutationFeedbackMeta } from './mutation-feedback';

function Saver({ meta, result }: { meta: MutationFeedbackMeta; result: unknown }) {
  const m = useMutation({ mutationFn: async () => result, meta });
  const saved = useRecentlySavedRows();
  return (
    <>
      <button type="button" onClick={() => m.mutate()}>
        Save
      </button>
      <output aria-label="saved rows">{[...saved].join(',')}</output>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mutation feedback', () => {
  it('raises the success toast named in meta, and tints the saved row', async () => {
    renderWithProviders(
      <Saver meta={{ successToast: 'common.feedback.saved' }} result={{ id: 'row-7' }} />,
      { withToast: true },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    expect(screen.getByLabelText('saved rows')).toHaveTextContent('row-7');
  });

  it('un-tints the row once the highlight has run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(
      <Saver meta={{ successToast: 'common.feedback.saved' }} result={{ id: 'row-8' }} />,
      { withToast: true },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('saved rows')).toHaveTextContent('row-8'));

    act(() => {
      vi.advanceTimersByTime(ROW_SAVED_MS + 10);
    });

    expect(screen.getByLabelText('saved rows')).not.toHaveTextContent('row-8');
  });

  it('shows the success dialog INSTEAD of a toast for a milestone', async () => {
    renderWithProviders(
      <Saver
        meta={{ successDialog: { title: 'common.feedback.created' } }}
        result={{ id: 'row-9' }}
      />,
      { withToast: true },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Created');
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays silent for a mutation without feedback meta', async () => {
    renderWithProviders(<Saver meta={{}} result={{ id: 'row-10' }} />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();
    expect(screen.getByLabelText('saved rows')).not.toHaveTextContent('row-10');
  });
});

describe('flashRowId', () => {
  it('defaults to the result id, honours an override, and can be turned off', () => {
    expect(flashRowId({}, { id: 'a' }, undefined)).toBe('a');
    expect(flashRowId({}, 'no-id', undefined)).toBeNull();
    expect(flashRowId({ flashRow: false }, { id: 'a' }, undefined)).toBeNull();
    expect(flashRowId({ flashRow: (_d, v) => (v as { lineId: string }).lineId }, {}, { lineId: 'l1' })).toBe('l1');
  });
});
