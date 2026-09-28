import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: '/projects/p1/progress/today',
  useDprs: vi.fn(),
  useProgressSetup: vi.fn(),
  useMilestones: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock('../hooks/use-progress', () => ({ useDprs: mocks.useDprs }));
vi.mock('../hooks/use-progress-setup', () => ({ useProgressSetup: mocks.useProgressSetup }));
vi.mock('@/features/programme/hooks/use-programme', () => ({ useMilestones: mocks.useMilestones }));

import { ProgressLanding, ProgressShell, ProgressViewGate, reviewBadgeCount } from './progress-shell';

const FACTS = {
  hasBoqBaseline: true,
  packageCount: 2,
  measurablePackageCount: 2,
  unallocatedPackageCodes: [] as string[],
  weightsComplete: false,
  weightsPercent: 85,
};
const setupComplete = { isPending: false, isError: false, facts: { ...FACTS, weightsComplete: true }, gap: null };
const setupMissingPackages = { isPending: false, isError: false, facts: null, gap: 'workPackages' };
const setupWeightsShort = { isPending: false, isError: false, facts: FACTS, gap: 'weights' };
const setupUnallocated = {
  isPending: false,
  isError: false,
  facts: { ...FACTS, unallocatedPackageCodes: ['WP-07'] },
  gap: 'allocation',
};

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.useDprs.mockReturnValue({
    data: [
      { id: 'd1', status: 'SUBMITTED', preparedBy: 'someone' },
      { id: 'd2', status: 'SUBMITTED', preparedBy: 'someone' },
      // The viewer's own submitted report is not theirs to review, so it is not counted.
      { id: 'd4', status: 'SUBMITTED', preparedBy: 'test-user' },
      { id: 'd3', status: 'APPROVED', preparedBy: 'someone' },
    ],
  });
  mocks.useProgressSetup.mockReturnValue(setupComplete);
  mocks.useMilestones.mockReturnValue({ data: [{ id: 'm1', readyToVerify: true }, { id: 'm2', readyToVerify: false }] });
});

describe('ProgressShell — views by permission', () => {
  it('shows a PM all four views, with the awaiting-review count on Review', () => {
    renderWithProviders(
      <ProgressShell projectId="p1">
        <p>content</p>
      </ProgressShell>,
      { permissions: ['record:progress', 'approve:progress', 'manage:project'] },
    );

    const nav = screen.getByRole('navigation', { name: 'Progress views' });
    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/projects/p1/progress/today',
      '/projects/p1/progress/review',
      '/projects/p1/progress/performance',
      '/projects/p1/progress/setup',
    ]);
    // 2 reports not mine + 1 milestone ready to verify.
    expect(screen.getByRole('link', { name: 'Review, 3 waiting' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  });

  it('removes (does not disable) the views a site engineer cannot use', () => {
    renderWithProviders(
      <ProgressShell projectId="p1">
        <p>content</p>
      </ProgressShell>,
      { permissions: ['record:progress'] },
    );

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Performance' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Review/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plan & setup' })).not.toBeInTheDocument();
  });

  it('carries no primary action in the tab heading', () => {
    renderWithProviders(
      <ProgressShell projectId="p1">
        <p>content</p>
      </ProgressShell>,
      { permissions: ['record:progress', 'approve:progress', 'manage:project'] },
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ProgressLanding', () => {
  it('keeps a recording manager on Today when only weights are short', async () => {
    mocks.useProgressSetup.mockReturnValue(setupWeightsShort);
    renderWithProviders(<ProgressLanding projectId="p1" />, {
      permissions: ['record:progress', 'approve:progress', 'manage:project'],
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress/today'));
  });

  it('sends a manager who does not record to setup for a soft gap', async () => {
    mocks.useProgressSetup.mockReturnValue(setupWeightsShort);
    renderWithProviders(<ProgressLanding projectId="p1" />, { permissions: ['manage:project'] });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress/setup'));
  });

  it('sends a setup manager to Plan & setup while setup is incomplete', async () => {
    mocks.useProgressSetup.mockReturnValue(setupMissingPackages);
    renderWithProviders(<ProgressLanding projectId="p1" />, {
      permissions: ['record:progress', 'approve:progress', 'manage:project'],
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress/setup'));
  });

  it('waits for the setup answer before redirecting a manager', () => {
    mocks.useProgressSetup.mockReturnValue({ isPending: true, isError: false, facts: null, gap: undefined });
    renderWithProviders(<ProgressLanding projectId="p1" />, { permissions: ['manage:project'] });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('sends a site engineer to Today', async () => {
    mocks.useProgressSetup.mockReturnValue(setupMissingPackages);
    renderWithProviders(<ProgressLanding projectId="p1" />, { permissions: ['record:progress'] });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress/today'));
  });

  it('sends a reader with no progress permissions to Performance', async () => {
    renderWithProviders(<ProgressLanding projectId="p1" />, { permissions: ['view:project'] });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress/performance'));
  });
});

describe('ProgressViewGate', () => {
  it('redirects away from a view the reader cannot use, rendering nothing of it', async () => {
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="setup">
        <p>setup body</p>
      </ProgressViewGate>,
      { permissions: ['record:progress'] },
    );
    expect(screen.queryByText('setup body')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects/p1/progress'));
  });

  it('renders one empty state with "Continue setup" for a manager while setup is incomplete', () => {
    mocks.useProgressSetup.mockReturnValue(setupMissingPackages);
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="today">
        <p>today body</p>
      </ProgressViewGate>,
      { permissions: ['record:progress', 'manage:project'] },
    );

    expect(screen.queryByText('today body')).not.toBeInTheDocument();
    expect(screen.getByText("Progress isn't set up yet")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/projects/p1/progress/setup',
    );
  });

  it('explains the gap in words, without an action, to someone who cannot finish setup', () => {
    mocks.useProgressSetup.mockReturnValue(setupMissingPackages);
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="performance">
        <p>performance body</p>
      </ProgressViewGate>,
      { permissions: ['record:progress'] },
    );

    expect(screen.getByText(/The project manager finishes this in Plan & setup/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue setup' })).not.toBeInTheDocument();
  });

  it('always renders Plan & setup for a manager, even while setup is incomplete', () => {
    mocks.useProgressSetup.mockReturnValue(setupMissingPackages);
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="setup">
        <p>setup body</p>
      </ProgressViewGate>,
      { permissions: ['manage:project'] },
    );
    expect(screen.getByText('setup body')).toBeInTheDocument();
  });

  it('does not block Today or Review for a soft gap', () => {
    mocks.useProgressSetup.mockReturnValue(setupUnallocated);
    renderWithProviders(
      <>
        <ProgressViewGate projectId="p1" view="today">
          <p>today body</p>
        </ProgressViewGate>
        <ProgressViewGate projectId="p1" view="review">
          <p>review body</p>
        </ProgressViewGate>
      </>,
      { permissions: ['record:progress', 'approve:progress'] },
    );
    expect(screen.getByText('today body')).toBeInTheDocument();
    expect(screen.getByText('review body')).toBeInTheDocument();
    expect(screen.queryByText(/provisional/)).not.toBeInTheDocument();
  });

  it('shows Performance with one provisional notice for a soft gap, and Continue setup for a manager', () => {
    mocks.useProgressSetup.mockReturnValue(setupWeightsShort);
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="performance">
        <p>performance body</p>
      </ProgressViewGate>,
      { permissions: ['manage:project'] },
    );
    expect(screen.getByText('performance body')).toBeInTheDocument();
    expect(
      screen.getByText('Weights total 85% — performance figures are provisional until they reach 100%.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue setup' })).toBeInTheDocument();
  });

  it('names the unallocated package in the Performance notice, without an action for non-managers', () => {
    mocks.useProgressSetup.mockReturnValue(setupUnallocated);
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="performance">
        <p>performance body</p>
      </ProgressViewGate>,
      { permissions: ['record:progress'] },
    );
    expect(screen.getByText(/WP-07 has no BOQ items/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue setup' })).not.toBeInTheDocument();
  });

  it('hard-gates when every package is schedule-only, and says so', () => {
    mocks.useProgressSetup.mockReturnValue({ isPending: false, isError: false, facts: null, gap: 'scheduleOnly' });
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="today">
        <p>today body</p>
      </ProgressViewGate>,
      { permissions: ['record:progress', 'manage:project'] },
    );
    expect(screen.queryByText('today body')).not.toBeInTheDocument();
    expect(screen.getByText(/Every work package is a schedule-only phase/)).toBeInTheDocument();
  });

  it('renders the view once setup is complete', () => {
    renderWithProviders(
      <ProgressViewGate projectId="p1" view="review">
        <p>review body</p>
      </ProgressViewGate>,
      { permissions: ['approve:progress'] },
    );
    expect(screen.getByText('review body')).toBeInTheDocument();
  });
});

describe('reviewBadgeCount', () => {
  const reports = [
    { status: 'SUBMITTED', preparedBy: 'other' },
    { status: 'SUBMITTED', preparedBy: 'me' },
    { status: 'APPROVED', preparedBy: 'other' },
  ] as never[];
  const milestones = [{ readyToVerify: true }, { readyToVerify: true }, { readyToVerify: false }] as never[];

  it('counts only what the reader can act on', () => {
    const base = { reports, milestones, userId: 'me' };
    expect(reviewBadgeCount({ ...base, access: { canRecord: false, canApprove: true, canManage: true } })).toBe(3);
    expect(reviewBadgeCount({ ...base, access: { canRecord: false, canApprove: true, canManage: false } })).toBe(1);
    expect(reviewBadgeCount({ ...base, access: { canRecord: false, canApprove: false, canManage: true } })).toBe(2);
    expect(reviewBadgeCount({ ...base, access: { canRecord: true, canApprove: false, canManage: false } })).toBe(0);
  });
});
