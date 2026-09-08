import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * ContractForm has two ways to learn its project (P3 Slice B):
 *
 *  - The workspace create route passes `projectId` as a prop. The project is fixed context, so
 *    the picker is replaced by a read-only fact and the value is carried in a hidden field — the
 *    user cannot (and need not) choose a project on a screen opened from inside one.
 *  - The legacy query-string entry reads `?projectId` and still shows the picker.
 *
 * These pin the lock behaviour and the workspace Cancel destination.
 */

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  useClients: vi.fn(),
  useBoqWorkspace: vi.fn(),
  useCreateContract: vi.fn(),
  useUpdateContract: vi.fn(),
  searchParamsGet: vi.fn(),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({ useProjects: mocks.useProjects }));
vi.mock('@/features/clients/hooks/use-clients', () => ({ useClients: mocks.useClients }));
vi.mock('@/features/boq/hooks/use-boq', () => ({ useBoqWorkspace: mocks.useBoqWorkspace }));
vi.mock('../hooks/use-contracts', () => ({
  useCreateContract: mocks.useCreateContract,
  useUpdateContract: mocks.useUpdateContract,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mocks.searchParamsGet }),
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

import { ContractForm } from './contract-form';

function loaded<T>(data: T) {
  return { data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
}

const PROJECT = { id: 'p-77', code: 'ACCO-WBR-26-0065', name: 'Waberi School', clientId: 'client-1' };
const CLIENT = { id: 'client-1', code: 'CL-01', name: 'Ministry of Education' };
const idle = { mutate: vi.fn(), isPending: false, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParamsGet.mockReturnValue(null);
  mocks.useProjects.mockReturnValue(loaded([PROJECT]));
  mocks.useClients.mockReturnValue(loaded([CLIENT]));
  mocks.useBoqWorkspace.mockReturnValue(loaded({ versions: [] }));
  mocks.useCreateContract.mockReturnValue(idle);
  mocks.useUpdateContract.mockReturnValue(idle);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractForm project lock (workspace create)', () => {
  it('hides the project picker and states the project when projectId is passed', () => {
    renderWithProviders(<ContractForm projectId="p-77" />);

    // No project dropdown — the project is fixed context, not a choice.
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    // The project is stated as a read-only fact instead.
    expect(screen.getByText(`${PROJECT.code} — ${PROJECT.name}`)).toBeInTheDocument();
  });

  it('routes Cancel back to the project Contract & Security tab when locked', () => {
    renderWithProviders(<ContractForm projectId="p-77" />);

    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/projects/p-77/commercial/contract-security',
    );
  });

  it('still shows the project picker on the legacy query-string entry', () => {
    mocks.searchParamsGet.mockReturnValue('p-77');

    renderWithProviders(<ContractForm />);

    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/contracts');
  });
});
