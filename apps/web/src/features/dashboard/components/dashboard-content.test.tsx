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

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    organizationId: 'org-1',
    code: `ACCO-${overrides.id}`,
    name: `Project ${overrides.id}`,
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

    renderWithProviders(<DashboardContent />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('shows the empty state when the organization has no projects', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
  });

  it('renders KPI cards with correct counts', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', status: ProjectStatus.ACTIVE }),
      project({ id: '2', status: ProjectStatus.ACTIVE }),
      project({ id: '3', status: ProjectStatus.DRAFT }),
      project({ id: '4', status: ProjectStatus.DRAFT }),
      project({ id: '5', status: ProjectStatus.CLOSED }),
    ]);

    renderWithProviders(<DashboardContent />);

    await screen.findByText('All projects');
    expect(screen.getByText('All projects').closest('a, div')).toHaveTextContent('5');

    // "On site" = ACTIVE(2) = 2
    expect(screen.getByText('On site').closest('a, div')).toHaveTextContent('2');

    // "Pending" = DRAFT(2)
    expect(screen.getByText('Pending').closest('a, div')).toHaveTextContent('2');

    // "Finished" = CLOSED(1)
    expect(screen.getByText('Finished').closest('a, div')).toHaveTextContent('1');
  });

  it('renders the recent projects table and heading', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', status: ProjectStatus.ACTIVE, name: 'Al-Baraka Tower' }),
    ]);

    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('Al-Baraka Tower')).toBeInTheDocument();
    expect(screen.getByText('Recently created')).toBeInTheDocument();
  });

  it('formats the contract value and labels an absent one', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', contractValue: '4500000.00', currency: 'USD' }),
      project({ id: '2', contractValue: null }),
    ]);

    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('$4,500,000.00')).toBeInTheDocument();
    // At least one "Not set" appears (null contractValue column)
    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1);
  });

  it('offers a retry when the request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockRejectedValue(new Error('network'));

    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('Could not load projects.')).toBeInTheDocument();

    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Recovered', status: ProjectStatus.DRAFT }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Recovered')).toBeInTheDocument();
    });
  });
});
