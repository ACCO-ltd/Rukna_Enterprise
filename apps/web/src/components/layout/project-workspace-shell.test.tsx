import { screen } from '@testing-library/react';
import { ProjectStatus } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProjectWorkspaceShell } from './project-workspace-shell';

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
  nameAr: null,
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
  it('shows one flat row of implemented destinations', () => {
    renderWithProviders(
      <ProjectWorkspaceShell id="project-1">
        <p>Workspace content</p>
      </ProjectWorkspaceShell>,
    );

    expect(screen.getByRole('navigation', { name: 'Project navigation' })).toBeInTheDocument();
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
});
