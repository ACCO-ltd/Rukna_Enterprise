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
const useProjectWorkspaceGuidance = vi.fn();

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

vi.mock('@/features/projects/hooks/use-project', () => ({
  useProject: (...args: unknown[]) => useProject(...args),
  useProjectWorkspaceSummary: (...args: unknown[]) => useProjectWorkspaceSummary(...args),
  useProjectWorkspaceGuidance: (...args: unknown[]) => useProjectWorkspaceGuidance(...args),
}));

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

beforeEach(() => {
  push.mockReset();
  useProject.mockReturnValue({ data: project, isPending: false, isError: false, refetch: vi.fn() });
  useProjectWorkspaceSummary.mockReturnValue({
    data: {
      projectId: 'project-1',
      setup: {
        identityComplete: true,
        boqExists: true,
        boqBaselined: true,
        mainContractApplicable: true,
        mainContractExists: true,
        teamReady: true,
        completedSteps: 4,
        totalSteps: 4,
      },
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
  useProjectWorkspaceGuidance.mockReturnValue({ data: [], isPending: false, isError: false });
  pathname = '/projects/project-1';
});

describe('ProjectWorkspaceShell', () => {
  it('presents project identity and uses the authoritative main contract reference', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.getByRole('heading', { name: 'Baraka Tower' })).toBeInTheDocument();
    expect(screen.getByText('Mogadishu')).toBeInTheDocument();
    expect(screen.getByText('Baraka Real Estate')).toBeInTheDocument();
    expect(screen.getByText('CTR-001')).toBeInTheDocument();
    expect(screen.queryByText('$12,500,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$999,999.00')).not.toBeInTheDocument();
  });

  /**
   * One flat row, no nesting. Commercial used to be a dropdown holding Contracts, Applications
   * & certificates and Finance — the only nested control in the bar, and a duplicate of the
   * Commercial workspace's own sub-navigation. Every tab here leads to a workspace that exists;
   * Programme & Progress, Procurement and Documents joined once theirs shipped (ADR-021/014).
   * Activity is deliberately absent — recent activity lives on Overview, not as its own tab.
   */
  it('keeps the menu and the tab row on opposite sides of the md breakpoint', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
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

  it('shows one flat row of implemented destinations', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.getByRole('navigation', { name: 'Project navigation' })).toBeInTheDocument();
    await openSelect(user, screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Overview',
      'BOQ',
      'Progress',
      'Commercial',
      'Finance',
      'Procurement',
      'Team',
      'Documents',
    ]);
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
  });

  it('reaches the Commercial workspace directly rather than through a menu', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    // The workspace shipped unreachable: the shell had no Commercial tab at all, and its
    // dropdown pointed at the older /contracts, /ipc and /pl routes instead.
    const commercial = screen
      .getAllByRole('link', { name: /Commercial/ })
      .find((link) => link.getAttribute('href') === '/projects/project-1/commercial');
    expect(commercial).toBeDefined();
    expect(screen.queryByRole('button', { name: /Commercial/ })).not.toBeInTheDocument();
  });

  /**
   * The project's headline facts belong to Overview. Repeating them above every working tab
   * gave the BOQ two visually identical tile rows — the project's and its own — and pushed
   * the first BOQ row below the fold at 1440x900. The lifecycle strip and the header above
   * still say which project this is and where it stands.
   */
  it('shows the project summary tiles on Overview', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.getByText('Main contract')).toBeInTheDocument();
    expect(screen.getByText('Programme')).toBeInTheDocument();
  });

  it('hides them on a working tab, where the feature brings its own', () => {
    pathname = '/projects/project-1/boq';

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.queryByText('Main contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Programme')).not.toBeInTheDocument();
    // Identity and lifecycle stay: losing those would be losing context, not decluttering.
    expect(screen.getByRole('heading', { name: 'Baraka Tower' })).toBeInTheDocument();
  });

  /**
   * The lifecycle is a compact inline stepper: every stage renders on one row as a dot +
   * label, and the semantics are carried by colour — completed (success), current (brand),
   * upcoming (muted). The project here is ACTIVE, so Preparation is complete, Active is the
   * current step, and the remaining stages are upcoming.
   */
  it('renders the lifecycle stepper with every stage and marks the current one', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    const stepper = screen.getByRole('list', { name: 'Current stage' });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Preparation',
      'Active',
      'Practical completion',
      'Closeout',
      'Closed',
    ]);

    // The current stage (ACTIVE) is announced as the current step and coloured with the brand.
    const active = within(stepper).getByText('Active');
    expect(active).toHaveClass('text-brand-primary');
    expect(active.closest('[aria-current="step"]')).not.toBeNull();

    // A passed stage carries the success colour, not the brand.
    const preparation = within(stepper).getByText('Preparation');
    expect(preparation).toHaveClass('text-success');

    // An upcoming stage is muted.
    const closed = within(stepper).getByText('Closed');
    expect(closed).toHaveClass('text-muted-foreground');
  });

  it('drops the lifecycle stepper for a cancelled project', () => {
    useProject.mockReturnValue({
      data: { ...project, status: ProjectStatus.CANCELLED },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.queryByRole('list', { name: 'Current stage' })).not.toBeInTheDocument();
  });
});
