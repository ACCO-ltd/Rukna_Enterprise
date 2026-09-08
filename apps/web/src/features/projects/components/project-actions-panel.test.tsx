import { ProjectStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  cancelProject,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '@/features/projects/api/projects-api';

import type {
  ProjectDetail as ProjectDetailModel,
  ProjectSuspension,
  ProjectWorkspaceSummary,
} from '../types';
import { ProjectActionsPanel } from './project-actions-panel';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProject: vi.fn(),
  getProjectWorkspaceSummary: vi.fn(),
  runProjectCommand: vi.fn(),
  cancelProject: vi.fn(),
  suspendProject: vi.fn(),
  resumeProject: vi.fn(),
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

function suspension(overrides: Partial<ProjectSuspension> = {}): ProjectSuspension {
  return {
    id: 's1',
    projectId: 'p1',
    reason: 'Awaiting site access clearance',
    suspendedAt: '2026-08-01T00:00:00.000Z',
    suspendedBy: 'user-1',
    resumedAt: null,
    resumedBy: null,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectDetailModel> = {}): ProjectDetailModel {
  return {
    id: 'p1',
    organizationId: 'org-1',
    code: 'ACCO-2026-001',
    name: 'Al-Baraka Tower',
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
    members: [],
    suspensions: [],
    ...overrides,
  };
}

function setup(
  overrides: Partial<ProjectWorkspaceSummary['setup']> = {},
): ProjectWorkspaceSummary['setup'] {
  return {
    identityComplete: true,
    boqExists: false,
    boqBaselined: false,
    mainContractApplicable: true,
    mainContractExists: false,
    teamReady: false,
    completedSteps: 1,
    totalSteps: 4,
    ...overrides,
  };
}

/** All four steps done — the only state in which a draft may actually start. */
function readySetup(): ProjectWorkspaceSummary['setup'] {
  return setup({
    boqExists: true,
    boqBaselined: true,
    mainContractExists: true,
    teamReady: true,
    completedSteps: 4,
  });
}

/**
 * Every control in this panel calls a route guarded by `manage:project`, so the panel renders
 * nothing without it. Tests about anything else seed the permission.
 */
const MANAGER = { permissions: ['manage:project'] };

async function chooseOverflowAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Actions' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.mocked(runProjectCommand).mockReset();
  vi.mocked(cancelProject).mockReset();
  vi.mocked(suspendProject).mockReset();
  vi.mocked(resumeProject).mockReset();
});

/**
 * The header offers one primary control, and which one depends on whether the project can
 * actually accept it. Offering "Start project" to a draft with no baselined BOQ is a button
 * that exists to be rejected by the server.
 */
describe('ProjectActionsPanel — the primary control follows readiness', () => {
  it('sends an unfinished draft to the BOQ, not at a command that would fail', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} setup={setup()} />, MANAGER);

    const cta = screen.getByRole('link', { name: /Continue setup/ });
    expect(cta).toHaveAttribute('href', '/projects/p1/boq');
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
  });

  it('moves to the contract once the BOQ is baselined, and to the team after that', () => {
    const { rerender } = renderWithProviders(
      <ProjectActionsPanel
        project={project()}
        setup={setup({ boqExists: true, boqBaselined: true, completedSteps: 2 })}
      />,
      MANAGER,
    );

    expect(screen.getByRole('link', { name: /Continue setup/ })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract/new',
    );

    rerender(
      <ProjectActionsPanel
        project={project()}
        setup={setup({
          boqExists: true,
          boqBaselined: true,
          mainContractExists: true,
          completedSteps: 3,
        })}
      />,
    );

    expect(screen.getByRole('link', { name: /Continue setup/ })).toHaveAttribute(
      'href',
      '/projects/p1/members',
    );
  });

  it('offers the lifecycle command only once every step is done', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} setup={readySetup()} />, MANAGER);

    expect(screen.getByRole('button', { name: 'Start project' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue setup/ })).not.toBeInTheDocument();
  });

  /**
   * Readiness gates `start` and nothing else. A project already running has passed that gate,
   * so its forward step is offered on its own terms.
   */
  it('does not gate later transitions on setup steps', () => {
    renderWithProviders(
      <ProjectActionsPanel project={project({ status: ProjectStatus.ACTIVE })} setup={setup()} />,
      MANAGER,
    );

    expect(screen.getByRole('button', { name: 'Record practical completion' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue setup/ })).not.toBeInTheDocument();
  });

  it('holds the primary control back while readiness is still loading', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} setup={undefined} />, MANAGER);

    // Rendering "Start project" and swapping it for "Continue setup" a moment later is worse
    // than a beat of nothing: the reader may already have clicked.
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue setup/ })).not.toBeInTheDocument();
  });

  it('falls back to the command when readiness cannot be read, and lets the server decide', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} setup={null} />, MANAGER);

    expect(screen.getByRole('button', { name: 'Start project' })).toBeInTheDocument();
  });
});

describe('ProjectActionsPanel — authorization', () => {
  /**
   * `PATCH /projects/:id` and all seven lifecycle commands carry
   * `@RequirePermissions(PERMISSIONS.projectsManage)`. Showing them to a member who holds only
   * `view:project` teaches them their own permissions one 403 at a time.
   */
  it('renders nothing at all without manage:project', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} setup={readySetup()} />, {
      permissions: ['view:project'],
    });

    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue setup/ })).not.toBeInTheDocument();
  });
});

describe('ProjectActionsPanel — available actions', () => {
  /**
   * "Edit" on its own does not say what it edits — the metadata, the lifecycle, the contract,
   * the scope? It belongs in the overflow, under a name that answers that.
   */
  it('keeps editing in the overflow, named for what it edits', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectActionsPanel project={project()} setup={setup()} />, MANAGER);

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Edit project information' }),
    ).toHaveAttribute('href', '/projects/p1/edit');
  });

  it('offers nothing but the record for a closed project', () => {
    renderWithProviders(
      <ProjectActionsPanel project={project({ status: ProjectStatus.CLOSED })} setup={null} />,
      MANAGER,
    );

    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('hides the forward step while suspended and offers resume', () => {
    renderWithProviders(
      <ProjectActionsPanel
        project={project({ status: ProjectStatus.ACTIVE, suspensions: [suspension()] })}
        setup={null}
      />,
      MANAGER,
    );

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Record practical completion' }),
    ).not.toBeInTheDocument();
  });
});

describe('ProjectActionsPanel — running commands', () => {
  it('confirms before advancing the lifecycle', async () => {
    const user = userEvent.setup();
    vi.mocked(runProjectCommand).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectActionsPanel project={project()} setup={readySetup()} />, MANAGER);

    await user.click(screen.getByRole('button', { name: 'Start project' }));

    // Nothing has been sent yet — the dialog is the whole point.
    expect(runProjectCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The project leaves preparation and becomes active on site. It can no longer be edited.',
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(runProjectCommand).toHaveBeenCalledWith('p1', 'start');
    });
  });

  it('abandons the command when the dialog is dismissed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectActionsPanel project={project()} setup={readySetup()} />, MANAGER);

    await user.click(screen.getByRole('button', { name: 'Start project' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(runProjectCommand).not.toHaveBeenCalled();
  });

  it('requires a reason before suspending', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectActionsPanel project={project({ status: ProjectStatus.ACTIVE })} setup={null} />,
      MANAGER,
    );

    await chooseOverflowAction(user, 'Suspend');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(suspendProject).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Reason'), 'Awaiting municipality clearance');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(suspendProject).toHaveBeenCalledWith('p1', 'Awaiting municipality clearance');
    });
  });

  it('requires a reason before cancelling', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectActionsPanel project={project()} setup={setup()} />, MANAGER);

    await chooseOverflowAction(user, 'Cancel project');
    await user.type(screen.getByLabelText('Reason'), 'Client withdrew funding');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(cancelProject).toHaveBeenCalledWith('p1', 'Client withdrew funding');
    });
  });

  it('resumes without a confirmation, since it is not destructive', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectActionsPanel
        project={project({ status: ProjectStatus.ACTIVE, suspensions: [suspension()] })}
        setup={null}
      />,
      MANAGER,
    );

    await user.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(resumeProject).toHaveBeenCalledWith('p1');
    });
  });

  // The API's messages are more useful than ours: "Project is suspended. Resume it
  // before changing status." beats "that action could not be completed".
  it("shows the server's explanation when a command fails", async () => {
    const user = userEvent.setup();
    vi.mocked(runProjectCommand).mockRejectedValue(
      new ApiError(400, 'Project is suspended.', 'BAD_REQUEST', ['Project is suspended.']),
    );

    renderWithProviders(<ProjectActionsPanel project={project()} setup={readySetup()} />, MANAGER);

    await user.click(screen.getByRole('button', { name: 'Start project' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Project is suspended.')).toBeInTheDocument();
    // The dialog stays open so the user can read it and retry or back out.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
