import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyProgressReportResponse, ProgrammeMilestoneResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useDprs: vi.fn(),
  useDpr: vi.fn(),
  useProjectProgress: vi.fn(),
  useApproveDpr: vi.fn(),
  useReturnDpr: vi.fn(),
  useMilestones: vi.fn(),
  useVerifyMilestone: vi.fn(),
  approve: vi.fn(),
  returnDpr: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useDprs: mocks.useDprs,
  useDpr: mocks.useDpr,
  useProjectProgress: mocks.useProjectProgress,
  useApproveDpr: mocks.useApproveDpr,
  useReturnDpr: mocks.useReturnDpr,
  progressKeys: {
    report: (id: string) => ['progress-report', id],
    reports: (projectId: string) => ['progress', projectId, 'reports'],
  },
}));
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({
    isPending: false,
    hasBaseline: true,
    leaves: [{ id: 'n1', code: '2.2', description: 'RC C30 slab', path: [], unit: 'm3', quantity: '40' }],
  }),
  lineLabel: (l: { code: string; description: string }) => `${l.code} ${l.description}`,
}));
vi.mock('@/features/programme/hooks/use-programme', () => ({
  useMilestones: mocks.useMilestones,
  useVerifyMilestone: mocks.useVerifyMilestone,
}));
vi.mock('./dpr-detail', () => ({ DprEvidence: () => <p>evidence</p> }));

import { ReviewSection, reviewQueue } from './review-section';

const report = (
  id: string,
  reportDate: string,
  extra: Partial<DailyProgressReportResponse> = {},
): DailyProgressReportResponse => ({
  id,
  projectId: 'p1',
  reportDate,
  status: 'SUBMITTED',
  preparedBy: 'se-1',
  preparedByName: 'Omar Ali',
  workPackages: [{ id: 'wp2', code: 'WP-02', name: 'Frame' }],
  ...extra,
});

const milestone = (extra: Partial<ProgrammeMilestoneResponse> = {}): ProgrammeMilestoneResponse => ({
  id: 'm1',
  projectId: 'p1',
  code: 'M2',
  name: 'Frame complete',
  status: 'PLANNED',
  baselineDate: '2026-12-01',
  forecastDate: null,
  actualDate: null,
  sortOrder: 1,
  contractDeliverableId: null,
  verifiedBy: null,
  verifiedAt: null,
  releases: [],
  workPackages: [{ id: 'wp1', code: 'WP-01', name: 'Frame', percentComplete: 100 }],
  readyToVerify: true,
  ...extra,
});

let reports: DailyProgressReportResponse[];

beforeEach(() => {
  vi.clearAllMocks();
  reports = [report('a', '2026-09-26'), report('b', '2026-09-27', { preparedByName: 'Hodan Nur' })];
  mocks.useDprs.mockImplementation(() => ({ data: reports, isPending: false, isError: false }));
  mocks.useDpr.mockImplementation((id: string) => ({
    isPending: false,
    isError: false,
    data: {
      ...reports.find((r) => r.id === id),
      measurements: [{ id: 'm', dprId: id, boqNodeId: 'n1', quantity: '4' }],
      attachments: [],
      labourRows: [{ id: 'l', trade: 'Mason', headcount: 6, hours: '8' }],
      equipmentRows: [],
      observations: [],
      narrative: 'Slab B poured.',
    },
  }));
  mocks.useProjectProgress.mockReturnValue({ data: [{ boqNodeId: 'n1', measurableQuantity: '40', verifiedToDate: '16' }] });
  mocks.useApproveDpr.mockReturnValue({ mutate: mocks.approve, isPending: false });
  mocks.useReturnDpr.mockReturnValue({ mutate: mocks.returnDpr, isPending: false, isError: false });
  mocks.useMilestones.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useVerifyMilestone.mockReturnValue({ mutate: mocks.verify, isPending: false, isError: false });
});

const REVIEWER = { permissions: ['approve:progress'] };
const MANAGER = { permissions: ['manage:project'] };

describe('reviewQueue', () => {
  it('keeps submitted reports that are not mine, oldest first', () => {
    const queue = reviewQueue(
      [
        report('new', '2026-09-27'),
        report('mine', '2026-09-20', { preparedBy: 'me' }),
        report('old', '2026-09-25'),
        report('draft', '2026-09-24', { status: 'DRAFT' }),
      ],
      'me',
    );
    expect(queue.map((r) => r.id)).toEqual(['old', 'new']);
  });
});

describe('ReviewSection — reports', () => {
  it('shows the queue with date and "preparer · WP codes", and the first report selected', () => {
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);

    const options = within(screen.getByRole('listbox', { name: 'Reports waiting for review' })).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText('Omar Ali · WP-02')).toBeInTheDocument();
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // Quantities: today 4, to date 16 + 4 = 20, BOQ 40, 50% done.
    const table = screen.getByRole('table');
    expect(within(table).getByText('4.000 m3')).toBeInTheDocument();
    expect(within(table).getByText('20.000 m3')).toBeInTheDocument();
    expect(within(table).getByText('40.000 m3')).toBeInTheDocument();
    expect(within(table).getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Slab B poured.')).toBeInTheDocument();
    expect(
      screen.getByText('Approving counts these quantities as verified progress and locks the report.'),
    ).toBeInTheDocument();
  });

  it('approves, then selects the next report and shows a success notice', async () => {
    const user = userEvent.setup();
    mocks.approve.mockImplementation((_v, opts) => {
      reports = reports.filter((r) => r.id !== 'a');
      opts.onSuccess();
    });
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText(/Report for .* approved/)).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(options[0]!).getByText('Hodan Nur · WP-02')).toBeInTheDocument();
  });

  it('returns with a required reason, then moves on', async () => {
    const user = userEvent.setup();
    mocks.returnDpr.mockImplementation((reason, opts) => {
      expect(reason).toBe('Photos missing');
      reports = reports.filter((r) => r.id !== 'a');
      opts.onSuccess();
    });
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);

    await user.click(screen.getByRole('button', { name: 'Return…' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Photos missing');
    await user.click(within(dialog).getByRole('button', { name: 'Return report' }));

    expect(mocks.returnDpr).toHaveBeenCalled();
    expect(screen.getByText(/returned to Omar Ali/)).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('shows a 409 "report changed" plainly', async () => {
    const user = userEvent.setup();
    mocks.approve.mockImplementation((_v, opts) =>
      opts.onError(new ApiError(409, 'This report changed — reload it and try again.', 'DPR_CHANGED')),
    );
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      screen.getByText(/was changed by someone else — the queue has been refreshed\. This report changed — reload it and try again\./),
    ).toBeInTheDocument();
  });

  it('keeps my own submitted reports out of the queue and says why', () => {
    reports = [report('mine', '2026-09-26', { preparedBy: 'test-user' })];
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);

    expect(screen.getByText('No reports waiting for review')).toBeInTheDocument();
    expect(screen.getByText('1 of your reports is waiting for another reviewer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('ReviewSection — milestones ready to verify', () => {
  it('lists only ready milestones and names what verifying releases, with the amount when known', async () => {
    const user = userEvent.setup();
    mocks.useMilestones.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        milestone({
          releases: [
            { installmentId: 'i1', name: 'Frame stage', percentage: '0.3', triggerType: 'MILESTONE', amount: '30000.00', currency: 'USD', invoiced: false },
          ],
        }),
        milestone({ id: 'm2', code: 'M3', name: 'Roof', readyToVerify: false }),
      ],
    });
    renderWithProviders(<ReviewSection projectId="p1" />, MANAGER);

    expect(screen.queryByText('Roof')).not.toBeInTheDocument();
    expect(
      screen.getByText(/WP-01 verified at 100%\. Verifying releases Frame stage \(\$30,000\.00\) for billing\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify Frame complete' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Frame stage ($30,000.00) becomes billable and Finance can raise the invoice. You confirm the work is complete on site.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Verify milestone' }));
    expect(mocks.verify).toHaveBeenCalledWith(
      { milestoneId: 'm1', actualDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      expect.anything(),
    );
  });

  it('names the installment without an amount when the server hides it', async () => {
    const user = userEvent.setup();
    mocks.useMilestones.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        milestone({
          releases: [
            { installmentId: 'i1', name: 'Frame stage', percentage: '0.3', triggerType: 'MILESTONE', amount: null, currency: 'USD', invoiced: false },
          ],
        }),
      ],
    });
    renderWithProviders(<ReviewSection projectId="p1" />, MANAGER);

    expect(screen.getByText(/Verifying releases Frame stage for billing\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify Frame complete' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Frame stage becomes billable and Finance can raise the invoice. You confirm the work is complete on site.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('keeps every other PLANNED milestone reachable, collapsed, with the reason it is not flagged ready', async () => {
    const user = userEvent.setup();
    mocks.useMilestones.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        milestone({ id: 'm-none', code: 'M1', name: 'Mobilisation', readyToVerify: false, workPackages: [] }),
        milestone({
          id: 'm-part',
          code: 'M3',
          name: 'Roof',
          readyToVerify: false,
          workPackages: [
            { id: 'wp1', code: 'WP-01', name: 'Frame', percentComplete: 100 },
            { id: 'wp2', code: 'WP-02', name: 'Roof', percentComplete: 60 },
          ],
          releases: [
            { installmentId: 'i', name: 'Roof stage', percentage: '0.2', triggerType: 'MILESTONE', amount: null, currency: 'USD', invoiced: false },
          ],
        }),
        milestone({ id: 'm-done', code: 'M0', name: 'Site handover', status: 'VERIFIED', readyToVerify: false }),
      ],
    });
    renderWithProviders(<ReviewSection projectId="p1" />, MANAGER);

    expect(screen.getByText('No milestones are ready to verify.')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /2 other planned milestones/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Roof')).not.toBeInTheDocument();
    // A verified milestone is never offered again.
    expect(screen.queryByText('Site handover')).not.toBeInTheDocument();

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Verify Mobilisation' }));
    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('No work packages linked — you confirm on site that the stage is complete.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Verify Roof' }));
    dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Roof stage becomes billable and Finance can raise the invoice. WP-02 is at 60% verified — you confirm the work is complete on site anyway.',
      ),
    ).toBeInTheDocument();
  });

  it('shows milestones only to managers, and reports only to reviewers', () => {
    mocks.useMilestones.mockReturnValue({ isPending: false, isError: false, data: [milestone()] });
    renderWithProviders(<ReviewSection projectId="p1" />, REVIEWER);
    expect(screen.queryByText('Milestones ready to verify')).not.toBeInTheDocument();
    expect(screen.getByText('Reports to review')).toBeInTheDocument();
  });
});
