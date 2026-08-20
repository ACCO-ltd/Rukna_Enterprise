import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { OverviewTab } from './overview-tab';

function metric(
  state: CommercialSummaryResponse['metrics']['invoiced']['state'],
  amount: string | null,
) {
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
      contractValue: '1000000.00',
      currency: 'USD',
      billingModel: 'MEASURED_IPC',
      boqVersionNumber: 3,
    },
    metrics: {
      contractValue: metric('OK', '1000000.00'),
      certifiedGross: metric('OK', '500000.00'),
      certifiedNet: metric('ZERO', '0.00'),
      invoiced: metric('RESTRICTED', null),
      received: metric('OK', '200000.00'),
      outstanding: metric('OK', '300000.00'),
      uninvoicedCertified: metric('OK', '240000.00'),
    },
    certification: { applicationsSubmitted: 9, effectiveCertificates: 8, postedInvoices: 7 },
    receivables: { collectionRate: 82, outstandingInvoices: [] },
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
      canManageApplication: true,
      canReviewApplication: false,
      canIssueCertificate: false,
      canGenerateInvoice: false,
      canPostInvoice: false,
      canManageGuarantee: false,
      canRecordReceipt: false,
      canAllocateReceipt: false,
    },
    recentActivity: [],
    asOf: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('OverviewTab', () => {
  it('renders the summary metrics with a genuine zero and a restricted blank', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    // Labels appear twice by design — once as the headline in the summary strip, once as a
    // row in the panel that owns the record. Same fact, two altitudes.
    expect(screen.getAllByText('Contract Value').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0);
    // A genuine zero is a formatted value, not a blank.
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    // A restricted metric explains itself and never shows a number.
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
  });

  it('states the contract identity the panel is responsible for', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    expect(screen.getAllByText('CN-2026-001').length).toBeGreaterThan(0);
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('Progress certification')).toBeInTheDocument();
    // The baseline is immutable while the contract governs work — say it, do not offer Edit.
    expect(
      screen.getByText('Contract terms are locked while the contract is active.'),
    ).toBeInTheDocument();
  });

  it('shows the certification chain as counts', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  /** A closed contract is a record. The banner says so rather than leaving it to be inferred. */
  it('marks a terminal contract read-only', () => {
    const base = summary();
    renderWithProviders(
      <OverviewTab
        projectId="p-1"
        summary={{ ...base, mainContract: { ...base.mainContract!, status: 'CLOSED' } }}
      />,
      { permissions: ['view:contract', 'view:financial-position'] },
    );

    expect(
      screen.getByText('This contract is closed and commercially read-only.'),
    ).toBeInTheDocument();
  });

  /** allSettled on the server only pays off if the UI degrades per panel. */
  it('reports a failed metric in its own panel without losing the page', () => {
    const base = summary();
    renderWithProviders(
      <OverviewTab
        projectId="p-1"
        summary={{
          ...base,
          metrics: { ...base.metrics, invoiced: metric('FAILED', null) },
        }}
      />,
      { permissions: ['view:contract', 'view:financial-position'] },
    );

    expect(screen.getByText('Receivables could not be loaded.')).toBeInTheDocument();
    // The rest of the screen is untouched.
    expect(screen.getAllByText('CN-2026-001').length).toBeGreaterThan(0);
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

});
