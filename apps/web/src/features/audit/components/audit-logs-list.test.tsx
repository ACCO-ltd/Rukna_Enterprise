import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogPage } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Administration → Audit logs: a page of the trail from the server, each entry naming the
 * person; the search goes to the API; export reads every page of the filtered trail.
 */
vi.mock('../api/audit-api', () => ({ listAuditLogs: vi.fn() }));
const exportCsv = vi.hoisted(() => vi.fn());
vi.mock('@/features/accounting/lib/export-csv', async (original) => ({ ...(await original<object>()), exportCsv }));

import { listAuditLogs } from '../api/audit-api';
import { AuditLogsList } from './audit-logs-list';

const PAGE: AuditLogPage = {
  items: [
    {
      id: 'a1',
      createdAt: '2026-10-28T09:15:00.000Z',
      action: 'REJECT',
      resource: 'supplier-bill',
      resourceId: 'bill-9',
      reason: 'Wrong supplier',
      ipAddress: null,
      user: { id: 'u1', name: 'Faadumo Warsame', email: 'faadumo@example.com' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  facets: { resources: ['supplier-bill'], users: [{ id: 'u1', name: 'Faadumo Warsame' }] },
};

beforeEach(() => {
  vi.mocked(listAuditLogs).mockReset().mockResolvedValue(PAGE);
  exportCsv.mockReset();
});

describe('AuditLogsList', () => {
  it('names the person, shows the reason, and counts the trail', async () => {
    renderWithProviders(<AuditLogsList />, { withToast: true });
    const grid = within(await screen.findByRole('table'));
    expect(grid.getByText('Faadumo Warsame')).toBeInTheDocument();
    expect(grid.getByText('Reason: Wrong supplier')).toBeInTheDocument();
    expect(screen.getAllByText('1 entry').length).toBeGreaterThan(0);
    expect(listAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }));
  });

  it('sends the search to the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogsList />, { withToast: true });
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox'), 'wrong');
    await waitFor(() => expect(listAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'wrong' })));
  });

  it('exports the filtered trail, not just the page on screen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogsList />, { withToast: true });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(1));
    expect(listAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
    const [, headers, rows] = exportCsv.mock.calls[0]!;
    expect(headers).toContain('Reason');
    expect(rows[0]).toEqual(expect.arrayContaining(['Faadumo Warsame', 'REJECT', 'Wrong supplier', 'bill-9']));
  });
});
