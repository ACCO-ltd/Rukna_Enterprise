import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';

import type { ApprovalPolicyDetail } from '../api/workflows-api';

/**
 * The Governance Builder workspace shell.
 *
 * Locks the lifecycle spine the retired sheet enforced, now relocated to a full-page workspace:
 *  - the header renders the policy key, a status badge and the lifecycle dots-and-connector bar;
 *  - the Simulation tab is PRESENT only on an editable draft and ABSENT otherwise (not disabled);
 *  - the one-primary lifecycle action per status is permission-gated exactly as before —
 *    `manage:workflow` submits a DRAFT, `publish:workflow` schedules / activates / retires;
 *  - a load error offers a route back to the inventory rather than a blank page.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/workflows/p1',
  useSearchParams: () => new URLSearchParams(),
}));

const hookMocks = vi.hoisted(() => ({
  useApprovalPolicy: vi.fn(),
  useApprovalPolicySodRules: vi.fn(),
  useValidateApprovalPolicyDraft: vi.fn(),
  useApprovalPolicyVersions: vi.fn(),
  useUpdateApprovalPolicyRule: vi.fn(),
  useDeleteApprovalPolicyRule: vi.fn(),
  useReorderApprovalPolicyRules: vi.fn(),
  useTransitionApprovalPolicy: vi.fn(),
  useCloneApprovalPolicy: vi.fn(),
  useApprovalPolicyComparison: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

const bindingsMock = vi.hoisted(() => ({ useWorkflowBindings: vi.fn() }));
vi.mock('../hooks/use-workflow-bindings', () => bindingsMock);

const rolesMock = vi.hoisted(() => ({ useRoles: vi.fn() }));
vi.mock('@/features/roles/hooks/use-roles', () => rolesMock);

import { GovernanceWorkspace } from './governance-workspace';

function query<T>(over: Partial<{ data: T; isPending: boolean; isError: boolean }> = {}) {
  return { data: undefined, isPending: false, isError: false, ...over } as never;
}

function mutation(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, data: undefined, ...over } as never;
}

function policy(over: Partial<ApprovalPolicyDetail> = {}): ApprovalPolicyDetail {
  return {
    id: 'p1',
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    version: 3,
    status: 'DRAFT',
    effectiveFrom: null,
    effectiveTo: null,
    amountBasis: 'PO gross (USD)',
    notes: null,
    ruleCount: 0,
    updatedAt: '2026-08-12T09:14:00.000Z',
    rules: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hookMocks.useApprovalPolicySodRules.mockReturnValue(query({ data: [] }));
  hookMocks.useValidateApprovalPolicyDraft.mockReturnValue(mutation());
  hookMocks.useApprovalPolicyVersions.mockReturnValue(query({ data: { policyKey: 'PURCHASE_ORDER_APPROVAL', versions: [] } }));
  hookMocks.useUpdateApprovalPolicyRule.mockReturnValue(mutation());
  hookMocks.useDeleteApprovalPolicyRule.mockReturnValue(mutation());
  hookMocks.useReorderApprovalPolicyRules.mockReturnValue(mutation());
  hookMocks.useTransitionApprovalPolicy.mockReturnValue(mutation());
  hookMocks.useCloneApprovalPolicy.mockReturnValue(mutation());
  hookMocks.useApprovalPolicyComparison.mockReturnValue(query());
  bindingsMock.useWorkflowBindings.mockReturnValue(query({ data: [] }));
  rolesMock.useRoles.mockReturnValue(query({ data: [] }));
});

describe('GovernanceWorkspace', () => {
  it('renders the record header — policy key, status badge and lifecycle stages', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy() }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow'],
    });

    expect(screen.getByRole('heading', { name: 'PURCHASE_ORDER_APPROVAL' })).toBeInTheDocument();
    // Lifecycle bar renders all five governed stages.
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });

  it('shows the Simulation tab on an editable draft', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy({ status: 'DRAFT' }) }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow', 'manage:workflow'],
    });

    expect(screen.getByRole('tab', { name: /Simulation/ })).toBeInTheDocument();
  });

  it('omits the Simulation tab on a published version (absent, not disabled)', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy({ status: 'ACTIVE' }) }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow', 'manage:workflow', 'publish:workflow'],
    });

    expect(screen.queryByRole('tab', { name: /Simulation/ })).not.toBeInTheDocument();
  });

  it('offers Submit for review on a DRAFT with manage:workflow', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy({ status: 'DRAFT' }) }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow', 'manage:workflow'],
    });

    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });

  it('hides Schedule from a viewer without publish:workflow on an IN_REVIEW version', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy({ status: 'IN_REVIEW' }) }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow', 'manage:workflow'],
    });

    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
  });

  it('offers Schedule with publish:workflow on an IN_REVIEW version', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ data: policy({ status: 'IN_REVIEW' }) }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow', 'publish:workflow'],
    });

    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('surfaces a load failure with a route back to the inventory', () => {
    hookMocks.useApprovalPolicy.mockReturnValue(query({ isError: true }));
    renderWithProviders(<GovernanceWorkspace policyId="p1" />, {
      permissions: ['view:workflow'],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to policies' })).toBeInTheDocument();
  });
});
