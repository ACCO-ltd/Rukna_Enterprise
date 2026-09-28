import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommercialPreparePreviewResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import * as invoiceApi from '../api/commercial-invoice-api';
import { prepareTotals, taxMinor } from './prepare-invoice-dialog.model';
import { PrepareInvoiceDialog } from './prepare-invoice-dialog';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('../api/commercial-invoice-api', () => ({
  getPreparePreview: vi.fn(),
  preparePackage: vi.fn(),
}));

function makePreview(overrides: Partial<CommercialPreparePreviewResponse> = {}): CommercialPreparePreviewResponse {
  return {
    installmentId: 'inst-2',
    stageNumber: 2,
    stageCount: 4,
    stageName: 'Structure complete',
    percentage: '0.3000',
    releasedBy: {
      kind: 'MILESTONE',
      milestoneId: 'm-2',
      milestoneCode: 'M2',
      milestoneName: 'Frame topped out',
      verifiedAt: '2026-09-18T00:00:00.000Z',
    },
    blocker: null,
    currency: 'USD',
    stageAmount: '150000.00',
    variations: [
      {
        variationId: 'vo-3',
        reference: 'VO-03',
        title: 'Extra parking level',
        treatment: 'INVOICE',
        amount: '12000.00',
        defaultSelected: true,
      },
      {
        variationId: 'vo-4',
        reference: 'VO-04',
        title: 'Omit roof garden',
        treatment: 'STAGE_REDUCTION',
        amount: '-2000.00',
        defaultSelected: false,
      },
    ],
    taxRate: '0.05',
    ...overrides,
  };
}

function renderDialog(onClose = vi.fn()) {
  renderWithProviders(
    <PrepareInvoiceDialog projectId="p1" installmentId="inst-2" open onClose={onClose} />,
  );
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prepare-invoice-dialog.model — totals in minor units with the server rate', () => {
  it('rounds tax half away from zero to the cent', () => {
    expect(taxMinor(10001, '0.05')).toBe(500); // 500.05 → 500
    expect(taxMinor(10010, '0.05')).toBe(501); // 500.5 → 501
    expect(taxMinor(-10010, '0.05')).toBe(-501);
    expect(taxMinor(10000, null)).toBe(0);
  });

  it('adds selected lines (a reduction is negative) and applies the given rate — no hardcoded 5%', () => {
    expect(prepareTotals('150000.00', ['12000.00', '-2000.00'], '0.05')).toEqual({
      subtotal: '160000.00',
      tax: '8000.00',
      total: '168000.00',
    });
    expect(prepareTotals('100.00', [], '0.075')).toEqual({ subtotal: '100.00', tax: '7.50', total: '107.50' });
    expect(prepareTotals('100.00', [], null)).toEqual({ subtotal: '100.00', tax: null, total: '100.00' });
  });
});

describe('PrepareInvoiceDialog — creates a draft from the server preview', () => {
  it('shows the stage, what released it, and the totals with the server tax rate', async () => {
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(makePreview());
    renderDialog();

    expect(await screen.findByText('Structure complete')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 · 30% of the contract')).toBeInTheDocument();
    expect(screen.getByText('M2 Frame topped out')).toBeInTheDocument();
    expect(screen.getByText('Verified Sep 18, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sales tax 5%')).toBeInTheDocument();
    // 150,000 + VO-03 12,000 (ticked by default) = 162,000; tax 8,100.
    expect(screen.getByTestId('prepare-total')).toHaveTextContent('$170,100.00');
    expect(invoiceApi.getPreparePreview).toHaveBeenCalledWith('p1', 'inst-2');
  });

  it('an advance says it is billable while the contract is active', async () => {
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(
      makePreview({ releasedBy: { kind: 'ADVANCE' }, variations: [] }),
    );
    renderDialog();
    expect(
      await screen.findByText('Advance — billable while the contract is active'),
    ).toBeInTheDocument();
  });

  it('variation toggles change the total using the server tax rate', async () => {
    const user = userEvent.setup();
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(makePreview({ taxRate: '0.1' }));
    renderDialog();

    const total = await screen.findByTestId('prepare-total');
    expect(total).toHaveTextContent('$178,200.00'); // (150,000 + 12,000) × 1.1

    await user.click(screen.getByRole('checkbox', { name: /VO-03/ }));
    expect(total).toHaveTextContent('$165,000.00'); // 150,000 × 1.1

    await user.click(screen.getByRole('checkbox', { name: /VO-04/ }));
    expect(total).toHaveTextContent('$162,800.00'); // (150,000 − 2,000) × 1.1
    expect(screen.getByText('Reduces this stage')).toBeInTheDocument();
  });

  it('a blocked stage is explained in words and offers no primary', async () => {
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(
      makePreview({
        blocker: 'MILESTONE_NOT_VERIFIED',
        releasedBy: {
          kind: 'MILESTONE',
          milestoneId: 'm-2',
          milestoneCode: 'M2',
          milestoneName: 'Frame topped out',
          verifiedAt: null,
        },
      }),
    );
    renderDialog();

    expect(await screen.findByText("This stage can't be invoiced yet")).toBeInTheDocument();
    expect(screen.getByText(/hasn't been verified yet/)).toBeInTheDocument();
    expect(screen.getByText('Not verified yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create draft invoice' })).not.toBeInTheDocument();
    // The footer's Close plus the dialog's own close control.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  });

  it('create: sends the ticked variations, then opens the draft invoice page', async () => {
    const user = userEvent.setup();
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(makePreview());
    vi.mocked(invoiceApi.preparePackage).mockResolvedValue({ invoiceId: 'inv-9', invoiceIds: ['inv-9', 'inv-10'] });
    const onClose = renderDialog();

    const dialog = await screen.findByRole('dialog', { name: 'Prepare invoice' });
    await within(dialog).findByText('Structure complete');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft invoice' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p1/commercial/invoices/inv-9'));
    expect(invoiceApi.preparePackage).toHaveBeenCalledWith('p1', 'inst-2', { selectedVariationIds: ['vo-3'] });
    expect(onClose).toHaveBeenCalled();
  });

  it('money-blind: stage amount is hidden and there are no totals — never $0', async () => {
    vi.mocked(invoiceApi.getPreparePreview).mockResolvedValue(
      makePreview({
        stageAmount: null,
        variations: [{ ...makePreview().variations[0]!, amount: null }],
      }),
    );
    renderDialog();
    expect(await screen.findByText('Amounts are hidden for your role.')).toBeInTheDocument();
    expect(screen.queryByTestId('prepare-total')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('renders nothing without a stage', () => {
    renderWithProviders(<PrepareInvoiceDialog projectId="p1" installmentId={null} open onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
