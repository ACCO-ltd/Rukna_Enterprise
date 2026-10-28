import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalItem } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { getApprovalsInbox } from '../api';

import { ApprovalsInbox } from './approvals-inbox';

vi.mock('../api', () => ({ getApprovalsInbox: vi.fn() }));

const DAY = 86_400_000;
const item = (patch: Partial<ApprovalItem>): ApprovalItem => ({
  kind: 'JOURNAL',
  id: 'j1',
  title: 'JV-000041',
  detail: 'October site security accrual',
  amount: '1250.00',
  currencyCode: 'USD',
  waitingSince: new Date(Date.now() - 5 * DAY).toISOString(),
  requestedByName: 'Amina Yusuf',
  projectId: null,
  projectName: null,
  transactionType: null,
  ...patch,
});

describe('ApprovalsInbox (Step 3, ADR-049)', () => {
  it('lists what waits on the reader, with who sent it, how long it has waited and a link to decide', async () => {
    vi.mocked(getApprovalsInbox).mockResolvedValue({
      count: 2,
      items: [
        item({}),
        item({ kind: 'MATERIAL_REQUEST', id: 'mr1', title: 'MR-2026-0007', detail: 'Cement', amount: null, currencyCode: null, waitingSince: new Date().toISOString(), projectId: 'p1', projectName: 'Reservoir Works' }),
      ],
    });
    renderWithProviders(<ApprovalsInbox />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('JV-000041')).toBeInTheDocument();
    expect(within(table).getAllByText('Amina Yusuf')).not.toHaveLength(0);
    expect(within(table).getByText('5 days')).toBeInTheDocument();
    expect(within(table).getByText('$1,250.00')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /JV-000041/ })).toHaveAttribute('href', '/finance/accounting/journals/j1');
    expect(screen.getByText('2 items wait on you · 1 waiting more than 3 days')).toBeInTheDocument();
  });

  it('narrows to one area with the tabs, each carrying its count', async () => {
    const user = userEvent.setup();
    vi.mocked(getApprovalsInbox).mockResolvedValue({
      count: 2,
      items: [item({}), item({ kind: 'PROGRESS_REPORT', id: 'd1', title: '2026-10-27', detail: null, amount: null, projectId: 'p1', projectName: 'Reservoir Works' })],
    });
    renderWithProviders(<ApprovalsInbox />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: /Site/ }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText('JV-000041')).toBeNull();
    expect(within(table).getByText('2026-10-27')).toBeInTheDocument();
  });

  it('says plainly when nothing waits on the reader', async () => {
    vi.mocked(getApprovalsInbox).mockResolvedValue({ count: 0, items: [] });
    renderWithProviders(<ApprovalsInbox />);
    expect(await screen.findAllByText('Nothing waits on you')).not.toHaveLength(0);
  });

  it('offers Try again when the inbox cannot load', async () => {
    vi.mocked(getApprovalsInbox).mockRejectedValue(new Error('down'));
    renderWithProviders(<ApprovalsInbox />);
    expect(await screen.findByText('Your approvals could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
