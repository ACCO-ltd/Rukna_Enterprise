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
    contractValue: null,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CN-2026-001',
      status: 'ACTIVE',
      clientName: 'ACCO',
      startDate: '2026-01-01T00:00:00.000Z',
      expectedEndDate: '2026-12-31T00:00:00.000Z',
      contractValue: '1000000.00',
      totalClientRevenue: '1000000.00',
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
    securityPosition: {
      applicable: true,
      retentionHeld: null,
      advanceRecovered: null,
      advanceOutstanding: null,
    },
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
  it('renders the contract position with a genuine zero and a restricted blank', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    expect(screen.getByText('Contract position')).toBeInTheDocument();
    expect(screen.getAllByText('Contract value').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0);
    // A genuine zero is a formatted value, not a blank.
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    // A restricted metric explains itself and never shows a number.
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
  });

  /**
   * Contract identity belongs to Contract & Security. The project shell above already names the
   * record, and Overview restating the contract number, client and dates is the duplication the
   * refinement removed — every fact stated once, in the section that owns it.
   */
  it('does not restate the contract identity the shell and Contract & Security own', () => {
    renderWithProviders(<OverviewTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    expect(screen.queryByText('CN-2026-001')).not.toBeInTheDocument();
    expect(screen.queryByText('Version 3')).not.toBeInTheDocument();
  });

  /**
   * CONST-VAR-006a — the single most important invariant on this screen: pending variation value
   * is reported beside the contract value, never inside it. The headline is the *governing*
   * value (original + client-approved), and no element may show the two added together.
   */
  it('keeps pending variations out of the contract value', () => {
    const base = summary();
    renderWithProviders(
      <OverviewTab
        projectId="p-1"
        summary={{
          ...base,
          contractValue: {
            originalContractValue: '1000000.00',
            approvedVariationsTotal: '25000.00',
            governingContractValue: '1025000.00',
            pendingVariations: '180000.00',
          },
        }}
      />,
      { permissions: ['view:contract', 'view:financial-position'] },
    );

    expect(screen.getByText('Pending variations')).toBeInTheDocument();
    expect(screen.getByText('Not in contract value')).toBeInTheDocument();
    expect(screen.getAllByText(/1,025,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/180,000/).length).toBeGreaterThan(0);
    // 1,025,000 + 180,000 must appear nowhere.
    expect(screen.queryByText(/1,205,000/)).not.toBeInTheDocument();
  });

  /**
   * ADR-023 CONST-COM-013/014 — a payment-schedule contract deducts no retention and recovers no
   * advance. "Not applicable" and "0.00 held" are different statements and only the first is true.
   */
  it('marks retention as not applicable on a milestone contract', () => {
    const base = summary();
    renderWithProviders(
      <OverviewTab
        projectId="p-1"
        summary={{
          ...base,
          mainContract: { ...base.mainContract!, billingModel: 'MILESTONE' },
          securityPosition: {
            applicable: false,
            retentionHeld: null,
            advanceRecovered: null,
            advanceOutstanding: null,
          },
        }}
      />,
      { permissions: ['view:contract', 'view:financial-position'] },
    );

    expect(screen.getByText('Retention held')).toBeInTheDocument();
    expect(screen.getAllByText('Not applicable').length).toBeGreaterThan(0);
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

  /** allSettled on the server only pays off if the UI degrades one figure at a time. */
  it('reports a failed metric in place without losing the page', () => {
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

    // A broken figure says so — it must never fall back to a zero, which would be a lie.
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    // The rest of the position is untouched.
    expect(screen.getAllByText('Collected').length).toBeGreaterThan(0);
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
