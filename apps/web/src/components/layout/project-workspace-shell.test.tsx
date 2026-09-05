import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectStatus } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProjectWorkspaceShell } from './project-workspace-shell';
import { openSelect } from '@/test/choose-option';

const push = vi.fn();
const useProject = vi.fn();
const useProjectWorkspaceSummary = vi.fn();

let pathname = '/projects/project-1';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
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

/** The header's action panel is exercised in its own suite; here it only has to mount. */
const inertMutation = () => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
});

vi.mock('@/features/projects/hooks/use-project', () => ({
  useProject: (...args: unknown[]) => useProject(...args),
  useProjectWorkspaceSummary: (...args: unknown[]) => useProjectWorkspaceSummary(...args),
  useAdvanceProject: () => inertMutation(),
  useCancelProject: () => inertMutation(),
  useSuspendProject: () => inertMutation(),
  useResumeProject: () => inertMutation(),
}));

/** The header's controls all call `manage:project` routes; seed it where they matter. */
const MANAGER = { permissions: ['manage:project'] };

const project = {
  id: 'project-1',
  organizationId: 'org-1',
  code: 'PRJ-000001',
  name: 'Baraka Tower',
  description: null,
  status: ProjectStatus.ACTIVE,
  contractValue: '999999.00',
  currency: 'USD',
  clientName: 'Baraka Real Estate',
  clientId: 'client-1',
  location: 'Mogadishu',
  commercialModel: 'CLIENT_CONTRACT',
  participationModel: 'SOLE',
  projectManager: 'Ahmed Hassan',
  startDate: '2026-08-05',
  expectedEndDate: '2028-10-14',
  createdBy: 'user-1',
  createdAt: '2026-08-01',
  updatedAt: '2026-08-01',
  members: [],
  suspensions: [],
};

const readySetup = {
  identityComplete: true,
  boqExists: true,
  boqBaselined: true,
  mainContractApplicable: true,
  mainContractExists: true,
  teamReady: true,
  completedSteps: 4,
  totalSteps: 4,
};

beforeEach(() => {
  push.mockReset();
  useProject.mockReturnValue({ data: project, isPending: false, isError: false, refetch: vi.fn() });
  useProjectWorkspaceSummary.mockReturnValue({
    data: {
      projectId: 'project-1',
      setup: readySetup,
      responsibility: { projectManager: { id: 'user-1', name: 'Ahmed Hassan' }, teamCount: 1 },
      programme: { startDate: '2026-08-05', expectedEndDate: '2028-10-14', daysRemaining: 793 },
      mainContract: {
        id: 'contract-1',
        status: 'ACTIVE',
        contractNumber: 'CTR-001',
        contractValue: '12500000.00',
        currency: 'USD',
        startDate: null,
        expectedEndDate: null,
      },
      financialsVisible: true,
      recentActivity: [],
    },
    isPending: false,
    isError: false,
  });
  pathname = '/projects/project-1';
});

describe('ProjectWorkspaceShell — identity', () => {
  it('states the project, its stage, and the three facts that identify it', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.getByRole('heading', { name: 'Baraka Tower' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('PRJ-000001')).toBeInTheDocument();
    expect(screen.getByText('Baraka Real Estate')).toBeInTheDocument();
    expect(screen.getByText('Mogadishu')).toBeInTheDocument();
    // Money never appears in the identity line.
    expect(screen.queryByText('$12,500,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$999,999.00')).not.toBeInTheDocument();
  });

  /**
   * The commercial model is configuration, not identity — it reads on Overview under
   * Commercial foundation, where the contract it configures also lives.
   */
  it('keeps configuration out of the identity line', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.queryByText('Client contract')).not.toBeInTheDocument();
  });

  /**
   * The lifecycle rail and the summary tiles moved to Overview. They are project-level
   * context, and repeating them above seven working tabs cost a row of vertical space on
   * every one of them — on BOQ it pushed the first row below the fold at 1440x900.
   */
  it('carries no lifecycle rail or summary tiles of its own', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.queryByRole('list', { name: 'Project lifecycle' })).not.toBeInTheDocument();
    expect(screen.queryByText('Programme')).not.toBeInTheDocument();
    expect(screen.queryByText('Current stage')).not.toBeInTheDocument();
    expect(screen.queryByText('CTR-001')).not.toBeInTheDocument();
  });

  /**
   * A construction project name is routinely a sentence — "Ministry of Health Regional
   * Headquarters Expansion". The header has to absorb that without pushing the actions off
   * screen, and whatever it clips has to stay reachable.
   */
  it('truncates long identity values without losing them', () => {
    const longName = 'Ministry of Health Regional Headquarters Expansion — Phase Two';
    useProject.mockReturnValue({
      data: {
        ...project,
        name: longName,
        clientName: 'Federal Government of Somalia, Ministry of Health and Human Services',
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    // The crumb clips, and says what it clipped.
    const crumb = within(
      screen.getByRole('navigation', { name: 'Project breadcrumb' }),
    ).getByRole('link', { name: longName });
    expect(crumb).toHaveClass('truncate');
    expect(crumb).toHaveAttribute('title', longName);

    // The title itself does not clip — it is the one place the whole name must read.
    const heading = screen.getByRole('heading', { name: longName });
    expect(heading).not.toHaveClass('truncate');

    // `min-w-0` is what actually lets a flex child ellipsize; without it the row just grows.
    const client = screen.getByTitle(
      'Federal Government of Somalia, Ministry of Health and Human Services',
    );
    expect(client).toHaveClass('min-w-0', 'truncate');
  });

  it('names the active tab in the breadcrumb, not always "Overview"', () => {
    pathname = '/projects/project-1/boq';

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    const crumbs = screen.getByRole('navigation', { name: 'Project breadcrumb' });
    expect(crumbs).toHaveTextContent('BOQ');
    expect(crumbs).not.toHaveTextContent('Overview');
  });
});

/**
 * The action set used to be portalled up from the Overview page, so the other seven tabs had
 * a header with nothing in it. It belongs to the shell.
 */
describe('ProjectWorkspaceShell — actions', () => {
  it('offers the project actions on a working tab, not only on Overview', () => {
    pathname = '/projects/project-1/boq';

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.getByRole('button', { name: 'Record practical completion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  it('hands readiness to the action panel, so an unfinished draft is offered its next step', () => {
    useProject.mockReturnValue({
      data: { ...project, status: ProjectStatus.DRAFT },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    useProjectWorkspaceSummary.mockReturnValue({
      data: {
        projectId: 'project-1',
        setup: { ...readySetup, boqBaselined: false, completedSteps: 1 },
        responsibility: { projectManager: null, teamCount: 1 },
        programme: { startDate: null, expectedEndDate: null, daysRemaining: null },
        mainContract: null,
        financialsVisible: true,
        recentActivity: [],
      },
      isPending: false,
      isError: false,
    });

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.getByRole('link', { name: /Continue setup/ })).toHaveAttribute(
      'href',
      '/projects/project-1/boq',
    );
    expect(screen.queryByRole('button', { name: 'Start project' })).not.toBeInTheDocument();
  });

  /**
   * A suspension blocks every lifecycle command, so its explanation follows the Resume button
   * onto every tab. A Resume button whose reason is one tab away is worse than no banner.
   */
  it('explains a suspension wherever the Resume button appears', () => {
    pathname = '/projects/project-1/procurement';
    useProject.mockReturnValue({
      data: {
        ...project,
        suspensions: [
          {
            id: 's1',
            projectId: 'project-1',
            reason: 'Awaiting site access clearance',
            suspendedAt: '2026-08-01T00:00:00.000Z',
            suspendedBy: 'user-1',
            resumedAt: null,
            resumedBy: null,
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.getByText('This project is suspended')).toBeInTheDocument();
    expect(screen.getByText('Awaiting site access clearance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
});

describe('ProjectWorkspaceShell — navigation', () => {
  it('keeps the menu and the tab row on opposite sides of the md breakpoint', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    // Asserted on the class because the failure is invisible to the DOM: both navigations
    // render either way, and only the breakpoint decides which one a viewport sees. Moving
    // this control off a native <select> once dropped its `md:hidden` and stacked the menu on
    // top of the tabs on every desktop.
    expect(screen.getByRole('combobox')).toHaveClass('md:hidden');

    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    const tabRow = within(nav).getByRole('link', { name: 'Overview' }).closest('div');
    expect(tabRow).toHaveClass('hidden', 'md:flex');
  });

  /**
   * One flat row of eight peers, ordered by the project's operating logic rather than by the
   * order the workspaces shipped: understand → scope → execute → earn → spend → financial
   * position → evidence → people. Procurement precedes Finance because procurement creates the
   * commitments, accruals and actuals Finance interprets.
   */
  it('orders the tabs by the project operating flow', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    expect(screen.getByRole('navigation', { name: 'Project navigation' })).toBeInTheDocument();
    await openSelect(user, screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Overview',
      'BOQ',
      'Progress',
      'Commercial',
      'Procurement',
      'Finance',
      'Documents',
      'Team',
    ]);
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
  });

  it('reaches the Commercial workspace directly rather than through a menu', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
      MANAGER,
    );

    // The workspace shipped unreachable: the shell had no Commercial tab at all, and its
    // dropdown pointed at the older /contracts, /ipc and /pl routes instead.
    const commercial = screen
      .getAllByRole('link', { name: /Commercial/ })
      .find((link) => link.getAttribute('href') === '/projects/project-1/commercial');
    expect(commercial).toBeDefined();
    expect(screen.queryByRole('button', { name: /Commercial/ })).not.toBeInTheDocument();
  });
});
