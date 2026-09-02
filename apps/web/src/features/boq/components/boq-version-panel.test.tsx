import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoqVersionSummary } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { BoqVersionPanel } from './boq-version-panel';

/**
 * Progressive-disclosure versioning.
 *
 * The full version list + Compare used to sit always-open and compete with the build task. It
 * now lives behind a "Versions & history" disclosure — reachable in one interaction, hidden by
 * default so a first-time builder is not distracted. These pin that the list is gated by the
 * disclosure and that nothing versioning-related is removed, only deferred.
 */

function version(overrides: Partial<BoqVersionSummary> & { id: string }): BoqVersionSummary {
  return {
    id: overrides.id,
    boqId: 'b1',
    versionNumber: 1,
    status: 'BASELINED',
    notes: null,
    derivedFromVersionId: null,
    baselinedAt: '2026-01-02T00:00:00.000Z',
    baselinedBy: 'u-1',
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    totalAmount: '96000.00',
    itemCount: 3,
    isContractBaseline: false,
    ...overrides,
  } as BoqVersionSummary;
}

const VERSIONS = [
  version({ id: 'v1', versionNumber: 1, status: 'SUPERSEDED', totalAmount: '80000.00' }),
  version({
    id: 'v2',
    versionNumber: 2,
    status: 'BASELINED',
    derivedFromVersionId: 'v1',
    totalAmount: '96000.00',
    isContractBaseline: true,
  }),
];

function render(open: boolean, onToggle = vi.fn()) {
  renderWithProviders(
    <BoqVersionPanel
      versions={VERSIONS}
      selectedId="v2"
      currency="USD"
      canViewCommercials
      open={open}
      onToggle={onToggle}
      onSelect={vi.fn()}
      onCompare={vi.fn()}
    />,
  );
  return { onToggle };
}

describe('BoqVersionPanel — progressive disclosure', () => {
  it('collapses the version list by default so it does not compete with building', () => {
    render(false);

    // The disclosure control is present and reports collapsed.
    const toggle = screen.getByRole('button', { name: /versions & history/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // No version rows and no Compare while collapsed — nothing removed, just deferred.
    expect(screen.queryByText('Version 2')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^compare$/i })).not.toBeInTheDocument();
  });

  it('asks the workspace to open when the disclosure is clicked', async () => {
    const { onToggle } = render(false);

    await userEvent.click(screen.getByRole('button', { name: /versions & history/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reveals the full list, amounts and Compare once expanded', () => {
    render(true);

    expect(screen.getByRole('button', { name: /versions & history/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    // The derived version can be compared against its parent.
    expect(screen.getByRole('button', { name: /^compare$/i })).toBeInTheDocument();
    // Amounts are visible with commercial permission.
    expect(screen.getByText(/\$96,000\.00/)).toBeInTheDocument();
  });
});
