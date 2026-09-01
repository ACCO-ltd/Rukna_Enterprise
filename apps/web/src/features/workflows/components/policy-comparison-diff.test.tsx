import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  ApprovalPolicyComparison,
  ApprovalPolicyVersionSummary,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { PolicyComparisonDiff } from './policy-comparison-diff';

function version(overrides: Partial<ApprovalPolicyVersionSummary> = {}): ApprovalPolicyVersionSummary {
  return {
    id: 'v1',
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    version: 1,
    status: 'ACTIVE',
    ruleCount: 2,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function comparison(overrides: Partial<ApprovalPolicyComparison> = {}): ApprovalPolicyComparison {
  return {
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    base: version({ id: 'base', version: 1 }),
    target: version({ id: 'target', version: 2, status: 'DRAFT' }),
    rules: { added: [], removed: [], changed: [] },
    sodRules: [],
    ...overrides,
  };
}

describe('PolicyComparisonDiff', () => {
  it('reports identical versions rather than an empty diff', () => {
    renderWithProviders(<PolicyComparisonDiff comparison={comparison()} />);
    expect(
      screen.getByText('These two versions have identical rules and segregation-of-duties settings.'),
    ).toBeInTheDocument();
  });

  it('renders an added rule under the added band', () => {
    renderWithProviders(
      <PolicyComparisonDiff
        comparison={comparison({
          rules: {
            added: [
              {
                ruleKey: 'PO_BAND_0_10K',
                transactionType: 'PURCHASE_ORDER',
                priority: 100,
                requiredRole: 'PROCUREMENT_MANAGER',
                minAmount: '0',
                maxAmount: '10000',
                fromState: 'DRAFT',
                toState: 'SUBMITTED',
              },
            ],
            removed: [],
            changed: [],
          },
        })}
      />,
    );
    expect(screen.getByText('Rules added')).toBeInTheDocument();
    expect(screen.getByText('PO_BAND_0_10K')).toBeInTheDocument();
    expect(screen.getByText('PROCUREMENT_MANAGER')).toBeInTheDocument();
  });

  it('renders a changed rule field before → after', () => {
    renderWithProviders(
      <PolicyComparisonDiff
        comparison={comparison({
          rules: {
            added: [],
            removed: [],
            changed: [
              {
                ruleKey: 'PO_BAND_10K_50K',
                changes: [{ field: 'requiredRole', base: 'CFO', target: 'CEO' }],
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('Rules changed')).toBeInTheDocument();
    expect(screen.getByText('CFO')).toBeInTheDocument();
    expect(screen.getByText('CEO')).toBeInTheDocument();
  });

  it('classifies an SoD rule present only on the target as added', () => {
    renderWithProviders(
      <PolicyComparisonDiff
        comparison={comparison({
          sodRules: [
            { code: 'PO_APPROVER_NOT_CREATOR', base: null, target: { description: 'x', isActive: true } },
          ],
        })}
      />,
    );
    expect(screen.getByText('Segregation of duties')).toBeInTheDocument();
    expect(screen.getByText('PO_APPROVER_NOT_CREATOR')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
  });
});
