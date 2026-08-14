import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { WorkflowTriggerBinding } from '../types';

const hookMocks = vi.hoisted(() => ({ useWorkflowBindings: vi.fn() }));
vi.mock('../hooks/use-workflow-bindings', () => hookMocks);

import { GovernanceBindingsPanel } from './governance-bindings-panel';

function binding(overrides: Partial<WorkflowTriggerBinding> = {}): WorkflowTriggerBinding {
  return {
    id: 'b1',
    organizationId: 'o1',
    triggerKind: 'STATE_TRANSITION',
    entityType: 'SupplierBill',
    transactionType: 'SUPPLIER_BILL' as never,
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    workflowDefinitionId: 'wd1',
    priority: 100,
    isActive: true,
    definition: {
      id: 'wd1',
      organizationId: 'o1',
      transactionType: 'SUPPLIER_BILL' as never,
      name: 'Supplier Bill Approval',
      nameAr: 'موافقة فاتورة المورد',
      isActive: true,
      requiresCeoConfirmation: false,
      createdAt: '',
      updatedAt: '',
      conditions: [],
      steps: [
        {
          id: 's1',
          definitionId: 'wd1',
          stepOrder: 1,
          groupOrder: null,
          roleRequired: 'ADMIN',
          isOptional: false,
          escalateAfterHours: null,
          notifyRoles: [],
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GovernanceBindingsPanel', () => {
  it('shows each binding’s transition, chain, scope and active status', () => {
    hookMocks.useWorkflowBindings.mockReturnValue({ data: [binding()], isPending: false, isError: false });
    renderWithProviders(<GovernanceBindingsPanel />);

    expect(screen.getByText('SupplierBill')).toBeInTheDocument();
    expect(screen.getByText('DRAFT → SUBMITTED')).toBeInTheDocument();
    expect(screen.getByText('Supplier Bill Approval')).toBeInTheDocument();
    expect(screen.getByText('1 step')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('marks a tenant-default binding and an inactive one distinctly', () => {
    hookMocks.useWorkflowBindings.mockReturnValue({
      data: [binding({ id: 'b2', organizationId: null, isActive: false })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<GovernanceBindingsPanel />);

    expect(screen.getByText('Tenant default')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders an empty state rather than a bare table when nothing is configured', () => {
    hookMocks.useWorkflowBindings.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<GovernanceBindingsPanel />);

    expect(screen.getByText('No trigger bindings are configured.')).toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    hookMocks.useWorkflowBindings.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(<GovernanceBindingsPanel />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
