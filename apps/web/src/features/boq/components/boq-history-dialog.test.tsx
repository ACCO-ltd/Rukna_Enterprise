import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoqTimelineResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { BoqHistoryDialog } from './boq-history-dialog';

const DATA: BoqTimelineResponse = {
  projectId: 'p1',
  entries: [
    {
      id: 'e1',
      kind: 'CHANGE_EVENT',
      label: 'Changed the rate of 2.1',
      versionId: 'v1',
      actorUserId: 'u1',
      actorName: 'Abdi Yusuf',
      occurredAt: '2026-09-20T09:12:00.000Z',
      amount: '1200.00',
    },
    {
      id: 'e2',
      kind: 'VARIATION_SNAPSHOT',
      label: 'VO-003 adopted',
      versionId: 'v2',
      actorUserId: null,
      actorName: null,
      occurredAt: '2026-09-18T09:12:00.000Z',
      amount: null,
    },
  ],
};

function renderDialog(overrides: Partial<Parameters<typeof BoqHistoryDialog>[0]> = {}) {
  const onClose = vi.fn();
  renderWithProviders(
    <BoqHistoryDialog
      data={DATA}
      currency="USD"
      canViewMargin
      isPending={false}
      isError={false}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

describe('BoqHistoryDialog', () => {
  it('reads each entry as a sentence, newest first, with the amount when visible', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'BOQ history' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Abdi Yusuf changed the rate of 2.1 $1,200.00');
    // A reference keeps its capitals; an unknown actor is named honestly.
    expect(items[1]).toHaveTextContent('Someone VO-003 adopted');
  });

  it('withholds amounts from a reader without margin visibility', () => {
    renderDialog({ canViewMargin: false });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('shows the empty and failed states', () => {
    renderDialog({ data: { projectId: 'p1', entries: [] } });
    expect(screen.getByText('Nothing has happened on this BOQ yet.')).toBeInTheDocument();
  });

  it('says when it could not load', () => {
    renderDialog({ data: undefined, isError: true });
    expect(screen.getByText('Could not load the history.')).toBeInTheDocument();
  });

  it('closes from its footer', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
