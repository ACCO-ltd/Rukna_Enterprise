import { ProjectStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  cancelProject,
  getProject,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '@/features/projects/api/projects-api';
import type { ProjectDetail as ProjectDetailModel, ProjectSuspension } from '../types';

import { ProjectDetail } from './project-detail';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProject: vi.fn(),
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

const messages = {
  common: { loading: 'Loading...' },
  platform: {
    projects: {
      detail: {
        notFound: 'This project does not exist, or you do not have access to it.',
        editNotAllowed: 'This project can no longer be edited.',
        editTitle: 'Edit project',
        backToProject: 'Back to project',
        backToList: 'Back to projects',
        loadFailed: 'Could not load this project.',
        overview: 'Overview',
        client: 'Client',
        contractValue: 'Contract value',
        startDate: 'Start date',
        expectedEnd: 'Expected completion',
        created: 'Created',
        description: 'Description',
        notSet: 'Not set',
        suspendedTitle: 'This project is suspended',
        suspendedSince: 'Suspended on {date}',
        suspendedBlocks: 'Lifecycle changes are blocked until the project is resumed.',
        membersHeading: 'Team',
        membersUnavailable: 'Team management is not available yet.',
        membersUnavailableHint: 'The API cannot yet add the first member to a project.',
        actionsHeading: 'Actions',
      },
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
    actions: {
      approve: 'Approve',
      mobilize: 'Start mobilization',
      activate: 'Activate',
      'practical-completion': 'Record practical completion',
      closeout: 'Begin closeout',
      close: 'Close project',
      edit: 'Edit',
      cancel: 'Cancel project',
      suspend: 'Suspend',
      resume: 'Resume',
      failed: 'That action could not be completed.',
      confirmTitle: '{action}?',
      confirmApprove: 'The project moves out of draft and can no longer be edited.',
      confirmMobilize: 'Confirm the project is moving into mobilization.',
      confirmActivate: 'Confirm the project is now active on site.',
      confirmPracticalCompletion: 'Confirm the works have reached practical completion.',
      confirmCloseout: 'Confirm the project is entering closeout.',
      confirmClose: 'The project will be closed.',
      confirmCancel: 'Cancelling a project cannot be undone.',
      reasonLabel: 'Reason',
      reasonRequired: 'Enter a reason',
      reasonTooLong: 'Reason cannot exceed 1000 characters',
      cancelReasonHint: 'Recorded in the audit trail.',
      confirm: 'Confirm',
      working: 'Working...',
      dismiss: 'Cancel',
    },
  },
};

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
    members: [],
    suspensions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getProject).mockReset();
  vi.mocked(runProjectCommand).mockReset();
  vi.mocked(cancelProject).mockReset();
  vi.mocked(suspendProject).mockReset();
  vi.mocked(resumeProject).mockReset();
});

describe('ProjectDetail — loading and failure', () => {
  it('announces loading', () => {
    vi.mocked(getProject).mockReturnValue(new Promise(() => {/* never settles */}));

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  // 403 and 404 are the same thing to the user, and the difference is not worth leaking.
  it.each([403, 404])('reports %s as not found', async (status) => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(status, 'nope'));

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(
      await screen.findByText('This project does not exist, or you do not have access to it.'),
    ).toBeInTheDocument();
  });

  it('reports other failures as a load error', async () => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(500, 'boom'));

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(await screen.findByText('Could not load this project.')).toBeInTheDocument();
  });
});

describe('ProjectDetail — available actions', () => {
  it('offers approve, edit, suspend and cancel for a draft', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel project' })).toBeInTheDocument();
  });

  it('offers nothing but the record for a closed project', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.CLOSED }));

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    await screen.findByText('Al-Baraka Tower');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows the suspension, hides the forward step, and offers resume', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({ status: ProjectStatus.MOBILIZING, suspensions: [suspension()] }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(await screen.findByText('This project is suspended')).toBeInTheDocument();
    expect(screen.getByText('Awaiting site access clearance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — running commands', () => {
  it('confirms before advancing the lifecycle', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(runProjectCommand).mockResolvedValue(project({ status: ProjectStatus.APPROVED }));

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

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

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

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

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
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

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    await user.click(await screen.findByRole('button', { name: 'Cancel project' }));
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

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

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

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Project is suspended.')).toBeInTheDocument();
    // The dialog stays open so the user can read it and retry or back out.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ProjectDetail — team', () => {
  // B1: addMember requires the caller to already be a member and create never enrols one,
  // so an empty roster would imply "unassigned" rather than "not possible yet".
  it('explains that team management is unavailable rather than showing an empty roster', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { messages });

    expect(await screen.findByText('Team management is not available yet.')).toBeInTheDocument();
  });
});
