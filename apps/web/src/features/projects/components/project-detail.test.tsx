import { ProjectStatus } from '@erp/types';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import { getProject, getProjectWorkspaceSummary, getProjectReadiness } from '@/features/projects/api/projects-api';
import type { ProjectDetail as ProjectDetailModel, ProjectWorkspaceSummary } from '../types';

import { ProjectDetail } from './project-detail';

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
  vi.mocked(getProjectReadiness).mockResolvedValue({command: 'start', targetStatus: 'ACTIVE', ready: false, conditions: [{code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: false, detail: 'Baseline BOQ'}, {code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false, detail: 'Execute contract'}, {code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false, detail: 'Assign team'}], deferred: []});
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

/**
 * Overview is the one tab carrying project-level context, so the lifecycle rail lives here
 * rather than above every working tab.
 */
describe('ProjectDetail — project lifecycle', () => {
  it('renders the rail with every stage and marks the current one', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />);

    const rail = await screen.findByRole('list', { name: 'Project lifecycle' });
    expect(within(rail).getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      'Preparation',
      'Active',
      'Practical completion',
      'Closeout',
      'Closed',
    ]);

    const active = within(rail).getByText('Active');
    expect(active).toHaveClass('text-foreground');
    expect(active.closest('[aria-current="step"]')).not.toBeNull();
    // A passed stage carries the success colour, not the brand; an upcoming one is muted.
    expect(within(rail).getByText('Preparation')).toHaveClass('text-success');
    // An upcoming stage sits below full muted-foreground, so the rail reads as project
    // context rather than as a second row of tabs under the real one.
    expect(within(rail).getByText('Closed')).toHaveClass('text-muted-foreground/70');
  });

  it('drops the rail for a cancelled project, which left it rather than reaching a point on it', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.CANCELLED }));

    renderWithProviders(<ProjectDetail id="p1" />);

    await screen.findByRole('heading', { name: 'Project information' });
    expect(screen.queryByRole('list', { name: 'Project lifecycle' })).not.toBeInTheDocument();
  });

  // Lifecycle history has no endpoint behind it. A control that advertises one earns a
  // support question on every visit (ux-doctrine.md §4).
  it('offers no history control it cannot honour', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    await screen.findByRole('list', { name: 'Project lifecycle' });
    expect(screen.queryByText(/View history/i)).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — project readiness', () => {
  it('leads a draft with what is left to set up, above the identity facts', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    const readiness = await screen.findByRole('heading', { name: 'Project preparation' });
    const information = await screen.findByRole('heading', { name: 'Project information' });

    expect(readiness.compareDocumentPosition(information)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  /**
   * The steps are not peers — the contract is gated behind a baselined BOQ — so they read as
   * a checklist in dependency order, and the blocked one says so on its own row.
   */
  it('shows server conditions and their owner when the reader cannot act', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    renderWithProviders(<ProjectDetail id="p1" />);
    const section = (await screen.findByRole('heading', {name: 'Project preparation'})).closest('section')!;
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).queryByText('25%')).not.toBeInTheDocument();
    expect(within(section).getAllByText('Owner action needed')).toHaveLength(3);
    expect(within(section).queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses the readiness response instead of the legacy completed-step count', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectReadiness).mockResolvedValue({command: 'start', targetStatus: 'ACTIVE', ready: true, conditions: [], deferred: []});
    renderWithProviders(<ProjectDetail id="p1" />);
    expect(await screen.findByText('The current start conditions are satisfied. Record commencement to start the project.')).toBeInTheDocument();
  });

  /**
   * Once the project is running, the checklist is history. A permanent "4 of 4 complete" panel
   * is a monument to work finished months ago.
   */
  it('disappears entirely once the project is no longer in preparation', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />);

    await screen.findByRole('heading', { name: 'Project information' });
    expect(screen.queryByRole('heading', { name: 'Project preparation' })).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — project information', () => {
  /**
   * `PATCH /projects/:id` requires `manage:project`. The contextual Edit link is two conditions,
   * not one: a draft (lifecycle) read by someone who may write to it (authorization).
   */
  it('hides the contextual Edit link without manage:project', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { permissions: ['view:project'] });

    const section = (await screen.findByRole('heading', { name: 'Project information' })).closest(
      'section',
    )!;
    expect(within(section).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('offers it to a draft when the reader may write to it', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />, { permissions: ['manage:project'] });

    const section = (await screen.findByRole('heading', { name: 'Project information' })).closest(
      'section',
    )!;
    expect(within(section).getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/projects/p1/edit',
    );
  });

  /**
   * Identity is stated once, in the workspace header. Repeating the code and the client here
   * gives the reader two copies of the same fact to reconcile.
   */
  it('does not restate the facts the workspace header already carries', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({ status: ProjectStatus.ACTIVE, clientName: 'Baraka Real Estate LLC' }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (await screen.findByRole('heading', { name: 'Project information' })).closest(
      'section',
    )!;
    expect(within(section).queryByText('Project code')).not.toBeInTheDocument();
    expect(within(section).queryByText('ACCO-2026-001')).not.toBeInTheDocument();
    expect(within(section).queryByText('Client')).not.toBeInTheDocument();
    // Nor the strip facts that belong to the lifecycle rail and the progress card.
    expect(within(section).queryByText('Programme')).not.toBeInTheDocument();
    expect(within(section).queryByText('Current stage')).not.toBeInTheDocument();
    expect(within(section).queryByText('Project manager')).not.toBeInTheDocument();
  });

  it('renders the classification and delivery facts it does own', async () => {
    vi.mocked(getProject).mockResolvedValue(
      project({
        status: ProjectStatus.ACTIVE,
        participationModel: 'SOLE',
        location: 'Waaberi, Mogadishu',
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (await screen.findByRole('heading', { name: 'Project information' })).closest(
      'section',
    )!;
    expect(within(section).getByText('Sole delivery')).toBeInTheDocument();
    expect(within(section).getByText('Waaberi, Mogadishu')).toBeInTheDocument();
    // No category was ever assigned, so it reads as untyped rather than being invented.
    expect(within(section).getByText('Untyped')).toBeInTheDocument();
  });

  /**
   * A column of em-dashes is a picture of the database schema, not of the project. An optional
   * field nobody filled in is dropped instead.
   */
  it('drops optional fields that are empty rather than rendering a dash', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (await screen.findByRole('heading', { name: 'Project information' })).closest(
      'section',
    )!;
    expect(within(section).queryByText('Description')).not.toBeInTheDocument();
    expect(within(section).queryByText('Start date')).not.toBeInTheDocument();
    expect(within(section).queryByText('Location')).not.toBeInTheDocument();
  });
});

describe('ProjectDetail — commercial foundation', () => {
  /**
   * Absence that means something is stated in business terms. "—" tells a reader a value is
   * missing; "Not created" tells them what has not happened yet, which is the actionable half.
   */
  it('says what has not happened yet instead of showing a dash', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (
      await screen.findByRole('heading', { name: 'Commercial foundation' })
    ).closest('section')!;
    expect(within(section).getByText('Not created')).toBeInTheDocument();
    expect(within(section).getByText('Not started')).toBeInTheDocument();
    expect(within(section).getByText('Client contract')).toBeInTheDocument();
    expect(within(section).getByText('USD')).toBeInTheDocument();

    // Contract value cannot exist before the contract does, so the row does not either.
    expect(within(section).queryByText('Contract value')).not.toBeInTheDocument();
  });

  /**
   * The contract owns the currency — `toCreateProjectPayload` deliberately never sends one, so
   * `Project.currency` is NULL on everything the app creates. Before a contract exists there is
   * genuinely no answer, and the row is dropped rather than dashed or defaulted to USD. ACCO
   * being USD-only is a tenant fact, not a licence for the UI to state a currency nobody chose.
   */
  it('drops the currency row entirely when no contract has defined one', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ currency: null }));

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (
      await screen.findByRole('heading', { name: 'Commercial foundation' })
    ).closest('section')!;
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

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (
      await screen.findByRole('heading', { name: 'Commercial foundation' })
    ).closest('section')!;
    expect(within(section).getByText('Working')).toBeInTheDocument();
  });

  it('links to the contract in the Commercial workspace, and shows its value, once one exists', async () => {
    vi.mocked(getProject).mockResolvedValue(project({ status: ProjectStatus.ACTIVE }));
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        mainContract: {
          id: 'contract-1',
          contractNumber: 'CTR-001',
          status: 'ACTIVE',
          startDate: null,
          expectedEndDate: null,
          contractValue: '12500000.00',
          currency: 'USD',
        },
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (
      await screen.findByRole('heading', { name: 'Commercial foundation' })
    ).closest('section')!;
    expect(within(section).getByRole('link', { name: 'CTR-001' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract-security',
    );
    expect(within(section).getByText('$12,500,000.00')).toBeInTheDocument();
  });
});

describe('ProjectDetail — recent activity', () => {
  it('reads as a feed: what happened, then who and when', async () => {
    vi.mocked(getProject).mockResolvedValue(project());
    vi.mocked(getProjectWorkspaceSummary).mockResolvedValue(
      workspaceSummary({
        recentActivity: [
          {
            id: 'a1',
            action: 'CREATE',
            sourceCommand: 'project.create',
            occurredAt: '2026-09-04T09:42:00.000Z',
            actor: { id: 'u1', name: 'System Admin' },
          },
        ],
      }),
    );

    renderWithProviders(<ProjectDetail id="p1" />);

    const section = (await screen.findByRole('heading', { name: 'Recent activity' })).closest(
      'section',
    )!;
    expect(within(section).getByText('Project created')).toBeInTheDocument();
    expect(within(section).getByText(/System Admin/)).toBeInTheDocument();

    // The API returns five events and has no history endpoint behind them, so there is
    // nothing honest for a "View all" link to point at.
    expect(within(section).queryByText(/View all/i)).not.toBeInTheDocument();
  });

  it('says so when nothing has happened yet', async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    renderWithProviders(<ProjectDetail id="p1" />);

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

    renderWithProviders(<ProjectDetail id="p1" />);

    await screen.findByRole('heading', { name: 'Project preparation' });
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });
});
