import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import { ContractCreateForm } from './contract-create-form';

/**
 * The minimal create form (ADR-030 S-CC-5): client + dates only. Value, number and BOQ version are
 * server-derived, so the form must NOT offer editable inputs for them, must send only the minimal
 * payload, and must gate the whole flow behind a committed BOQ.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createError: null as unknown,
  moneyBand: {
    lifeStage: 'COMMITTED',
    currency: 'USD',
    inContractTotal: '4500000.00',
    separateChargeTotal: null,
    baseContractValue: null,
    contractValue: null,
    contingencyReserve: null,
    contingencyRemaining: null,
    totalClientRevenue: null,
  } as Record<string, unknown> | null,
  projects: [{ id: 'p1', name: 'Office tower', code: 'ACCO-001', clientId: 'c1' }],
  clients: [{ id: 'c1', name: 'Ministry of Works', code: 'CL-001' }],
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: mocks.projects, isPending: false, isError: false }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ data: mocks.clients, isPending: false, isError: false }),
}));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: () => ({
    data: { moneyBand: mocks.moneyBand },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('../hooks/use-contracts', () => ({
  useCreateContract: () => ({
    mutate: mocks.create,
    isPending: false,
    error: mocks.createError,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createError = null;
  mocks.moneyBand = {
    lifeStage: 'COMMITTED',
    currency: 'USD',
    inContractTotal: '4500000.00',
    separateChargeTotal: null,
    baseContractValue: null,
    contractValue: null,
    contingencyReserve: null,
    contingencyRemaining: null,
    totalClientRevenue: null,
  };
});

describe('ContractCreateForm — minimal create (S-CC-5)', () => {
  it('inherits the project and client and shows the tie-out value read-only', () => {
    renderWithProviders(<ContractCreateForm projectId="p1" />);

    expect(screen.getByText('Office tower')).toBeInTheDocument();
    expect(screen.getByText('Ministry of Works')).toBeInTheDocument();
    // The committed-BOQ tie-out is presented, not typed.
    expect(screen.getByText('$4,500,000.00')).toBeInTheDocument();
    expect(screen.getByText('Assigned on create')).toBeInTheDocument();
  });

  it('offers no editable value, number or BOQ-version inputs', () => {
    renderWithProviders(<ContractCreateForm projectId="p1" />);

    expect(screen.queryByRole('textbox', { name: 'Contract number' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Contract value' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Contract value' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'BOQ version' })).not.toBeInTheDocument();
  });

  it('submits only the minimal payload — no value, number or version', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContractCreateForm projectId="p1" />);

    await user.click(screen.getByRole('button', { name: 'Create contract' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const [payload] = mocks.create.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      projectId: 'p1',
      clientId: 'c1',
      currency: 'USD',
      billingModel: 'MILESTONE',
    });
    expect(payload).not.toHaveProperty('contractValue');
    expect(payload).not.toHaveProperty('contractNumber');
    expect(payload).not.toHaveProperty('boqVersionId');
  });

  it('replaces the form with a commit-the-BOQ gate when the BOQ is not committed', () => {
    mocks.moneyBand = { ...mocks.moneyBand!, lifeStage: 'WORKING' };
    renderWithProviders(<ContractCreateForm projectId="p1" />);

    expect(screen.getByText('Commit the BOQ first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to the project BOQ/ })).toHaveAttribute(
      'href',
      '/projects/p1/boq',
    );
    // The gate stands in for the form — no submit button.
    expect(screen.queryByRole('button', { name: 'Create contract' })).not.toBeInTheDocument();
  });

  it('handles the server BOQ_NOT_COMMITTED refusal with the same gate', () => {
    // Committed money band on load, but the server refuses at submit (a race between the two). The
    // component reads `ApiError.code` and falls back to the same commit-the-BOQ dead-end.
    mocks.createError = new ApiError(400, 'no committed boq', 'BOQ_NOT_COMMITTED');

    renderWithProviders(<ContractCreateForm projectId="p1" />);

    expect(screen.getByText('Commit the BOQ first')).toBeInTheDocument();
  });

  it('returns cancellation to the project commercial contract tab', () => {
    renderWithProviders(<ContractCreateForm projectId="p1" />);
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract-security',
    );
  });
});
