import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { BoqLibraryItem } from '../api/boq-item-library-api';

/**
 * The "Add from library" picker (ADR-020).
 *
 * These pin the fast-entry behaviour: a search result carries its assistive last-used rate
 * (labelled as such, never as a quote), picking one hands the whole item back to the caller so
 * the drawer can prefill, and the picker withholds the rate from a user without commercial
 * visibility.
 */

const mocks = vi.hoisted(() => ({ useLibrarySearch: vi.fn() }));
vi.mock('../hooks/use-boq-item-library', () => mocks);

import { BoqLibraryPicker } from './boq-library-picker';

const ITEM: BoqLibraryItem = {
  id: 'lib-1',
  organizationId: 'org-1',
  code: 'EXC-100',
  description: 'Bulk excavation in ordinary soil',
  defaultUnit: 'm3',
  measurementMethod: 'QUANTITY',
  pricingBasis: 'UNIT_RATE',
  category: 'Earthworks',
  lastUsedRate: '12.50',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  lastUsedProjectId: 'proj-9',
  active: true,
  createdBy: 'u-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function seed(state: Partial<ReturnType<typeof mocks.useLibrarySearch>> = {}) {
  mocks.useLibrarySearch.mockReturnValue({
    data: [ITEM],
    isPending: false,
    isError: false,
    ...state,
  });
}

describe('BoqLibraryPicker', () => {
  it('lists a library item with its assistive last-used rate', () => {
    seed();
    renderWithProviders(
      <BoqLibraryPicker currency="USD" canViewCommercials onPick={vi.fn()} />,
    );

    expect(screen.getByText('EXC-100')).toBeInTheDocument();
    expect(screen.getByText('Bulk excavation in ordinary soil')).toBeInTheDocument();
    // The rate is shown, labelled as the last-used rate — assistance, not authoritative.
    expect(screen.getByText(/\$12\.50/)).toBeInTheDocument();
  });

  it('hands the whole item back to the caller when picked, so the drawer can prefill', async () => {
    seed();
    const onPick = vi.fn();
    renderWithProviders(
      <BoqLibraryPicker currency="USD" canViewCommercials onPick={onPick} />,
    );

    await userEvent.click(screen.getByRole('option', { name: /EXC-100/ }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ITEM);
  });

  it('withholds the last-used rate from a user without commercial visibility', () => {
    seed();
    renderWithProviders(
      <BoqLibraryPicker currency="USD" canViewCommercials={false} onPick={vi.fn()} />,
    );

    // The item is still pickable — a description and unit are not commercial — but no rate.
    expect(screen.getByText('EXC-100')).toBeInTheDocument();
    expect(screen.queryByText(/\$12\.50/)).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a blank list when nothing matches', async () => {
    seed({ data: [] });
    renderWithProviders(
      <BoqLibraryPicker currency="USD" canViewCommercials onPick={vi.fn()} />,
    );

    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    await waitFor(() =>
      expect(screen.getByText(/No library items match/i)).toBeInTheDocument(),
    );
  });

  it('surfaces a load error rather than an empty list', () => {
    seed({ data: undefined, isError: true });
    renderWithProviders(
      <BoqLibraryPicker currency="USD" canViewCommercials onPick={vi.fn()} />,
    );

    expect(screen.getByText(/Could not search the item library/i)).toBeInTheDocument();
  });
});
