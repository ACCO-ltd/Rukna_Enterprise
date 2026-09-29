import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyProgressReportResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { localIsoDate } from '../domain/my-reports';

const mocks = vi.hoisted(() => ({
  useDprs: vi.fn(),
  useCreateDpr: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({ useDprs: mocks.useDprs, useCreateDpr: mocks.useCreateDpr }));
// The sheet has its own test; here it only reports which report it was asked to open.
vi.mock('./dpr-entry-dialog', () => ({
  DprEntryDialog: ({ dprId }: { dprId: string | null }) => (dprId ? <p>dialog open: {dprId}</p> : null),
}));

import { TodaySection } from './today-section';

const TODAY = localIsoDate();
const ME = 'test-user';

const dpr = (
  id: string,
  reportDate: string,
  status: DailyProgressReportResponse['status'],
  extra: Partial<DailyProgressReportResponse> = {},
): DailyProgressReportResponse => ({ id, projectId: 'p1', reportDate, status, preparedBy: ME, workPackages: [], ...extra });

function load(reports: DailyProgressReportResponse[]) {
  mocks.useDprs.mockReturnValue({ data: reports, isPending: false, isError: false, refetch: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateDpr.mockReturnValue({ mutate: mocks.create, isPending: false });
});

const SE = { permissions: ['record:progress'] };

describe('TodaySection', () => {
  it('with no report today: "Not started" and "Start today\'s report" as the one primary, which creates it', async () => {
    const user = userEvent.setup();
    load([dpr('old', '2026-09-01', 'APPROVED', { approvedBy: 'pm-1' })]);
    mocks.create.mockImplementation((_body, opts) => opts.onSuccess({ id: 'new-dpr' }));
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    expect(screen.getByText('Not started')).toBeInTheDocument();
    const primary = screen.getByRole('button', { name: "Start today's report" });
    expect(primary).toHaveClass('bg-brand-ink');
    await user.click(primary);
    expect(mocks.create).toHaveBeenCalledWith({ reportDate: TODAY }, expect.anything());
    expect(screen.getByText('dialog open: new-dpr')).toBeInTheDocument();
  });

  it("offers \"Continue today's report\" for today's draft, and opens it without creating another", async () => {
    const user = userEvent.setup();
    load([dpr('today-draft', TODAY, 'DRAFT')]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    await user.click(screen.getByRole('button', { name: "Continue today's report" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByText('dialog open: today-draft')).toBeInTheDocument();
  });

  it('offers "Open" once today\'s report is submitted, with its status pill in the context bar', () => {
    load([dpr('today-sub', TODAY, 'SUBMITTED')]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    const context = screen.getByRole('region', { name: /^Today ·/ });
    expect(within(context).getByText('Submitted')).toBeInTheDocument();
    expect(within(context).getByText('1 report')).toBeInTheDocument();
  });

  it('shows one attention notice per returned report of mine, with the reason and "Fix and resubmit"', async () => {
    const user = userEvent.setup();
    load([
      dpr('r1', '2026-09-20', 'RETURNED', {
        returnReason: 'Slab quantity is over the pour record',
        returnedByName: 'Amina Yusuf',
      }),
      dpr('r2', '2026-09-21', 'RETURNED'),
      dpr('other', '2026-09-22', 'RETURNED', { preparedBy: 'someone-else', returnReason: 'Not mine' }),
    ]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    expect(screen.getAllByRole('button', { name: 'Fix and resubmit' })).toHaveLength(2);
    expect(screen.getByText('Amina Yusuf: “Slab quantity is over the pour record”')).toBeInTheDocument();
    expect(screen.getByText("The reviewer didn't give a reason.")).toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Fix and resubmit' })[0]!);
    expect(screen.getByText('dialog open: r2')).toBeInTheDocument();
  });

  it('lists my reports with anything needing my action first, their work packages and the reviewer by name', () => {
    load([
      dpr('approved', '2026-09-25', 'APPROVED', {
        approvedBy: 'pm-1',
        reviewedByName: 'Amina Yusuf',
        workPackages: [{ id: 'wp2', code: 'WP-02', name: 'Frame' }],
      }),
      dpr('draft', '2026-09-10', 'DRAFT'),
      dpr('theirs', '2026-09-26', 'DRAFT', { preparedBy: 'someone-else' }),
    ]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    const grid = screen.getByRole('table');
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Amina Yusuf')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('WP-02 Frame')).toBeInTheDocument();
  });

  it('starts a report for another day from the kebab', async () => {
    const user = userEvent.setup();
    load([]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);

    await user.click(screen.getByRole('button', { name: 'More report actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Report for another day…' }));
    expect(await screen.findByRole('dialog', { name: 'Report for another day' })).toBeInTheDocument();
  });

  it('shows an empty state instead of an empty grid when I have no reports', () => {
    load([]);
    renderWithProviders(<TodaySection projectId="p1" />, SE);
    expect(screen.getByText("You haven't recorded any daily reports yet.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
