import { ProjectStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listProjects } from '@/features/projects/api/projects-api';
import type { Project } from '@/features/projects/types';

import { DashboardContent } from './dashboard-content';

vi.mock('@/features/projects/api/projects-api', () => ({
  listProjects: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const messages = {
  common: { loading: 'Loading...' },
  platform: {
    dashboard: {
      title: 'Dashboard',
      portfolioHeading: 'Portfolio',
      totalProjects: 'All projects',
      recentHeading: 'Recently created',
      empty: 'No projects yet.',
      emptyHint: 'Projects you create will appear here.',
      loadFailed: 'Could not load projects.',
      retry: 'Try again',
      noContractValue: 'Not set',
      viewAll: 'View all projects',
    },
    projects: {
      status: {
        DRAFT: 'Draft',
        APPROVED: 'Approved',
        MOBILIZING: 'Mobilizing',
        ACTIVE: 'Active',
        PRACTICAL_COMPLETION: 'Practical completion',
        CLOSEOUT: 'Closeout',
        CLOSED: 'Closed',
        CANCELLED: 'Cancelled',
      },
    },
  },
};

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    organizationId: 'org-1',
    code: `ACCO-${overrides.id}`,
    name: `Project ${overrides.id}`,
    nameAr: null,
    description: null,
    status: ProjectStatus.DRAFT,
    contractValue: null,
    currency: null,
    clientName: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listProjects).mockReset();
});

describe('DashboardContent', () => {
  it('announces the loading state', () => {
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {/* never settles */}));

    renderWithProviders(<DashboardContent />, { messages });

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('shows the empty state when the organization has no projects', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    renderWithProviders(<DashboardContent />, { messages });

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
  });

  it('renders real counts and the recent list', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', status: ProjectStatus.ACTIVE, name: 'Al-Baraka Tower' }),
      project({ id: '2', status: ProjectStatus.ACTIVE }),
      project({ id: '3', status: ProjectStatus.DRAFT }),
    ]);

    renderWithProviders(<DashboardContent />, { messages });

    expect(await screen.findByText('Al-Baraka Tower')).toBeInTheDocument();

    const total = screen.getByText('All projects').closest('div');
    expect(total).toHaveTextContent('3');

    // Two ACTIVE projects — one badge in the tile, one on the recent row.
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Recently created')).toBeInTheDocument();
  });

  it('formats the contract value and labels an absent one', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', contractValue: '4500000.00', currency: 'USD' }),
      project({ id: '2', contractValue: null }),
    ]);

    renderWithProviders(<DashboardContent />, { messages });

    expect(await screen.findByText('$4,500,000.00')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockRejectedValue(new Error('network'));

    renderWithProviders(<DashboardContent />, { messages });

    expect(await screen.findByText('Could not load projects.')).toBeInTheDocument();

    vi.mocked(listProjects).mockResolvedValue([project({ id: '1', name: 'Recovered' })]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Recovered')).toBeInTheDocument();
    });
  });
});
