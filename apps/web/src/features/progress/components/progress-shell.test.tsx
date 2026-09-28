import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: '/projects/p1/progress/today',
  useDprs: vi.fn(),
  useProgressSetup: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock('../hooks/use-progress', () => ({ useDprs: mocks.useDprs }));
vi.mock('../hooks/use-progress-setup', () => ({ useProgressSetup: mocks.useProgressSetup }));

import { ProgressLanding, ProgressShell, ProgressViewGate } from './progress-shell';

const setupComplete = { isPending: false, isError: false, facts: null, gap: null };
const setupMissingPackages = { isPending: false, isError: false, facts: null, gap: 'workPackages' };

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.useDprs.mockReturnValue({
    data: [
      { id: 'd1', status: 'SUBMITTED' },
      { id: 'd2', status: 'SUBMITTED' },
      { id: 'd3', status: 'APPROVED' },
    ],
  });
  mocks.useProgressSetup.mockReturnValue(setupComplete);
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
    expect(screen.getByRole('link', { name: 'Review 2' })).toBeInTheDocument();
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
