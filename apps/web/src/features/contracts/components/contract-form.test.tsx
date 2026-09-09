import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ContractForm } from './contract-form';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  versions: [{ id: 'b1', status: 'BASELINED', versionNumber: 1 }],
  projects: [{ id: 'p1', name: 'Office tower', code: 'ACCO-001', clientId: 'c1' }],
  clients: [{ id: 'c1', name: 'Ministry of Works', code: 'CL-001' }],
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ projectId: 'p1' }),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: mocks.projects, isPending: false, isError: false }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ data: mocks.clients, isPending: false, isError: false }),
}));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: () => ({ data: { versions: mocks.versions }, isPending: false, isError: false }),
}));
vi.mock('../hooks/use-contracts', () => ({
  useCreateContract: () => ({ mutate: mocks.create, isPending: false, error: null }),
  useUpdateContract: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.versions = [{ id: 'b1', status: 'BASELINED', versionNumber: 1 }];
});
describe('Contract creation context', () => {
  it('inherits the project and client and selects the only eligible baseline', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContractForm />);
    expect(screen.getByText('Office tower')).toBeInTheDocument();
    expect(screen.getByText('Ministry of Works')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Client' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Contract number' }), 'CT-001');
    await user.type(screen.getByRole('textbox', { name: 'Contract value' }), '1000');
    await user.click(screen.getByRole('button', { name: 'Create contract' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', clientId: 'c1', boqVersionId: 'b1' }),
      ),
    );
  });
  it('requires an explicit BOQ choice when multiple baselines are eligible', async () => {
    mocks.versions.push({ id: 'b2', status: 'BASELINED', versionNumber: 2 });
    const user = userEvent.setup();
    renderWithProviders(<ContractForm />);
    await user.type(screen.getByRole('textbox', { name: 'Contract number' }), 'CT-002');
    await user.type(screen.getByRole('textbox', { name: 'Contract value' }), '1000');
    await user.click(screen.getByRole('button', { name: 'Create contract' }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('returns cancellation to the current project commercial workspace', () => {
    renderWithProviders(<ContractForm />);
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract-security',
    );
  });
});
