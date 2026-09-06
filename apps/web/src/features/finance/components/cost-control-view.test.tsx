import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProjectCostBudgetListResponse,
  ProjectProcurementCostResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Cost Control is the cost budget's home and the budget-versus-cost table.
 *
 * The states that matter are the lifecycle ones: a Baselined version is read-only, a Working
 * version is editable, a Superseded one is history — and none of them is ever called
 * "Approved", because the model has no approval step and naming one would re-create the fake
 * control this programme removed from journals.
 */
const costMocks = vi.hoisted(() => ({
  useProjectProcurementCost: vi.fn(),
  useProjectCostBudgets: vi.fn(),
  useCreateProjectCostBudget: vi.fn(),
  useUpdateProjectCostBudget: vi.fn(),
  useBaselineProjectCostBudget: vi.fn(),
  useDiscardProjectCostBudget: vi.fn(),
}));
const permMocks = vi.hoisted(() => ({ can: vi.fn(() => true) }));

vi.mock('@/features/procurement/hooks/use-project-procurement', () => costMocks);
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: permMocks.can, canAny: () => true, moduleVisible: () => true }),
}));

import { CostControlView } from './cost-control-view';

function cost(over: Partial<ProjectProcurementCostResponse> = {}): ProjectProcurementCostResponse {
  return {
    projectId: 'p1',
    financialsVisible: true,
    position: {
      currency: 'USD',
      committed: '350000.00',
      accrued: '337000.00',
      actual: '42000.00',
      committedToDate: '729000.00',
      budgetTotal: '990000.00',
      uncommittedBudget: '261000.00',
      budgetLessActual: '948000.00',
      committedOfBudgetPercent: 35.4,
      accruedOfBudgetPercent: 34,
      actualOfBudgetPercent: 4.2,
    },
    budgetVersion: 2,
    byBoq: [
      {
        kind: 'BOQ',
        boqNodeId: 'n1',
        code: '1',
        description: 'Preliminaries',
        depth: 0,
        hasChildren: false,
        budget: '120000.00',
        committed: '40000.00',
        accrued: '36000.00',
        actual: '8000.00',
        uncommittedBudget: '36000.00',
        committedOfBudgetPercent: 33.3,
        actualOfBudgetPercent: 6.7,
      },
      {
        kind: 'PROJECT_LEVEL',
        boqNodeId: null,
        code: null,
        description: 'Project-level (non-BOQ)',
        depth: 0,
        hasChildren: false,
        budget: '200000.00',
        committed: '40000.00',
        accrued: '31000.00',
        actual: '4000.00',
        uncommittedBudget: '125000.00',
        committedOfBudgetPercent: 20,
        actualOfBudgetPercent: 2,
      },
    ],
    bySupplier: [],
    byCategory: [],
    recentEntries: [],
    capabilities: { mayViewFinancials: true },
    asOf: '2026-09-06T00:00:00.000Z',
    ...over,
  } as ProjectProcurementCostResponse;
}

function budgets(
  over: Partial<ProjectCostBudgetListResponse> = {},
): ProjectCostBudgetListResponse {
  return {
    projectId: 'p1',
    baselined: {
      id: 'b2',
      projectId: 'p1',
      versionNumber: 2,
      status: 'BASELINED',
      currency: 'USD',
      notes: null,
      derivedFromId: 'b1',
      total: '990000.00',
      preparedBy: 'u1',
      baselinedAt: '2026-09-01T00:00:00.000Z',
      baselinedBy: 'u1',
      lines: [],
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    budgets: [
      {
        id: 'b2',
        projectId: 'p1',
        versionNumber: 2,
        status: 'BASELINED',
        currency: 'USD',
        notes: null,
        derivedFromId: 'b1',
        total: '990000.00',
        preparedBy: 'u1',
        baselinedAt: '2026-09-01T00:00:00.000Z',
        baselinedBy: 'u1',
        lineCount: 12,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'b1',
        projectId: 'p1',
        versionNumber: 1,
        status: 'SUPERSEDED',
        currency: 'USD',
        notes: null,
        derivedFromId: null,
        total: '900000.00',
        preparedBy: 'u1',
        baselinedAt: '2026-07-01T00:00:00.000Z',
        baselinedBy: 'u1',
        lineCount: 10,
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    ...over,
  } as ProjectCostBudgetListResponse;
}

const ready = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const idleMutation = () => ({ mutate: vi.fn(), isPending: false, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  permMocks.can.mockReturnValue(true);
  costMocks.useCreateProjectCostBudget.mockReturnValue(idleMutation());
  costMocks.useUpdateProjectCostBudget.mockReturnValue(idleMutation());
  costMocks.useBaselineProjectCostBudget.mockReturnValue(idleMutation());
  costMocks.useDiscardProjectCostBudget.mockReturnValue(idleMutation());
});

describe('CostControlView', () => {
  it('shows the cost stages against the budget, with named ratios', () => {
    costMocks.useProjectProcurementCost.mockReturnValue(ready(cost()));
    costMocks.useProjectCostBudgets.mockReturnValue(ready(budgets()));
    renderWithProviders(<CostControlView projectId="p1" />);

    expect(screen.getAllByText('Open commitment').length).toBeGreaterThan(0);
    // A bare "%" is a guessing game about which stage it divides.
    expect(screen.getByText('Actual / Budget 4.2%')).toBeInTheDocument();
    expect(screen.queryByText(/% used/i)).not.toBeInTheDocument();
  });

  /** Project-level cost is a deliberate classification, not a failure to code something. */
  it('names the project-level bucket rather than calling it other or unallocated', () => {
    costMocks.useProjectProcurementCost.mockReturnValue(ready(cost()));
    costMocks.useProjectCostBudgets.mockReturnValue(ready(budgets()));
    renderWithProviders(<CostControlView projectId="p1" />);

    expect(screen.getByText('Project-level (non-BOQ)')).toBeInTheDocument();
    expect(screen.queryByText('Unallocated')).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('offers a revision on a baselined budget, and never an edit', () => {
    costMocks.useProjectProcurementCost.mockReturnValue(ready(cost()));
    costMocks.useProjectCostBudgets.mockReturnValue(ready(budgets()));
    renderWithProviders(<CostControlView projectId="p1" />);

    expect(screen.getAllByText('Baselined').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create revision/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit working/i })).not.toBeInTheDocument();
    // Baselining is a freeze, not a governance approval.
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });

  it('offers editing on a working version, and not a second revision', () => {
    costMocks.useProjectProcurementCost.mockReturnValue(ready(cost()));
    costMocks.useProjectCostBudgets.mockReturnValue(
      ready(
        budgets({
          budgets: [
            {
              ...budgets().budgets[0]!,
              id: 'b3',
              versionNumber: 3,
              status: 'DRAFT',
              baselinedAt: null,
              baselinedBy: null,
            },
            ...budgets().budgets,
          ],
        }),
      ),
    );
    renderWithProviders(<CostControlView projectId="p1" />);

    expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /edit working version/i })).toBeInTheDocument();
    // Two drafts would mean two answers to "what are we about to baseline".
    expect(screen.queryByRole('button', { name: /create revision/i })).not.toBeInTheDocument();
  });

  it('hides every mutation control from a viewer who cannot manage the budget', () => {
    permMocks.can.mockReturnValue(false);
    costMocks.useProjectProcurementCost.mockReturnValue(ready(cost()));
    costMocks.useProjectCostBudgets.mockReturnValue(ready(budgets()));
    renderWithProviders(<CostControlView projectId="p1" />);

    // The figures still read; only the actions are gone.
    expect(screen.getAllByText('Open commitment').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /create revision/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit working/i })).not.toBeInTheDocument();
  });

  it('says no budget is set rather than showing a zero budget', () => {
    costMocks.useProjectProcurementCost.mockReturnValue(
      ready(
        cost({
          position: {
            ...cost().position,
            budgetTotal: null,
            uncommittedBudget: null,
            committedOfBudgetPercent: null,
            accruedOfBudgetPercent: null,
            actualOfBudgetPercent: null,
          },
          budgetVersion: null,
        }),
      ),
    );
    costMocks.useProjectCostBudgets.mockReturnValue(
      ready(budgets({ baselined: null, budgets: [] })),
    );
    renderWithProviders(<CostControlView projectId="p1" />);

    expect(screen.getByText('No cost budget has been set for this project.')).toBeInTheDocument();
    expect(screen.getAllByText('Not baselined').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});
