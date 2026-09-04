import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyProgressReportResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useDprs: vi.fn(),
  useCreateDpr: vi.fn(),
  useDpr: vi.fn(),
  useProjectProgress: vi.fn(),
  useBoqLeaves: vi.fn(),
  useSubmitDpr: vi.fn(),
  useApproveDpr: vi.fn(),
  useReturnDpr: vi.fn(),
  useAddMeasurement: vi.fn(),
  useAttachDprEvidence: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useDprs: mocks.useDprs,
  useCreateDpr: mocks.useCreateDpr,
  useDpr: mocks.useDpr,
  useProjectProgress: mocks.useProjectProgress,
  useSubmitDpr: mocks.useSubmitDpr,
  useApproveDpr: mocks.useApproveDpr,
  useReturnDpr: mocks.useReturnDpr,
  useAddMeasurement: mocks.useAddMeasurement,
  useAttachDprEvidence: mocks.useAttachDprEvidence,
}));

vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: mocks.useBoqLeaves,
  lineLabel: (l: { code: string }) => l.code,
}));

import { DailyReportsSection } from './daily-reports-section';

const DPRS: DailyProgressReportResponse[] = [
  {
    id: 'dpr-1',
    projectId: 'proj-1',
    reportDate: '2026-08-18',
    status: 'DRAFT',
    labourCount: 12,
    preparedBy: 'cms7a5j640004tgu4y7cxy761',
    preparedByName: 'Ahmed Shirie',
  },
  {
    id: 'dpr-2',
    projectId: 'proj-1',
    reportDate: '2026-08-19',
    status: 'SUBMITTED',
    labourCount: 8,
    // No resolved name → the id shows as a graceful fallback.
    preparedBy: 'ghost-user-id',
  },
];

const loaded = <T,>(data: T) => ({
  data,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDprs.mockReturnValue(loaded(DPRS));
  mocks.useCreateDpr.mockReturnValue({ mutate: vi.fn(), isPending: false });
  // Detail-panel hooks (used once a row is opened).
  mocks.useDpr.mockReturnValue(
    loaded({ ...DPRS[0], measurements: [], attachments: [] }),
  );
  mocks.useProjectProgress.mockReturnValue(loaded([]));
  mocks.useBoqLeaves.mockReturnValue({ leaves: [] });
  mocks.useSubmitDpr.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useApproveDpr.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useReturnDpr.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useAddMeasurement.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useAttachDprEvidence.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('DailyReportsSection', () => {
  it('shows the resolved preparer name, falling back to the id when unresolved', () => {
    renderWithProviders(<DailyReportsSection projectId="proj-1" />, { withToast: true });

    expect(screen.getByText('Ahmed Shirie')).toBeInTheDocument();
    // Unresolved preparer → the raw id is still shown rather than a blank cell.
    expect(screen.getByText('ghost-user-id')).toBeInTheDocument();
  });

  it('opens the detail when the date-cell control (stretched over the row) is activated', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DailyReportsSection projectId="proj-1" />, { withToast: true });

    // The single keyboard-focusable control per row is the date button. The stretched-link overlay
    // means a click on the button (or anywhere over the row) opens the detail.
    const firstRowButton = within(screen.getAllByRole('row')[1]).getByRole('button');
    await user.click(firstRowButton);

    // Detail panel is now shown (back-to-list control appears).
    expect(await screen.findByRole('button', { name: /back to daily reports|back/i })).toBeInTheDocument();
  });

  it('keeps exactly one focusable control per data row (row is not a button)', () => {
    renderWithProviders(<DailyReportsSection projectId="proj-1" />, { withToast: true });

    const rows = screen.getAllByRole('row');
    // Header row + two data rows.
    const dataRows = rows.slice(1);
    for (const row of dataRows) {
      expect(within(row).getAllByRole('button')).toHaveLength(1);
    }
  });
});
