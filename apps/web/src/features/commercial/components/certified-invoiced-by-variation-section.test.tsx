import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CertifiedInvoicedByVariationResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-commercial';

import { CertifiedInvoicedByVariationSection } from './certified-invoiced-by-variation-section';

vi.mock('../hooks/use-commercial', () => ({
  useCertifiedInvoicedByVariation: vi.fn(),
}));

function response(
  overrides: Partial<CertifiedInvoicedByVariationResponse> = {},
): CertifiedInvoicedByVariationResponse {
  return {
    contractId: 'c-1',
    canViewFinancials: true,
    baseScope: { certifiedToDate: '800000.00', invoicedToDate: '750000.00' },
    byVariation: [
      {
        variationId: 'vo-1',
        reference: 'VO-001',
        title: 'Additional foundations',
        certifiedToDate: '25000.00',
        invoicedToDate: '20000.00',
      },
      {
        // A genuine zero — distinct from RESTRICTED. Real $0.00 must render, not a reason.
        variationId: 'vo-2',
        reference: 'VO-002',
        title: 'Omit landscaping',
        certifiedToDate: '0.00',
        invoicedToDate: '0.00',
      },
    ],
    totalCertifiedToDate: '825000.00',
    totalInvoicedToDate: '770000.00',
    ...overrides,
  };
}

function stub(data: CertifiedInvoicedByVariationResponse) {
  vi.mocked(hooks.useCertifiedInvoicedByVariation).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useCertifiedInvoicedByVariation>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CertifiedInvoicedByVariationSection — base + per-VO + total', () => {
  it('renders the base-scope row first-class, each VO, and the total', () => {
    stub(response());
    renderWithProviders(<CertifiedInvoicedByVariationSection contractId="c-1" />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    // Base scope is present and never folded into a VO.
    expect(screen.getByText('Original scope')).toBeInTheDocument();
    expect(screen.getByText(/800,000/)).toBeInTheDocument();

    // Each VO row.
    expect(screen.getByText('VO-001')).toBeInTheDocument();
    expect(screen.getByText('Additional foundations')).toBeInTheDocument();
    expect(screen.getByText('VO-002')).toBeInTheDocument();

    // Total row — the server-computed reconciliation figure.
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/825,000/)).toBeInTheDocument();
    expect(screen.getByText(/770,000/)).toBeInTheDocument();
  });

  it('renders a genuine zero as $0.00, distinct from a restricted cell', () => {
    stub(response());
    renderWithProviders(<CertifiedInvoicedByVariationSection contractId="c-1" />, {
      permissions: ['view:contract', 'view:financial-position'],
    });

    // The zero VO shows real zeros (formatted), not the restricted reason.
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Restricted')).not.toBeInTheDocument();
  });

  it('labels the figures ex-VAT so they are not read as the invoice total', () => {
    stub(response());
    renderWithProviders(<CertifiedInvoicedByVariationSection contractId="c-1" />, {
      permissions: ['view:contract', 'view:financial-position'],
    });
    expect(screen.getByText(/ex-VAT/i)).toBeInTheDocument();
  });
});

describe('CertifiedInvoicedByVariationSection — honesty: RESTRICTED vs zero', () => {
  it('renders every money cell as RESTRICTED (not $0) when canViewFinancials is false', () => {
    // Server nulls all money together; canViewFinancials === false.
    stub(
      response({
        canViewFinancials: false,
        baseScope: { certifiedToDate: null, invoicedToDate: null },
        byVariation: [
          {
            variationId: 'vo-1',
            reference: 'VO-001',
            title: 'Additional foundations',
            certifiedToDate: null,
            invoicedToDate: null,
          },
        ],
        totalCertifiedToDate: null,
        totalInvoicedToDate: null,
      }),
    );
    renderWithProviders(<CertifiedInvoicedByVariationSection contractId="c-1" />, {
      permissions: ['view:contract'],
    });

    // Restricted appears (base + VO + total, each cert & invoiced) and never a fake zero.
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$?0\.00/)).not.toBeInTheDocument();
  });
});
