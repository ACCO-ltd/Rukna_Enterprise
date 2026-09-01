import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import type { DraftSimulation } from '../api/workflows-api';

/**
 * The policy simulation panel.
 *
 * The point of the panel is that an author can see *why* a draft behaves as it does before
 * scheduling it — so the tests that matter are that a firing chain, an ambiguity warning, and
 * rejected rules with their reasons all render, and that an empty draft cannot be simulated.
 */

const hookMocks = vi.hoisted(() => ({
  useSimulateApprovalPolicyDraft: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

import { PolicySimulationPanel } from './policy-simulation-panel';

function mockSimulate(over: Partial<ReturnType<typeof mutationState>> = {}) {
  const state = { ...mutationState(), ...over };
  hookMocks.useSimulateApprovalPolicyDraft.mockReturnValue(state);
  return state;
}

function mutationState() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
    data: undefined as DraftSimulation | undefined,
  };
}

function result(overrides: Partial<DraftSimulation> = {}): DraftSimulation {
  return {
    policy: { id: 'p1', policyKey: 'PURCHASE_ORDER_APPROVAL', version: 1 },
    input: { transactionType: 'PURCHASE_ORDER', amount: '25000', fromState: 'DRAFT', toState: 'SUBMITTED' },
    matched: true,
    ambiguous: false,
    roleChain: [
      { ruleId: 'r1', ruleKey: 'PO_BAND_10K_50K_PM', priority: 100, requiredRole: 'PROCUREMENT_MANAGER' },
      { ruleId: 'r2', ruleKey: 'PO_BAND_10K_50K_CFO', priority: 200, requiredRole: 'CFO' },
    ],
    rejectedRules: [],
    notice: 'Simulation only. No approval instance or transaction was created.',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PolicySimulationPanel', () => {
  it('disables the run and prompts to add a rule when the draft is empty', () => {
    mockSimulate();
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules={false} />);

    expect(
      screen.getByText('This draft has no rules yet. Add a rule before simulating.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled();
  });

  it('runs a simulation for the pinned transition and amount', async () => {
    const state = mockSimulate();
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    await userEvent.type(screen.getByLabelText('Amount'), '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Run simulation' }));

    // Transition is pinned to the matrix pair, not free-texted, and amount is forwarded.
    expect(state.mutate).toHaveBeenCalledWith({
      id: 'p1',
      transactionType: 'MATERIAL_REQUEST',
      fromState: 'DRAFT',
      toState: 'SUBMITTED',
      amount: '25000',
    });
  });

  it('renders the firing rules as the resolved approval chain', () => {
    mockSimulate({ data: result() });
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    expect(screen.getByText('Approval chain')).toBeInTheDocument();
    expect(screen.getByText('PO_BAND_10K_50K_PM')).toBeInTheDocument();
    expect(screen.getByText('PROCUREMENT_MANAGER')).toBeInTheDocument();
    expect(screen.getByText('CFO')).toBeInTheDocument();
  });

  it('warns when the chain is ambiguous and explains why', () => {
    mockSimulate({ data: result({ ambiguous: true }) });
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    expect(screen.getByText('Ambiguous chain')).toBeInTheDocument();
    expect(screen.getByText(/share the same priority/i)).toBeInTheDocument();
  });

  it('reports no match rather than an empty chain', () => {
    mockSimulate({ data: result({ matched: false, roleChain: [] }) });
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    expect(
      screen.getByText(
        'No rule fires for this transaction. It would not be routed for approval by this policy.',
      ),
    ).toBeInTheDocument();
  });

  it('lists rejected rules with their reasons', () => {
    mockSimulate({
      data: result({
        rejectedRules: [
          { ruleId: 'r9', ruleKey: 'PO_BAND_0_10K', reasons: ['Amount is at or above 10000'] },
          { ruleId: 'r8', ruleKey: 'MR_DEFAULT', reasons: ['Transaction type does not match'] },
        ],
      }),
    });
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    expect(screen.getByText('Rules that did not fire')).toBeInTheDocument();
    expect(screen.getByText('PO_BAND_0_10K')).toBeInTheDocument();
    expect(screen.getByText('Amount is at or above 10000')).toBeInTheDocument();
    expect(screen.getByText('Transaction type does not match')).toBeInTheDocument();
  });

  it('surfaces a simulation failure', () => {
    mockSimulate({ isError: true });
    renderWithProviders(<PolicySimulationPanel policyId="p1" hasRules />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Could not run the simulation.')).toBeInTheDocument();
  });
});
