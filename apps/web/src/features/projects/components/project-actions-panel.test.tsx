import { ProjectStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pickDate } from '@/test/pick-date';
import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  getProjectReadiness,
  cancelProject,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '@/features/projects/api/projects-api';

import type { ProjectDetail as ProjectDetailModel, ProjectSuspension } from '../types';
import { ProjectActionsPanel } from './project-actions-panel';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProject: vi.fn(),
  getProjectReadiness: vi.fn(),
  getProjectWorkspaceSummary: vi.fn(),
  runProjectCommand: vi.fn(),
  cancelProject: vi.fn(),
  suspendProject: vi.fn(),
  resumeProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('@/features/workflows/hooks/use-approval', () => ({
  useApprovalStep: () => ({ data: null, isPending: false, isError: false }),
  useApprovalAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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

const MANAGER = { permissions: ['manage:project'] };

async function chooseOverflowAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Actions' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.mocked(getProjectReadiness).mockReset();
  vi.mocked(getProjectReadiness).mockResolvedValue({
    command: 'start',
    targetStatus: 'ACTIVE',
    ready: true,
    conditions: [],
    deferred: [],
  });
  vi.mocked(runProjectCommand).mockReset();
  vi.mocked(cancelProject).mockReset();
  vi.mocked(suspendProject).mockReset();
  vi.mocked(resumeProject).mockReset();
});

describe('Project lifecycle controls', () => {
  it('keeps an unfinished contract in preparation even if the old summary counts it complete', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue({
      command: 'start',
      targetStatus: 'ACTIVE',
      ready: false,
      conditions: [
        {
          code: 'ACTIVE_MAIN_CONTRACT',
          severity: 'MANDATORY',
          satisfied: false,
          detail: 'Execute the contract',
        },
      ],
      deferred: [],
    });
    renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
    expect(await screen.findByRole('link', { name: /Continue setup/ })).toHaveAttribute(
      'href',
      '/projects/p1#project-readiness-title',
    );
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
  });

  it('holds the start action while readiness is loading', () => {
    vi.mocked(getProjectReadiness).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
  });

  it('does not offer commands without manage permission', () => {
    renderWithProviders(<ProjectActionsPanel project={project()} />, {
      permissions: ['view:project'],
    });
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('requires and submits the actual commencement date', async () => {
    const user = userEvent.setup();
    vi.mocked(runProjectCommand).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));
    renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
    await user.click(await screen.findByRole('button', { name: 'Start project' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Start project' }));
    expect(runProjectCommand).not.toHaveBeenCalled();
    await pickDate(user, dialog.getByLabelText(/Actual commencement date/), '2026-09-09');
    await user.type(dialog.getByLabelText('Commencement note (optional)'), 'Site handed over');
    await user.click(dialog.getByRole('button', { name: 'Start project' }));
    await waitFor(() =>
      expect(runProjectCommand).toHaveBeenCalledWith('p1', {
        command: 'start',
        evidence: { actualStartDate: '2026-09-09', commencementNote: 'Site handed over' },
      }),
    );
  });

  it('requires a closure summary and date', async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectReadiness).mockResolvedValue({
      command: 'close',
      targetStatus: 'CLOSED',
      ready: true,
      conditions: [],
      deferred: ['DOCUMENTS_COMPLETE'],
    });
    renderWithProviders(
      <ProjectActionsPanel project={project({ status: ProjectStatus.CLOSEOUT })} />,
      MANAGER,
    );
    await user.click(screen.getByRole('button', { name: 'Close project' }));
    const dialog = within(screen.getByRole('dialog'));
    await pickDate(user, dialog.getByLabelText(/Closure date/), '2026-09-09');
    await user.click(dialog.getByRole('button', { name: 'Close project' }));
    expect(runProjectCommand).not.toHaveBeenCalled();
    await user.type(
      dialog.getByLabelText(/Closure summary/),
      'Final account and handover reviewed',
    );
    await user.click(dialog.getByRole('button', { name: 'Close project' }));
    await waitFor(() =>
      expect(runProjectCommand).toHaveBeenCalledWith('p1', {
        command: 'close',
        evidence: {
          closureDate: '2026-09-09',
          closureSummary: 'Final account and handover reviewed',
        },
      }),
    );
  });

  it('collects a specific reason for a waivable readiness condition', async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectReadiness).mockResolvedValue({
      command: 'start',
      targetStatus: 'ACTIVE',
      ready: false,
      conditions: [
        {
          code: 'DELIVERY_TEAM',
          satisfied: false,
          severity: 'WAIVABLE',
          detail: 'Team incomplete',
        },
      ],
      deferred: [],
    });
    renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
    await user.click(await screen.findByRole('button', { name: 'Start project' }));
    const dialog = within(screen.getByRole('dialog'));
    await pickDate(user, dialog.getByLabelText(/Actual commencement date/), '2026-09-09');
    await user.click(dialog.getByRole('button', { name: 'Start project' }));
    expect(runProjectCommand).not.toHaveBeenCalled();
    await user.type(
      dialog.getByRole('textbox', { name: /team/i }),
      'Engineer joins after site handover',
    );
    await user.click(dialog.getByRole('button', { name: 'Start project' }));
    await waitFor(() =>
      expect(runProjectCommand).toHaveBeenCalledWith('p1', {
        command: 'start',
        evidence: {
          actualStartDate: '2026-09-09',
          overrides: [{ condition: 'DELIVERY_TEAM', reason: 'Engineer joins after site handover' }],
        },
      }),
    );
  });

  it('keeps entered evidence when the server rejects a command', async () => {
    const user = userEvent.setup();
    vi.mocked(runProjectCommand).mockRejectedValue(
      new ApiError(400, 'Project is suspended.', 'BAD_REQUEST', ['Project is suspended.']),
    );
    renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
    await user.click(await screen.findByRole('button', { name: 'Start project' }));
    const dialog = within(screen.getByRole('dialog'));
    await pickDate(user, dialog.getByLabelText(/Actual commencement date/), '2026-09-09');
    await user.type(dialog.getByLabelText('Commencement note (optional)'), 'Retain this note');
    await user.click(dialog.getByRole('button', { name: 'Start project' }));
    expect(await screen.findByText('Project is suspended.')).toBeInTheDocument();
    expect(dialog.getByLabelText('Commencement note (optional)')).toHaveValue('Retain this note');
  });

  it('requires a reason before suspending', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectActionsPanel project={project({ status: ProjectStatus.ACTIVE })} />,
      MANAGER,
    );
    await chooseOverflowAction(user, 'Suspend');
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(suspendProject).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Reason'), 'Awaiting clearance');
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(suspendProject).toHaveBeenCalledWith('p1', 'Awaiting clearance'));
  });

  it('offers resume while suspended and no forward transition', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectActionsPanel
        project={project({ status: ProjectStatus.ACTIVE, suspensions: [suspension()] })}
      />,
      MANAGER,
    );
    expect(
      screen.queryByRole('button', { name: 'Record practical completion' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(resumeProject).toHaveBeenCalledWith('p1'));
  });
});

it('retains exact commencement evidence across an approval gate and retry', async () => {
  const user = userEvent.setup();
  vi.mocked(runProjectCommand)
    .mockRejectedValueOnce(
      new ApiError(409, 'Approval required', 'CONFLICT', [], { approvalInstanceId: 'approval-1' }),
    )
    .mockResolvedValueOnce(project({ status: ProjectStatus.ACTIVE }));
  renderWithProviders(<ProjectActionsPanel project={project()} />, MANAGER);
  await user.click(await screen.findByRole('button', { name: 'Start project' }));
  const dialog = within(screen.getByRole('dialog'));
  await pickDate(user, dialog.getByLabelText(/Actual commencement date/), '2026-09-09');
  await user.type(dialog.getByLabelText('Commencement note (optional)'), 'Approved site handover');
  await user.click(dialog.getByRole('button', { name: 'Start project' }));
  expect(
    await screen.findByText('Awaiting approval. The project has not changed stage.'),
  ).toBeInTheDocument();
  expect(dialog.getByLabelText('Commencement note (optional)')).toBeDisabled();
  await user.click(dialog.getByRole('button', { name: 'Complete approved action' }));
  await waitFor(() => expect(runProjectCommand).toHaveBeenCalledTimes(2));
  expect(vi.mocked(runProjectCommand).mock.calls[1]).toEqual(
    vi.mocked(runProjectCommand).mock.calls[0],
  );
});
