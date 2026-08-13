import { screen } from '@testing-library/react';
import { ProjectStatus } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProjectWorkspaceShell } from './project-workspace-shell';

const push = vi.fn();
const useProject = vi.fn();
const useContracts = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/project-1',
  useRouter: () => ({ push }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/features/projects/hooks/use-project', () => ({ useProject: (...args: unknown[]) => useProject(...args) }));
vi.mock('@/features/contracts/hooks/use-contracts', () => ({ useContracts: (...args: unknown[]) => useContracts(...args) }));

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
  useContracts.mockReturnValue({
    data: [{
      id: 'contract-1',
      contractKind: 'CLIENT_CONTRACT',
      status: 'ACTIVE',
      contractValue: '12500000.00',
      currency: 'USD',
    }],
    isPending: false,
    isError: false,
  });
});

describe('ProjectWorkspaceShell', () => {
  it('presents project identity and uses the active main contract for the summary', () => {
    renderWithProviders(<ProjectWorkspaceShell id="project-1"><p>Workspace content</p></ProjectWorkspaceShell>);

    expect(screen.getByRole('heading', { name: 'Baraka Tower' })).toBeInTheDocument();
    expect(screen.getByText('Mogadishu')).toBeInTheDocument();
    expect(screen.getByText('Baraka Real Estate')).toBeInTheDocument();
    expect(screen.getByText('$12,500,000.00')).toBeInTheDocument();
    expect(screen.queryByText('$999,999.00')).not.toBeInTheDocument();
  });

  it('shows only implemented workspace destinations and groups the commercial flow', () => {
    renderWithProviders(<ProjectWorkspaceShell id="project-1"><p>Workspace content</p></ProjectWorkspaceShell>);

    expect(screen.getByRole('navigation', { name: 'Project navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Commercial/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Overview',
      'Scope & progress',
      'Contracts',
      'Applications & certificates',
      'Team',
    ]);
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });
});
