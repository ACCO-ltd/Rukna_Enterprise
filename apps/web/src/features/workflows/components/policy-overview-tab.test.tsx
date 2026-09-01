import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';

import type { ApprovalPolicyDetail } from '../api/workflows-api';

/**
 * The Overview tab — the read the retired builder sheet never had.
 *
 * Locks that the details render, the quick-stats metric strip reflects rule / SoD / validation
 * / bound-trigger counts, the version roster marks the current version and offers Compare +
 * Clone, and the linked-bindings note (read-only by design) is always present.
 */

const versionsMock = vi.hoisted(() => ({
  useApprovalPolicyVersions: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => versionsMock);

const bindingsMock = vi.hoisted(() => ({ useWorkflowBindings: vi.fn() }));
vi.mock('../hooks/use-workflow-bindings', () => bindingsMock);

import { PolicyOverviewTab } from './policy-overview-tab';

function query<T>(over: Partial<{ data: T; isPending: boolean; isError: boolean }> = {}) {
  return { data: undefined, isPending: false, isError: false, ...over } as never;
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
    ruleCount: 2,
    updatedAt: '2026-08-12T09:14:00.000Z',
    rules: [
      {
        id: 'r1',
        ruleKey: 'PO_BAND_0_10K',
        transactionType: 'PURCHASE_ORDER',
        priority: 0,
        status: 'ACTIVE',
        configuration: { requiredRole: 'Buyer' },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bindingsMock.useWorkflowBindings.mockReturnValue(query({ data: [] }));
  versionsMock.useApprovalPolicyVersions.mockReturnValue(
    query({
      data: {
        policyKey: 'PURCHASE_ORDER_APPROVAL',
        versions: [
          { id: 'p1', version: 3, status: 'DRAFT', ruleCount: 1 },
          { id: 'p0', version: 2, status: 'ACTIVE', ruleCount: 1 },
        ],
      },
    }),
  );
});

describe('PolicyOverviewTab', () => {
  it('renders the details and the quick-stats metric strip', () => {
    renderWithProviders(
      <PolicyOverviewTab
        detail={policy()}
        editable
        sodActiveCount={2}
        boundTriggerCount={1}
        validation={{ valid: true, ruleCount: 1, issues: [] }}
        onCompareVersions={vi.fn()}
        onCloneVersion={vi.fn()}
      />,
      { permissions: ['view:workflow'] },
    );

    expect(screen.getByText('PO gross (USD)')).toBeInTheDocument();
    // The validation word reflects a passing draft.
    expect(screen.getByText('Draft valid — ready to submit.')).toBeInTheDocument();
    // The always-present read-only bindings note.
    expect(
      screen.getByText(/Managing bindings is withheld by design/),
    ).toBeInTheDocument();
  });

  it('marks the current version and offers Clone on the others', () => {
    const onClone = vi.fn();
    renderWithProviders(
      <PolicyOverviewTab
        detail={policy()}
        editable
        sodActiveCount={0}
        boundTriggerCount={0}
        validation={undefined}
        onCompareVersions={vi.fn()}
        onCloneVersion={onClone}
      />,
      { permissions: ['view:workflow'] },
    );

    expect(screen.getByText('You are here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone → new draft' })).toBeInTheDocument();
  });
});
