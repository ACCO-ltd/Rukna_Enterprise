import { ProjectStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listProjects } from '@/features/projects/api/projects-api';
import type { Project } from '@/features/projects/types';

import { ProjectsList } from './projects-list';

vi.mock('@/features/projects/api/projects-api', () => ({
  listProjects: vi.fn(),
}));

vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: () => true }),
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
    code: `PROJ-${overrides.id}`,
    name: `Project ${overrides.id}`,
    nameAr: null,
    description: null,
    status: ProjectStatus.ACTIVE,
    contractValue: null,
    currency: null,
    clientName: null,
    clientId: null,
    location: null,
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

describe('ProjectsList', () => {
  it('renders each project with a link to its page', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Al-Baraka Tower' }),
    ]);

    renderWithProviders(<ProjectsList />);

    const link = await screen.findByRole('link', { name: /Al-Baraka Tower/ });
    expect(link).toHaveAttribute('href', '/projects/1');
  });

  it('filters by search across code, name, and client', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Al-Baraka Tower', clientName: 'ACCO Ltd' }),
      project({ id: '2', name: 'Hodan Plaza', clientName: 'Baraka Holdings' }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await screen.findByRole('link', { name: /Al-Baraka Tower/ });
    await user.type(screen.getByLabelText('Search projects'), 'ACCO');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Hodan Plaza/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Al-Baraka Tower/ })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Active Project', status: ProjectStatus.ACTIVE }),
      project({ id: '2', name: 'Draft Project',  status: ProjectStatus.DRAFT  }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await screen.findByRole('link', { name: /Active Project/ });
    await user.selectOptions(screen.getByLabelText('Filter by status'), ProjectStatus.DRAFT);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Active Project/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Draft Project/ })).toBeInTheDocument();
  });

  it('offers to create a project when there are none at all', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    renderWithProviders(<ProjectsList />);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/projects/new',
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers to clear filters when a search hides everything', async () => {
    vi.mocked(listProjects).mockResolvedValue([project({ id: '1', name: 'Al-Baraka' })]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await screen.findByRole('link', { name: /Al-Baraka/ });
    await user.type(screen.getByLabelText('Search projects'), 'nothing matches this');

    expect(await screen.findByText('No projects match your search.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: /Al-Baraka/ })).toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('network'));

    renderWithProviders(<ProjectsList />);

    expect(await screen.findByText('Could not load projects.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('prefers the Arabic name when the UI is in Arabic', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Al-Baraka Tower', nameAr: 'برج البركة' }),
    ]);

    renderWithProviders(<ProjectsList />, { locale: 'ar' });

    expect(await screen.findByRole('link', { name: /برج البركة/ })).toBeInTheDocument();
  });

  it('announces the visible count', async () => {
    vi.mocked(listProjects).mockResolvedValue([project({ id: '1' }), project({ id: '2' })]);

    renderWithProviders(<ProjectsList />);

    await screen.findByRole('link', { name: /Project 1/ });
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('project'));
    expect(status).toBeDefined();
    expect(status!.textContent).toContain('2 projects');
  });
});
