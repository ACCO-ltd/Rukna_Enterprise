import { ProjectStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  cancelProject,
  getProject,
  getProjectWorkspaceGuidance,
  getProjectWorkspaceSummary,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '@/features/projects/api/projects-api';
import type { ProjectDetail as ProjectDetailModel, ProjectSuspension } from '../types';

import { ProjectDetail } from './project-detail';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProject: vi.fn(),
  getProjectWorkspaceGuidance: vi.fn(),
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

function workspaceSummary() {
  return {
    projectId: 'p1',
    setup: {
      identityComplete: true,
      boqExists: false,
      boqBaselined: false,
      mainContractApplicable: true,
      mainContractExists: false,
      teamReady: false,
      completedSteps: 1,
      totalSteps: 4,
    },
    responsibility: { projectManager: null, teamCount: 0 },
    programme: { startDate: null, expectedEndDate: null, daysRemaining: null },
    mainContract: null,
    financialsVisible: false,
    recentActivity: [],
  };
}

beforeEach(() => {
  vi.mocked(getProject).mockReset();
  vi.mocked(getProjectWorkspaceSummary).mockReset();
  vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(workspaceSummary());
  vi.mocked(getProjectWorkspaceGuidance).mockResolvedValue([]);
  vi.mocked(runProjectCommand).mockReset();
  vi.mocked(cancelProject).mockReset();
  vi.mocked(suspendProject).mockReset();
  vi.mocked(resumeProject).mockReset();
});

async function chooseOverflowAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Actions' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

describe('ProjectDetail — loading and failure', () => {
  it('announces loading', () => {
    vi.mocked(getProject).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  // 403 and 404 are the same thing to the user, and the difference is not worth leaking.
  it.each([403, 404])('reports %s as not found', async (status) => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(status, 'nope'));

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(
      await screen.findByText('This project does not exist, or you do not have access to it.'),
    ).toBeInTheDocument();
  });

  it('reports other failures as a load error', async () => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(500, 'boom'));

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(await screen.findByText('Could not load this project.')).toBeInTheDocument();
  });
});

describe('ProjectDetail — available actions', () => {
  it('presents backend attention items with a direct next action', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceGuidance).mockResolvedValue([
      {
        id: 'team',
        severity: 'WARNING',
        kind: 'DELIVERY_TEAM_INCOMPLETE',
        actionUrl: '/projects/p1/members',
        responsibleRole: 'PROJECT_MANAGER',
      },
    ]);

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(await screen.findByText('Delivery team is incomplete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage team' })).toHaveAttribute(
      'href',
      '/projects/p1/members',
    );
  });


  it('offers approve, edit, and secondary lifecycle actions for a draft', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
    await chooseOverflowAction(user, 'Suspend');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers nothing but the record for a closed project', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.CLOSED }));

    renderWithProviders(<ProjectDetail id="p1" />);

    // Overview section heading is a reliable signal that the project loaded.
    await screen.findByText('Overview');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows the suspension, hides the forward step, and offers resume', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({ status: ProjectStatus.MOBILIZING, suspensions: [suspension()] }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    expect(await screen.findByText('This project is suspended')).toBeInTheDocument();
    expect(screen.getByText('Awaiting site access clearance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });
});

describe('ProjectDetail — running commands', () => {
  it('confirms before advancing the lifecycle', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(runProjectCommand).mockResolvedValue(project({ status: ProjectStatus.APPROVED }));

    renderWithProviders(<ProjectDetail id="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    // Nothing has been sent yet — the dialog is the whole point.
    expect(runProjectCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The project moves out of draft and can no longer be edited.',
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(runProjectCommand).toHaveBeenCalledWith('p1', 'approve');
    });
  });

  it('abandons the command when the dialog is dismissed', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(runProjectCommand).not.toHaveBeenCalled();
  });

  it('requires a reason before suspending', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />);

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
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    await chooseOverflowAction(user, 'Cancel project');
    await user.type(screen.getByLabelText('Reason'), 'Client withdrew funding');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(cancelProject).toHaveBeenCalledWith('p1', 'Client withdrew funding');
    });
  });

  it('resumes without a confirmation, since it is not destructive', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(
      project({ status: ProjectStatus.ACTIVE, suspensions: [suspension()] }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(resumeProject).toHaveBeenCalledWith('p1');
    });
  });

  // The API's messages are more useful than ours: "Project is suspended. Resume it
  // before changing status." beats "that action could not be completed".
  it("shows the server's explanation when a command fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(runProjectCommand).mockRejectedValue(
      new ApiError(400, 'Project is suspended.', 'BAD_REQUEST', ['Project is suspended.']),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Project is suspended.')).toBeInTheDocument();
    // The dialog stays open so the user can read it and retry or back out.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
