import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
  CommercialApplicationRow,
  CommercialApplicationsResponse,
  CommercialSummaryResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { getCommercialApplications } from '../api/commercial-api';

import { ApplicationsTab } from './applications-tab';

vi.mock('../api/commercial-api', () => ({
  getCommercialApplications: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function row(overrides: Partial<CommercialApplicationRow> = {}): CommercialApplicationRow {
  return {
    ipaId: 'ipa-1',
    applicationNumber: 3,
    applicationRef: 'IPA-0003',
    ipaStatus: 'SUBMITTED',
    periodFrom: '2026-02-01T00:00:00.000Z',
    periodTo: '2026-02-28T00:00:00.000Z',
    claimedAmount: '100000.00',
    ipcId: null,
    ipcStatus: null,
    certifiedGross: null,
    deductions: null,
    certifiedNet: null,
    supersededCertificateCount: 0,
    invoiceId: null,
    invoiceNumber: null,
    invoiceDocumentStatus: null,
    invoicePostingStatus: null,
    invoicedAmount: null,
    receivedAmount: null,
    outstandingAmount: null,
    settlement: 'UNINVOICED',
    nextAction: 'REVIEW_APPLICATION',
    ...overrides,
  };
}

function applications(
  rows: CommercialApplicationRow[],
): CommercialApplicationsResponse {
  return {
    projectId: 'p-1',
    contractId: 'c-1',
    financialsVisible: true,
    applications: rows,
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
      canCreateApplication: true,
      canManageApplication: true,
      canReviewApplication: true,
      canIssueCertificate: true,
      canGenerateInvoice: false,
      canPostInvoice: false,
      canManageGuarantee: false,
      canRecordReceipt: false,
      canAllocateReceipt: false,
    },
    asOf: '2026-08-26T00:00:00.000Z',
  };
}

function summary(): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    contractValue: null,
    mainContract: null,
    metrics: {} as CommercialSummaryResponse['metrics'],
    certification: { applicationsSubmitted: 1, effectiveCertificates: 1, postedInvoices: 0 },
    receivables: { collectionRate: 0, outstandingInvoices: [] },
    retention: { retentionRate: '0.05', retentionCap: '0.10', retentionSplitOnPC: '0.5' },
    advances: [],
    guarantees: [],
    attention: [],
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
      canCreateApplication: true,
      canManageApplication: true,
      canReviewApplication: true,
      canIssueCertificate: true,
      canGenerateInvoice: false,
      canPostInvoice: false,
      canManageGuarantee: false,
      canRecordReceipt: false,
      canAllocateReceipt: false,
    },
    recentActivity: [],
    asOf: '2026-08-26T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.mocked(getCommercialApplications).mockReset();
});

describe('ApplicationsTab — A1 certificate column never leaks a cuid', () => {
  it('shows a human certificate state, never the raw ipcId, when a certificate exists', async () => {
    vi.mocked(getCommercialApplications).mockResolvedValue(
      applications([
        row({ ipcId: 'cmssv27jp004wtgaosje3ajxc', ipcStatus: 'CERTIFIED', certifiedNet: '90000.00' }),
      ]),
    );

    renderWithProviders(<ApplicationsTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    // Read the certificate cell directly (its column header also reads "Certified"; scope to the row).
    const appCell = await screen.findByRole('cell', { name: 'IPA-0003' });
    const certCell = appCell.parentElement?.querySelectorAll('td')[3];
    expect(certCell).toHaveTextContent('Certified');
    // The raw database id must never reach the screen.
    expect(screen.queryByText('cmssv27jp004wtgaosje3ajxc')).not.toBeInTheDocument();
  });

  it('renders an em-dash, not a blank or an id, when no certificate has been issued', async () => {
    vi.mocked(getCommercialApplications).mockResolvedValue(
      applications([row({ ipcId: null, ipcStatus: null })]),
    );

    renderWithProviders(<ApplicationsTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    // The application ref renders, and the certificate cell is an em-dash.
    expect(await screen.findByText('IPA-0003')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
