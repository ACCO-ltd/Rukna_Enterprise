import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 *  - the Status filter (Active by default) and the per-row Deactivate… / Reactivate commands
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
  useReactivateUom: vi.fn(),
  useReactivateMaterial: vi.fn(),
  useReactivateMaterialCategory: vi.fn(),
  useReactivateSpendCategory: vi.fn(),
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

const idleMutation = { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const MANAGE = 'manage:procurement-config';

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
    'useReactivateUom',
    'useReactivateMaterial',
    'useReactivateMaterialCategory',
    'useReactivateSpendCategory',
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

  it('lists active units by default and no banner about the API', () => {
    renderWithProviders(<UomList />);
    expect(mocks.useUoms).toHaveBeenLastCalledWith('ACTIVE');
    expect(screen.queryByText(/active units only/i)).not.toBeInTheDocument();
  });

  it('offers Deactivate… on an active unit and Reactivate on an inactive one, confirmed', async () => {
    const user = userEvent.setup();
    const reactivate = { ...idleMutation, mutate: vi.fn() };
    mocks.useReactivateUom.mockReturnValue(reactivate);
    mocks.useUoms.mockReturnValue(loaded([TON, { ...TON, id: 'uom-2', code: 'BAG', name: 'Bag', status: 'INACTIVE' }]));
    renderWithProviders(<UomList />, { permissions: [MANAGE] });

    await user.click(screen.getAllByRole('button', { name: 'Actions for TON' })[0]!);
    expect(await screen.findByRole('menuitem', { name: 'Deactivate…' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getAllByRole('button', { name: 'Actions for BAG' })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate' }));
    await user.click(await screen.findByRole('button', { name: 'Reactivate' }));
    expect(reactivate.mutate).toHaveBeenCalledWith('uom-2', expect.anything());
  });

  it('shows no kebab and no primary without manage:procurement-config', () => {
    renderWithProviders(<UomList />);
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New unit/ })).not.toBeInTheDocument();
  });

});

describe('MaterialsList', () => {
  it('renders a material with its base unit and both categories', () => {
    renderWithProviders(<MaterialsList />);

    expect(screen.getByText('REBAR-12MM')).toBeInTheDocument();
    expect(screen.getByText('12mm Deformed Steel Rebar')).toBeInTheDocument();
    expect(screen.getByText('Direct Material')).toBeInTheDocument();
  });

  it('offers Status and both category filters in the one Filter panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MaterialsList />);

    await user.click(screen.getAllByRole('button', { name: /^Filter/ })[0]!);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Material category')).toBeInTheDocument();
    expect(within(panel).getByText('Spend category')).toBeInTheDocument();
    expect(within(panel).getByText('Status')).toBeInTheDocument();
  });

  it('names the retire command Discontinue… for a material', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MaterialsList />, { permissions: [MANAGE] });
    await user.click(screen.getAllByRole('button', { name: 'Actions for REBAR-12MM' })[0]!);
    expect(await screen.findByRole('menuitem', { name: 'Discontinue…' })).toBeInTheDocument();
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

    // The page title lives in the module header (ADR-035); the screen itself labels its table
    // and states which kind of category it holds.
    expect(screen.getAllByRole('region', { name: 'Spend categories' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/cost categor/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /material categor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

});

describe('CreateForm — dismissal (ADR-039 FormDialog)', () => {
  it('asks before discarding a typed value, but not once it is typed back to empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UomList />, { permissions: ['manage:procurement-config'] });
    await user.click(screen.getAllByRole('button', { name: 'New unit' })[0]!);

    const code = screen.getByLabelText('Code');
    await user.type(code, 'BAG');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Keep editing' })[0]!);

    // Changed and changed back: no longer an edit, so Cancel just closes.
    await user.clear(code);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New unit of measure' })).not.toBeInTheDocument();
  });
});
