import type { BoqVersionSummary } from '@erp/types';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BoqStatusBar } from './boq-status-bar';

function version(overrides: Partial<BoqVersionSummary> = {}): BoqVersionSummary {
  return {
    id: 'v1',
    boqId: 'boq-1',
    versionNumber: 1,
    status: 'DRAFT',
    createdBy: 'user-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    totalAmount: '5000.00',
    itemCount: 1,
    isContractBaseline: false,
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof BoqStatusBar>[0]> = {}) {
  renderWithProviders(
    <BoqStatusBar
      version={version()}
      revision={null}
      currency="USD"
      sectionCount={1}
      itemCount={4}
      pricedCount={3}
      contractBaseline={null}
      contractMatchesApproved={false}
      canViewCommercials
      actions={null}
      {...overrides}
    />,
  );
}

/**
 * The version's state is a word the whole downstream chain depends on, so it has to be the
 * right word. "Approved" is a governance concept — someone signed it off. "Baselined" is the
 * version-control concept — this is the controlled scope the contract is measured against.
 * Collapsing the two left the panel saying "Approved" directly above "Baselined 5 Sep 2026".
 */
describe('BoqStatusBar — state naming', () => {
  it.each([
    ['DRAFT', 'Working'],
    ['BASELINED', 'Baselined'],
    ['SUPERSEDED', 'Superseded'],
    ['CANCELLED', 'Cancelled'],
  ] as const)('labels %s as %s', (status, label) => {
    render({ version: version({ status }) });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('never calls a baselined version "Approved"', () => {
    render({ version: version({ status: 'BASELINED' }) });

    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });
});

/**
 * Progress answers "how close are we to finishing pricing?", which is only a question about a
 * version someone can still work on. On a frozen version a 100% bar is a picture of work
 * finished months ago, sitting where the reader is asking "what *is* this baseline?".
 */
describe('BoqStatusBar — progress belongs to a draft', () => {
  it('reports pricing progress while the version is still being worked on', () => {
    render();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 items priced')).toBeInTheDocument();
  });

  it('drops the bar and the percentage once the version is frozen', () => {
    render({ version: version({ status: 'BASELINED' }), itemCount: 4, pricedCount: 4 });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    // The fact survives as a word — it is still worth knowing the bill was fully priced.
    expect(screen.getByText('Pricing complete')).toBeInTheDocument();
  });

  /**
   * A superseded or cancelled version can be frozen while incomplete. Saying "Pricing
   * complete" there would be false, so the count is shown instead.
   */
  it('states the count rather than completeness when a frozen version is not complete', () => {
    render({ version: version({ status: 'SUPERSEDED' }), itemCount: 4, pricedCount: 2 });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 4 items priced')).toBeInTheDocument();
    expect(screen.queryByText('Pricing complete')).not.toBeInTheDocument();
  });
});

/**
 * A contract can only reference a baselined version, so "not yet used" on a draft states a
 * rule rather than a fact about this project — and it was doing so on every new BOQ.
 */
describe('BoqStatusBar — contract usage', () => {
  it('says nothing about contract usage while the version is a draft', () => {
    render();

    expect(screen.queryByText(/main contract/i)).not.toBeInTheDocument();
  });

  it('reports an unused baseline in business terms', () => {
    render({ version: version({ status: 'BASELINED' }) });

    expect(screen.getByText('Not yet used by the main contract')).toBeInTheDocument();
  });

  it('names the version the contract actually points at', () => {
    render({
      version: version({ status: 'BASELINED' }),
      contractBaseline: version({ id: 'v1', status: 'BASELINED', isContractBaseline: true }),
      contractMatchesApproved: true,
    });

    expect(screen.getByText(/Contract baseline: Version 1/)).toBeInTheDocument();
  });
});
