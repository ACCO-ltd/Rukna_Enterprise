import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({
  useDownloadMasterSchedule: vi.fn(),
  useProject: vi.fn(),
}));

vi.mock('../hooks/use-programme', () => ({
  useDownloadMasterSchedule: mocks.useDownloadMasterSchedule,
}));
vi.mock('@/features/projects/hooks/use-project', () => ({ useProject: mocks.useProject }));

import { DownloadMasterScheduleButton } from './download-master-schedule-button';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProject.mockReturnValue(loaded({ code: 'ACCO-2026-001' }));
  mocks.useDownloadMasterSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('DownloadMasterScheduleButton', () => {
  it('renders the download action for a user who can view the project', () => {
    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
  });

  it('is hidden from a user without the project-view permission', () => {
    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: [],
      withToast: true,
    });

    expect(screen.queryByRole('button', { name: /download pdf/i })).not.toBeInTheDocument();
  });

  it('triggers the download with the project code on click', () => {
    const mutate = vi.fn();
    mocks.useDownloadMasterSchedule.mockReturnValue({ mutate, isPending: false });

    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    screen.getByRole('button', { name: /download pdf/i }).click();

    expect(mutate).toHaveBeenCalledTimes(1);
    // Fallback filename code is passed through so the file is named even if the header is hidden.
    expect(mutate.mock.calls[0]![0]).toBe('ACCO-2026-001');
  });

  it('shows a generating state and disables the button while the PDF is composed', () => {
    mocks.useDownloadMasterSchedule.mockReturnValue({ mutate: vi.fn(), isPending: true });

    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    const button = screen.getByRole('button', { name: /generating/i });
    expect(button).toBeDisabled();
  });

  it('is disabled until the project code is known (so a download never gets an empty name)', () => {
    mocks.useProject.mockReturnValue(loaded(undefined));

    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    expect(screen.getByRole('button', { name: /download pdf/i })).toBeDisabled();
  });

  it('surfaces an error toast when generation fails', async () => {
    // Drive the mutation's onError so the component's error branch runs.
    const mutate = vi.fn((_code: string, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new ApiError(500, 'boom'));
    });
    mocks.useDownloadMasterSchedule.mockReturnValue({ mutate, isPending: false });

    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    act(() => {
      screen.getByRole('button', { name: /download pdf/i }).click();
    });

    expect(await screen.findByText(/could not generate the master schedule pdf/i)).toBeInTheDocument();
  });

  it('does not toast on a 401 (the api layer redirects to login instead)', () => {
    const mutate = vi.fn((_code: string, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new ApiError(401, 'Session expired', 'SESSION_EXPIRED'));
    });
    mocks.useDownloadMasterSchedule.mockReturnValue({ mutate, isPending: false });

    renderWithProviders(<DownloadMasterScheduleButton projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    act(() => {
      screen.getByRole('button', { name: /download pdf/i }).click();
    });

    expect(screen.queryByText(/could not generate/i)).not.toBeInTheDocument();
  });
});
