import { ProjectCategory, ProjectStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
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

/** The desktop table (the grid also draws phone cards with the same links). */
const table = async () => within(await screen.findByRole('table'));

describe('ProjectsList', () => {
  it('renders each project with a link to its page', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Al-Baraka Tower' }),
    ]);

    renderWithProviders(<ProjectsList />);

    const link = await (await table()).findByRole('link', { name: /Al-Baraka Tower/ });
    expect(link).toHaveAttribute('href', '/projects/1');
  });

  it('filters by search across code, name, and client', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Al-Baraka Tower', clientName: 'ACCO Ltd' }),
      project({ id: '2', name: 'Hodan Plaza', clientName: 'Baraka Holdings' }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await (await table()).findByRole('link', { name: /Al-Baraka Tower/ });
    await user.type(screen.getByLabelText('Search projects'), 'ACCO');

    await waitFor(() => {
      expect(screen.queryAllByRole('link', { name: /Hodan Plaza/ })).toHaveLength(0);
    });
    expect((await table()).getByRole('link', { name: /Al-Baraka Tower/ })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Active Project', status: ProjectStatus.ACTIVE }),
      project({ id: '2', name: 'Draft Project',  status: ProjectStatus.DRAFT  }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await (await table()).findByRole('link', { name: /Active Project/ });
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Filter by status' }), ProjectStatus.DRAFT);
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.queryAllByRole('link', { name: /Active Project/ })).toHaveLength(0);
    });
    expect((await table()).getByRole('link', { name: /Draft Project/ })).toBeInTheDocument();
  });

  it('filters by category, and shows Untyped for legacy projects (PTD1-PTD5)', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Commercial Project', category: ProjectCategory.COMMERCIAL }),
      project({ id: '2', name: 'Legacy Project', category: null }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await (await table()).findByRole('link', { name: /Commercial Project/ });
    // The legacy row shows an Untyped chip rather than a fabricated category.
    expect(screen.getAllByText('Untyped').filter((el) => el.tagName === 'SPAN').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Filter by category' }), ProjectCategory.COMMERCIAL);
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.queryAllByRole('link', { name: /Legacy Project/ })).toHaveLength(0);
    });
    expect((await table()).getByRole('link', { name: /Commercial Project/ })).toBeInTheDocument();
  });

  it('offers to create a project when there are none at all', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    renderWithProviders(<ProjectsList />);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New project' })[0]).toHaveAttribute(
      'href',
      '/projects/new',
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers to clear filters when a search hides everything', async () => {
    vi.mocked(listProjects).mockResolvedValue([project({ id: '1', name: 'Al-Baraka' })]);

    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await (await table()).findByRole('link', { name: /Al-Baraka/ });
    await user.type(screen.getByLabelText('Search projects'), 'nothing matches this');

    expect((await screen.findAllByText('No projects match your search.')).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await (await table()).findByRole('link', { name: /Al-Baraka/ })).toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('network'));

    renderWithProviders(<ProjectsList />);

    expect(await screen.findByText('Could not load projects.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });


  it('announces the visible count', async () => {
    vi.mocked(listProjects).mockResolvedValue([project({ id: '1' }), project({ id: '2' })]);

    renderWithProviders(<ProjectsList />);

    await (await table()).findByRole('link', { name: /Project 1/ });
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('project'));
    expect(status).toBeDefined();
    expect(status!.textContent).toContain('2 projects');
  });

  it('offers Edit only on a project the domain will actually let you edit', async () => {
    // Editing is a DRAFT-only command (`project-detail.tsx`). The row menu first shipped gated
    // on `create:project` and on every status, so it offered Edit on an ACTIVE project and led
    // to a page that refuses it. Permissions are granted in this file's mock, so what this
    // pins is the lifecycle half of the gate.
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '1', name: 'Running Tower', status: ProjectStatus.ACTIVE }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await user.click(await (await table()).findByRole('button', { name: 'Actions for Running Tower' }));
    expect(await screen.findByRole('menuitem', { name: 'View project' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit project' })).not.toBeInTheDocument();
  });

  it('offers Edit on a DRAFT project', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      project({ id: '2', name: 'Planned Tower', status: ProjectStatus.DRAFT }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ProjectsList />);

    await user.click(await (await table()).findByRole('button', { name: 'Actions for Planned Tower' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit project' })).toHaveAttribute(
      'href',
      '/projects/2/edit',
    );
  });
});
