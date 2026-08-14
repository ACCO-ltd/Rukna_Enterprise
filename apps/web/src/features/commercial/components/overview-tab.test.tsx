import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { OverviewTab } from './overview-tab';

function metric(state: CommercialSummaryResponse['metrics']['invoiced']['state'], amount: string | null) {
  return { state, amount, currency: 'USD', sourceCount: amount ? 1 : 0, drillTo: null, asOf: null };
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CN-2026-001',
      status: 'ACTIVE',
      clientName: 'ACCO',
      startDate: '2026-01-01T00:00:00.000Z',
      expectedEndDate: '2026-12-31T00:00:00.000Z',
    },
    metrics: {
      contractValue: metric('OK', '1000000.00'),
      certifiedGross: metric('OK', '500000.00'),
      certifiedNet: metric('ZERO', '0.00'),
      invoiced: metric('RESTRICTED', null),
      received: metric('OK', '200000.00'),
      outstanding: metric('OK', '300000.00'),
    },
    retention: { retentionRate: '0.05', retentionCap: '0.10', retentionSplitOnPC: '0.5' },
    advances: [],
    guarantees: [],
    attention: [
      {
        id: 'g-expiring',
        severity: 'WARNING',
        kind: 'GUARANTEE_EXPIRING',
        actionUrl: '/projects/p-1/commercial/guarantees',
        responsibleRole: 'COMMERCIAL_MANAGER',
        contextId: 'g-1',
      },
    ],
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: true,
      canCreateApplication: true,
      canReviewApplication: false,
      canIssueCertificate: false,
      canGenerateInvoice: false,
      canManageGuarantee: false,
    },
    recentActivity: [],
    asOf: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('OverviewTab', () => {
  it('renders the five summary metrics with a genuine zero and a restricted blank', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    expect(screen.getByText('Contract Value')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    // A genuine zero is a formatted value, not a blank.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    // A restricted metric explains itself and never shows a number.
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });

  it('surfaces attention items with their action', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract'],
    });
    expect(screen.getByText('Guarantee expiring soon')).toBeInTheDocument();
  });

  it('shows the no-contract empty state when there is no main contract', () => {
    renderWithProviders(
      <OverviewTab
        projectId="p-1"
        summary={summary({
          mainContract: null,
          attention: [
            {
              id: 'no-main-contract',
              severity: 'WARNING',
              kind: 'NO_MAIN_CONTRACT',
              actionUrl: null,
              responsibleRole: 'CONTRACT_ADMINISTRATOR',
              contextId: null,
            },
          ],
        })}
      />,
      { permissions: ['view:contract'] },
    );
    expect(screen.getByText('No main contract yet')).toBeInTheDocument();
  });

  it('renders in Arabic without any missing translation key', () => {
    // renderWithProviders throws on a missing key, so this asserts en/ar parity at runtime.
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      locale: 'ar',
      permissions: ['view:contract'],
    });
    expect(screen.getByText('قيمة العقد')).toBeInTheDocument();
  });
});
