import { ProjectStatus } from '@erp/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  getProject,
  getProjectActivity,
  getProjectWorkspaceSummary,
  getProjectReadiness,
} from '@/features/projects/api/projects-api';
import type { ProjectDetail as ProjectDetailModel, ProjectWorkspaceSummary } from '../types';

import { ProjectDetail, durationLabel } from './project-detail';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProject: vi.fn(),
  getProjectReadiness: vi.fn(),
  getProjectWorkspaceSummary: vi.fn(),
  getProjectActivity: vi.fn(),
  runProjectCommand: vi.fn(),
  cancelProject: vi.fn(),
  suspendProject: vi.fn(),
  resumeProject: vi.fn(),
  listProjects: vi.fn(),
}));

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));

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

function project(overrides: Partial<ProjectDetailModel> = {}): ProjectDetailModel {
  return {
    id: 'p1',
    organizationId: 'org-1',
    code: 'ACCO-2026-001',
    name: 'Al-Baraka Tower',
    description: null,
    status: ProjectStatus.DRAFT,
    contractValue: null,
    currency: 'USD',
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

function workspaceSummary(
  overrides: Partial<ProjectWorkspaceSummary> = {},
): ProjectWorkspaceSummary {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getProjectReadiness).mockResolvedValue({
    command: 'start',
    targetStatus: 'ACTIVE',
    ready: false,
    conditions: [
      { code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: false, detail: 'Baseline BOQ', blockedBy: [], satisfiedAt: null },
      { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false, detail: 'Execute contract', blockedBy: [], satisfiedAt: null },
      { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false, detail: 'Assign team', blockedBy: [], satisfiedAt: null },
    ],
    deferred: [],
    caller: { canRun: false, waivableConditions: [] },
  });
  vi.mocked(getProjectActivity).mockReset();
  vi.mocked(getProject).mockReset();
  vi.mocked(getProjectWorkspaceSummary).mockReset();
  vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(workspaceSummary());
});

describe('ProjectDetail — loading and failure', () => {
  it('announces loading', () => {
    vi.mocked(getProject).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    // The toast region is also a status region; the loading one is the one that says so.
    expect(
      screen.getAllByRole('status').some((node) => node.textContent?.includes('Loading...')),
    ).toBe(true);
  });

  // 403 and 404 are the same thing to the user, and the difference is not worth leaking.
  it.each([403, 404])('reports %s as not found', async (status) => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(status, 'nope'));

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    expect(
      await screen.findByText('This project does not exist, or you do not have access to it.'),
    ).toBeInTheDocument();
  });

  it('reports other failures as a load error', async () => {
    vi.mocked(getProject).mockRejectedValue(new ApiError(500, 'boom'));

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    expect(await screen.findByText('Could not load this project.')).toBeInTheDocument();
  });
});

/**
 * The status pill in the workspace header is the one lifecycle indicator. Overview used to
 * repeat it as a stepper row; two indicators can only agree or contradict each other.
 */
describe('ProjectDetail — one lifecycle indicator', () => {
  it.each([ProjectStatus.DRAFT, ProjectStatus.ACTIVE])(
    'draws no lifecycle stepper on Overview (%s)',
    async (status) => {
      vi.mocked(getProject).mockResolvedValue(project({ status }));

      renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

      await screen.findByRole('heading', { name: 'Project' });
      expect(screen.queryByRole('list', { name: 'Project lifecycle' })).not.toBeInTheDocument();
      expect(screen.queryByText('Practical completion')).not.toBeInTheDocument();
    },
  );
});

describe('ProjectDetail — project readiness', () => {
  it('leads a draft with what is left before it can start, above the identity facts', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const readiness = await screen.findByRole('heading', { name: 'Before you start' });
    const information = await screen.findByRole('heading', { name: 'Project' });

    expect(readiness.compareDocumentPosition(information)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows server conditions and their owner when the reader cannot act', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });
    const section = (await screen.findByRole('heading', { name: 'Before you start' })).closest(
      'section',
    )!;
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).getByText('2 required steps left before you can start.')).toBeInTheDocument();
    expect(within(section).getByText(/Quantity surveyor/)).toBeInTheDocument();
    expect(within(section).queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses the readiness response instead of the legacy completed-step count', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectReadiness).mockResolvedValue({
      command: 'start',
      targetStatus: 'ACTIVE',
      ready: true,
      conditions: [],
      deferred: [],
      caller: { canRun: false, waivableConditions: [] },
    });
    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });
    expect(await screen.findByText('Ready to start. Every step is done.')).toBeInTheDocument();
  });

  /**
   * Once the project is running, the checklist is history. A permanent "6 of 6" panel is a
   * monument to work finished months ago.
   */
  it('disappears entirely once the project is no longer in preparation', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    await screen.findByRole('heading', { name: 'Project' });
    expect(screen.queryByRole('heading', { name: 'Before you start' })).not.toBeInTheDocument();
  });
});

function railSection(name: string) {
  return screen.findByRole('heading', { name }).then((heading) => heading.closest('section')!);
}

describe('ProjectDetail — project information', () => {
  /**
   * `PATCH /projects/:id` requires `manage:project`. The contextual Edit link is two conditions,
   * not one: a draft (lifecycle) read by someone who may write to it (authorization).
   */
  it('hides the contextual Edit link without manage:project', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { permissions: ['view:project'], withToast: true });

    const section = await railSection('Project');
    expect(within(section).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('offers it to a draft when the reader may write to it', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { permissions: ['manage:project'], withToast: true });

    const section = await railSection('Project');
    expect(within(section).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/projects/p1/edit',
    );
  });

  /**
   * Identity is stated once, in the workspace header. Repeating the code, the client or the
   * site here gives the reader two copies of the same fact to reconcile.
   */
  it('does not restate the facts the workspace header already carries', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({
        status: ProjectStatus.ACTIVE,
        clientName: 'Baraka Real Estate LLC',
        location: 'Waaberi, Mogadishu',
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Project');
    expect(within(section).queryByText('Project code')).not.toBeInTheDocument();
    expect(within(section).queryByText('ACCO-2026-001')).not.toBeInTheDocument();
    expect(within(section).queryByText('Client')).not.toBeInTheDocument();
    expect(within(section).queryByText('Location')).not.toBeInTheDocument();
    expect(within(section).queryByText('Waaberi, Mogadishu')).not.toBeInTheDocument();
    expect(within(section).queryByText('Current stage')).not.toBeInTheDocument();
    expect(within(section).queryByText('Project manager')).not.toBeInTheDocument();
  });

  it('renders the classification, delivery and planned-date facts it does own', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({
        status: ProjectStatus.ACTIVE,
        participationModel: 'SOLE',
        startDate: '2026-09-02T00:00:00.000Z',
        expectedEndDate: '2026-09-30T00:00:00.000Z',
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Project');
    expect(within(section).getByText('Sole delivery')).toBeInTheDocument();
    // No category was ever assigned, so it reads as untyped rather than being invented.
    expect(within(section).getByText('Untyped')).toBeInTheDocument();
    expect(within(section).getByText('Planned start')).toBeInTheDocument();
    expect(within(section).getByText('Planned completion')).toBeInTheDocument();
    // Derived from the two dates, nothing stored: 28 days is exactly four weeks.
    expect(within(section).getByText('4 weeks')).toBeInTheDocument();
  });

  /**
   * A column of em-dashes is a picture of the database schema, not of the project. An optional
   * field nobody filled in is dropped instead — and duration with it, since it has no source.
   */
  it('drops optional fields that are empty rather than rendering a dash', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Project');
    expect(within(section).queryByText('Description')).not.toBeInTheDocument();
    expect(within(section).queryByText('Planned start')).not.toBeInTheDocument();
    expect(within(section).queryByText('Duration')).not.toBeInTheDocument();
  });
});

describe('durationLabel', () => {
  const t = (key: 'durationWeeks' | 'daysCount', { count }: { count: number }) =>
    key === 'durationWeeks' ? `${count} weeks` : `${count} days`;

  it('reads whole weeks as weeks and anything else as days', () => {
    expect(durationLabel('2026-09-02', '2026-09-30', t)).toBe('4 weeks');
    expect(durationLabel('2026-09-01', '2026-09-30', t)).toBe('29 days');
  });

  it('has no answer without both dates, or for an inverted range', () => {
    expect(durationLabel(null, '2026-09-30', t)).toBeNull();
    expect(durationLabel('2026-09-30', '2026-09-01', t)).toBeNull();
  });
});

describe('ProjectDetail — commercial', () => {
  const contract = {
    id: 'contract-1',
    contractNumber: 'CTR-001',
    status: 'ACTIVE' as const,
    startDate: null,
    expectedEndDate: null,
    contractValue: '12500000.00',
    currency: 'USD',
  };

  /**
   * Absence that means something is stated in business terms. "—" tells a reader a value is
   * missing; "Not created" tells them what has not happened yet, which is the actionable half.
   */
  it('says what has not happened yet instead of showing a dash', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Commercial');
    expect(within(section).getByText('Not created')).toBeInTheDocument();
    expect(within(section).getByText('Not started')).toBeInTheDocument();
    expect(within(section).getByText('Client contract')).toBeInTheDocument();

    // Contract value cannot exist before the contract does, so the row does not either.
    expect(within(section).queryByText('Contract value')).not.toBeInTheDocument();
  });

  /** USD only (ADR-024): the figure carries its currency, so there is no Currency row. */
  it('has no currency row', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({ mainContract: contract, financialsVisible: true }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Commercial');
    expect(within(section).queryByText('Currency')).not.toBeInTheDocument();
    expect(within(section).queryByText('USD')).not.toBeInTheDocument();
  });

  it('reports a working BOQ as unbaselined rather than as done', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        setup: {
          identityComplete: true,
          boqExists: true,
          boqBaselined: false,
          mainContractApplicable: true,
          mainContractExists: false,
          teamReady: false,
          completedSteps: 1,
          totalSteps: 4,
        },
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Commercial');
    expect(within(section).getByText('Working')).toBeInTheDocument();
  });

  it('links to the contract in the Commercial workspace, and shows its value, once one exists', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({ mainContract: contract, financialsVisible: true }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, {
      permissions: ['view:project', 'view:contract'],
      withToast: true,
    });

    const section = await railSection('Commercial');
    // Straight to the page, not through the contract-security redirect.
    expect(within(section).getByRole('link', { name: 'CTR-001' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract',
    );
    expect(within(section).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial',
    );
    expect(within(section).getByText('$12,500,000.00')).toBeInTheDocument();
  });

  /**
   * Money-blind roles (ADR-029): the server nulls the figure and says so. The row shows the
   * hidden state — never $0.00, never a blank — and no link into a tab the reader cannot open.
   */
  it('shows contract value as hidden, not $0, to a money-blind reader', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        mainContract: { ...contract, contractValue: null },
        financialsVisible: false,
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    const section = await railSection('Commercial');
    expect(within(section).getByText('Contract value')).toBeInTheDocument();
    expect(within(section).getByText('Hidden by permission')).toBeInTheDocument();
    expect(within(section).getByTitle('Hidden by permission')).toHaveTextContent('—');
    expect(within(section).queryByText(/\$0/)).not.toBeInTheDocument();
    expect(within(section).getByText('CTR-001')).not.toHaveAttribute('href');
    expect(within(section).queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — latest activity', () => {
  const event = (
    id: string,
    command: string,
    name = 'System Admin',
    resourceType = 'Project',
    action = 'UPDATE',
  ) => ({
    id,
    action,
    sourceCommand: command,
    command,
    resourceType,
    resourceId: 'p1',
    occurredAt: '2026-09-04T09:42:00.000Z',
    actor: { id: 'u1', name },
  });

  it('reads as a compact feed: who, what, when — three at most, no machine codes', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        recentActivity: [
          event('a1', 'project.create', 'Ahmed Warsame'),
          event('a2', 'project.update'),
          event('a3', 'project.suspend'),
          event('a4', 'project.resume'),
          event('a5', 'project.some-future-command'),
        ],
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Latest activity');
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).getByText('Project created')).toBeInTheDocument();
    expect(within(section).getByText('Ahmed Warsame')).toBeInTheDocument();
    expect(within(section).queryByText('Project resumed')).not.toBeInTheDocument();
    expect(within(section).queryByText(/project\./)).not.toBeInTheDocument();
  });

  it('labels events from other records by what they are, and unknown ones by their resource', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        recentActivity: [
          event('a1', 'contract.record-signed', 'Asha Ali', 'Contract'),
          event('a2', 'project.start', 'Asha Ali', 'Project', 'WAIVE'),
          event('a3', 'contract.some-future-command', 'Asha Ali', 'ContractGuarantee'),
        ],
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    const section = await railSection('Latest activity');
    expect(within(section).getByText('Signed contract recorded')).toBeInTheDocument();
    expect(within(section).getByText('Start condition waived')).toBeInTheDocument();
    expect(within(section).getByText('Contract changed')).toBeInTheDocument();
    expect(within(section).queryByText(/contract\./)).not.toBeInTheDocument();
  });

  /**
   * "View all" is the project's own history — any project member may open it (the server
   * filters what they see). It is no longer a link to the organisation audit log.
   */
  it('opens the full project history for any member, a page at a time', async () => {
    const user = userEvent.setup();
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({ recentActivity: [event('a1', 'project.create')] }),
    );
    vi.mocked(getProjectActivity)
      .mockResolvedValueOnce({
        items: [
          event('h1', 'boq.commit', 'Omar Nur', 'Boq'),
          event('h2', 'project.addMember', 'Omar Nur', 'ProjectMember'),
        ],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [event('h3', 'project.create', 'Ahmed Warsame')],
        nextCursor: null,
      });

    renderWithProviders(<ProjectDetail id="p1" />, {
      permissions: ['view:project'],
      withToast: true,
    });
    const section = await railSection('Latest activity');
    expect(within(section).queryByRole('link', { name: 'View all' })).not.toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'View all' }));

    const sheet = within(await screen.findByRole('dialog', { name: 'Project activity' }));
    expect(await sheet.findByText('BOQ committed')).toBeInTheDocument();
    expect(sheet.getByText('Team member added')).toBeInTheDocument();
    expect(getProjectActivity).toHaveBeenCalledWith('p1', undefined);

    await user.click(sheet.getByRole('button', { name: 'Load more' }));
    expect(await sheet.findByText('Project created')).toBeInTheDocument();
    expect(getProjectActivity).toHaveBeenLastCalledWith('p1', 'cursor-1');
    expect(sheet.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(sheet.getByText('That is everything recorded so far.')).toBeInTheDocument();
  });

  it('does not fetch the full history until it is asked for', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({ recentActivity: [event('a1', 'project.create')] }),
    );
    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });
    await railSection('Latest activity');
    expect(getProjectActivity).not.toHaveBeenCalled();
  });

  it('says so when nothing has happened yet', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    expect(
      await screen.findByText('No project activity has been recorded yet.'),
    ).toBeInTheDocument();
  });
});

/**
 * The lifecycle commands moved to the workspace shell, so they reach the reader on BOQ and
 * Procurement too rather than on Overview alone. Overview must not grow a second copy.
 */
describe('ProjectDetail — actions belong to the shell', () => {
  it('renders no lifecycle controls of its own', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    await screen.findByRole('heading', { name: 'Before you start' });
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — arriving from create', () => {
  it('confirms the new project with the app toast, once', async () => {
    searchParams = new URLSearchParams('created=1');
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));
    renderWithProviders(<ProjectDetail id="p1" />, { withToast: true });

    expect(await screen.findByText('Project created')).toBeInTheDocument();
    searchParams = new URLSearchParams();
  });
});
