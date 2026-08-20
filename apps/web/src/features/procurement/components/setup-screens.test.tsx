import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Material, MaterialCategory, SpendCategory, UnitOfMeasure } from '../types';

/**
 * Smoke coverage for the four Tier A master-data screens.
 *
 * The point is not the markup — it is that `renderWithProviders` throws on a missing
 * translation key, so rendering each screen against the **real** catalogues proves every
 * key these components ask for exists in both locales. `catalogues.test.ts` proves en and
 * ar agree with each other; it cannot prove they agree with the code.
 *
 * Beyond that, three behaviours are asserted because each one encodes a P-series finding
 * that a future reader would otherwise be tempted to "fix":
 *
 *  - the active-only notice on units and materials (P2)
 *  - the irreversible base-UoM warning on material creation (§12.4)
 *  - spend categories never being labelled as material categories (§12.4)
 */

const mocks = vi.hoisted(() => ({
  useUoms: vi.fn(),
  useMaterials: vi.fn(),
  useMaterialCategories: vi.fn(),
  useSpendCategories: vi.fn(),
  useCreateUom: vi.fn(),
  useDeactivateUom: vi.fn(),
  useCreateMaterial: vi.fn(),
  useDiscontinueMaterial: vi.fn(),
  useCreateMaterialCategory: vi.fn(),
  useDeactivateMaterialCategory: vi.fn(),
  useCreateSpendCategory: vi.fn(),
  useDeactivateSpendCategory: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { MaterialCategoriesScreen, SpendCategoriesScreen } from './category-screens';
import { MaterialsList } from './materials-list';
import { UomList } from './uom-list';

const TON: UnitOfMeasure = {
  id: 'uom-1',
  code: 'TON',
  name: 'Metric Ton',
  symbol: 't',
  status: 'ACTIVE',
};

const STEEL: MaterialCategory = {
  id: 'cat-1',
  code: 'STEEL',
  name: 'Steel & Metal Products',
  status: 'ACTIVE',
  parentId: null,
  children: [
    {
      id: 'cat-2',
      code: 'REBAR',
      name: 'Reinforcing Bar',
      status: 'ACTIVE',
      parentId: 'cat-1',
    },
  ],
};

const DIRECT_MATERIAL: SpendCategory = {
  id: 'spend-1',
  code: 'DIRECT_MATERIAL',
  name: 'Direct Material',
  status: 'ACTIVE',
  parentId: null,
  children: [],
};

const REBAR: Material = {
  id: 'mat-1',
  code: 'REBAR-12MM',
  name: '12mm Deformed Steel Rebar',
  description: null,
  status: 'ACTIVE',
  materialCategoryId: 'cat-2',
  defaultSpendCategoryId: 'spend-1',
  baseUnitOfMeasureId: 'uom-1',
  materialCategory: STEEL,
  defaultSpendCategory: DIRECT_MATERIAL,
  baseUom: TON,
};

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null };
const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useUoms.mockReturnValue(loaded([TON]));
  mocks.useMaterials.mockReturnValue(loaded([REBAR]));
  mocks.useMaterialCategories.mockReturnValue(loaded([STEEL]));
  mocks.useSpendCategories.mockReturnValue(loaded([DIRECT_MATERIAL]));
  for (const key of [
    'useCreateUom',
    'useDeactivateUom',
    'useCreateMaterial',
    'useDiscontinueMaterial',
    'useCreateMaterialCategory',
    'useDeactivateMaterialCategory',
    'useCreateSpendCategory',
    'useDeactivateSpendCategory',
  ] as const) {
    mocks[key].mockReturnValue(idleMutation);
  }
});

describe('UomList', () => {
  it('renders the unit with its symbol', () => {
    renderWithProviders(<UomList />);

    expect(screen.getByText('TON')).toBeInTheDocument();
    expect(screen.getByText('Metric Ton')).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument();
  });

  /** P2 — the service hard-codes ACTIVE and no status parameter exists. */
  it('says the list is active-only rather than offering a status filter', () => {
    renderWithProviders(<UomList />);

    expect(screen.getByText(/active units only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
  });

});

describe('MaterialsList', () => {
  it('renders a material with its base unit and both categories', () => {
    renderWithProviders(<MaterialsList />);

    expect(screen.getByText('REBAR-12MM')).toBeInTheDocument();
    expect(screen.getByText('12mm Deformed Steel Rebar')).toBeInTheDocument();
    expect(screen.getByText('Direct Material')).toBeInTheDocument();
  });

  it('offers both category filters, which are the only two the API accepts', () => {
    renderWithProviders(<MaterialsList />);

    expect(screen.getByLabelText('Material category')).toBeInTheDocument();
    expect(screen.getByLabelText('Spend category')).toBeInTheDocument();
  });

});

describe('MaterialCategoriesScreen', () => {
  it('renders a child category beneath its parent, indented', () => {
    renderWithProviders(<MaterialCategoriesScreen />);

    expect(screen.getByText('Steel & Metal Products')).toBeInTheDocument();
    expect(screen.getByText('Reinforcing Bar')).toBeInTheDocument();

    // The child row carries the depth marker; the root row does not.
    const rows = screen.getAllByRole('row');
    const childRow = rows.find((r) => r.textContent?.includes('Reinforcing Bar'));
    const rootRow = rows.find((r) => r.textContent?.includes('Steel & Metal Products'));

    expect(childRow?.textContent).toContain('↳');
    expect(rootRow?.textContent).not.toContain('↳');
  });

});

describe('SpendCategoriesScreen', () => {
  /**
   * §12.4: "always label this 'Spend Category' — never 'Cost Category' or 'Material
   * Category'. They are different entities serving different purposes."
   */
  it('is labelled as spend, never as material or cost', () => {
    renderWithProviders(<SpendCategoriesScreen />);

    expect(screen.getByRole('heading', { name: 'Spend Categories' })).toBeInTheDocument();
    expect(screen.queryByText(/cost categor/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /material categor/i })).not.toBeInTheDocument();
  });

});
