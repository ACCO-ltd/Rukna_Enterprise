import type { BoqMoneyBand } from '@erp/types';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BoqMoneyStrip } from './boq-money-strip';

/**
 * A COMMITTED band, commercial-exec tier (every figure present). The variants below null out
 * fields to model the visibility tiers, per the design's §5 table.
 */
function committedBand(overrides: Partial<BoqMoneyBand> = {}): BoqMoneyBand {
  return {
    lifeStage: 'COMMITTED',
    currency: 'USD',
    inContractTotal: '2412000.00',
    separateChargeTotal: '150000.00',
    baseContractValue: '2340000.00',
    contractValue: '2412000.00',
    contingencyReserve: '120000.00',
    contingencyRemaining: '78000.00',
    totalClientRevenue: '2562000.00',
    ...overrides,
  };
}

function workingBand(overrides: Partial<BoqMoneyBand> = {}): BoqMoneyBand {
  return {
    lifeStage: 'WORKING',
    currency: 'USD',
    inContractTotal: '2340000.00',
    separateChargeTotal: null,
    baseContractValue: null,
    contractValue: null,
    contingencyReserve: '120000.00',
    contingencyRemaining: '120000.00',
    totalClientRevenue: null,
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof BoqMoneyStrip>[0]> = {}) {
  return renderWithProviders(
    <BoqMoneyStrip
      band={committedBand()}
      currency="USD"
      pricedPercent={94}
      unpricedCount={0}
      signedContractValue="2340000.00"
      pendingVariationCount={0}
      {...overrides}
    />,
  );
}

describe('BoqMoneyStrip — life stage', () => {
  it('leads with the contract value headline when COMMITTED', () => {
    render({ band: committedBand() });
    expect(screen.getByText('Committed')).toBeInTheDocument();
    // Headline contract value present (USD formatting varies; assert the digits survive).
    expect(screen.getByText(/2,412,000/)).toBeInTheDocument();
  });

  it('shows the working total and % priced when WORKING', () => {
    render({ band: workingBand(), pricedPercent: 94, unpricedCount: 6 });
    expect(screen.getByText('Working · draft')).toBeInTheDocument();
    expect(screen.getByText(/2,340,000/)).toBeInTheDocument();
    expect(screen.getByText(/94% priced/)).toBeInTheDocument();
    expect(screen.getByText(/6 unpriced/)).toBeInTheDocument();
  });

  it('renders the Δ-vs-signed marker when the live value moved from the signed base', () => {
    render({ band: committedBand({ contractValue: '2412000.00', baseContractValue: '2340000.00' }) });
    // +72,000 delta, shown with a rise glyph.
    expect(screen.getByText(/72,000/)).toBeInTheDocument();
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });
});

describe('BoqMoneyStrip — visibility tiers', () => {
  it('cost tier (no margin): omits contract value, contingency $ and revenue — never a placeholder', () => {
    // canViewMargin false → the server nulls every margin figure; only cost figures remain.
    render({
      band: committedBand({
        contractValue: null,
        baseContractValue: null,
        contingencyReserve: null,
        contingencyRemaining: null,
        totalClientRevenue: null,
      }),
    });
    // Falls back to the labelled restricted state, not a blur or a zero.
    expect(screen.getByText('Money restricted')).toBeInTheDocument();
    expect(screen.queryByText(/2,412,000/)).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('operational tier (no money at all): shows only the state and the priced fact', () => {
    render({
      band: workingBand({
        inContractTotal: null,
        contingencyReserve: null,
        contingencyRemaining: null,
      }),
      pricedPercent: 80,
      unpricedCount: 12,
    });
    expect(screen.getByText('Working · draft')).toBeInTheDocument();
    expect(screen.getByText(/80% priced/)).toBeInTheDocument();
    // No money figure, and crucially no zero/placeholder standing in for a withheld one.
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});

describe('BoqMoneyStrip — pending variations (H1)', () => {
  it('shows a pending-variations affordance that is a live link, not a dead end', () => {
    const onReview = vi.fn();
    render({ pendingVariationCount: 2, onReviewVariations: onReview });
    const chip = screen.getByText(/2 variations pending approval/);
    expect(chip).toBeInTheDocument();
    chip.click();
    expect(onReview).toHaveBeenCalled();
  });

  it('hides the affordance when nothing is pending', () => {
    render({ pendingVariationCount: 0 });
    expect(screen.queryByText(/pending approval/)).not.toBeInTheDocument();
  });
});
