import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqTreeNodeResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProposedPackageWeights: vi.fn(),
  useBoqWorkspace: vi.fn(),
  useBoqTree: vi.fn(),
  useWorkPackages: vi.fn(),
  useSaveDeliveryPlan: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: mocks.useBoqWorkspace,
  useBoqTree: mocks.useBoqTree,
}));
vi.mock('../hooks/use-progress', () => ({
  useWorkPackages: mocks.useWorkPackages,
  useSaveDeliveryPlan: mocks.useSaveDeliveryPlan,
  useProposedPackageWeights: mocks.useProposedPackageWeights,
}));

import { DeliveryPlanDialog } from './delivery-plan-dialog';

const node = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse => ({
  id: 'n', boqId: 'boq-1', versionId: 'v-1', parentId: null, path: 'n', depth: 0,
  sortOrder: 0, code: '1', description: 'Node', isLeaf: false, children: [],
  measurementMethod: 'QUANTITY', pricingBasis: 'UNIT_RATE', unit: null, quantity: null,
  unitRate: null, currency: 'USD', totalAmount: null, computedTotal: null, originNodeId: null,
  sourceType: 'BASELINE', sourceChangeOrderId: null, nodeRole: 'WORK',
  commercialTreatment: 'IN_CONTRACT', isActive: true, priced: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
/** A leaf as the server sends it: `priced` derived from its amount, sent to every tier. */
const leaf = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse =>
  node({ isLeaf: true, children: [], priced: Boolean(over.totalAmount), ...over });

/** The same leaf as a money-blind PM receives it: no rate, no amount; the priced verdict kept. */
const moneyBlind = (n: BoqTreeNodeResponse): BoqTreeNodeResponse => ({
  ...n,
  unitRate: null,
  totalAmount: null,
  computedTotal: null,
  children: n.children.map(moneyBlind),
});

const leaf1 = leaf({ id: 'leaf-1', code: '1.1', description: 'Excavation', totalAmount: '60000' });
const leaf2 = leaf({ id: 'leaf-2', code: '1.2', description: 'Foundation concrete', totalAmount: '40000' });
const substructure = node({ id: 'sec-1', code: '1', description: 'Substructure', children: [leaf1, leaf2] });
const leaf3 = leaf({ id: 'leaf-3', code: '2.1', description: 'Columns', totalAmount: '50000' });
const superstructure = node({ id: 'sec-2', code: '2', description: 'Superstructure', children: [leaf3] });

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBoqWorkspace.mockReturnValue(loaded({ approved: { id: 'v-1' }, contractBaseline: null, currency: 'USD' }));
  mocks.useBoqTree.mockReturnValue(loaded([substructure, superstructure]));
  mocks.useWorkPackages.mockReturnValue(loaded([]));
  mocks.useSaveDeliveryPlan.mockReturnValue({ mutate: mocks.mutate, isPending: false });
  // The server's value weighting for whatever grouping is asked: 100k / 50k of 150k per section,
  // re-derived from the leaves each package holds (so moving a leaf changes the answer).
  mocks.useProposedPackageWeights.mockImplementation(
    (_projectId: string, packages: { key: string; boqNodeIds: string[] }[]) => {
      const value: Record<string, number> = { 'leaf-1': 60000, 'leaf-2': 40000, 'leaf-3': 50000 };
      const sums = packages.map((p) => p.boqNodeIds.reduce((sum, id) => sum + (value[id] ?? 0), 0));
      const total = sums.reduce((a, b) => a + b, 0);
      return {
        data: {
          projectId: 'p-1',
          weights: packages.map((p, i) => ({ key: p.key, weight: total ? sums[i]! / total : 0 })),
          valueWeighted: true,
          unpricedLeafIds: [],
        },
        isPending: false,
      };
    },
  );
});

describe('DeliveryPlanDialog', () => {
  it('proposes one row per BOQ section with unallocated scope', () => {
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });

    expect(screen.getByDisplayValue('Substructure')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Superstructure')).toBeInTheDocument();
    // Auto-numbered codes, no collision.
    expect(screen.getByDisplayValue('WP-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('WP-02')).toBeInTheDocument();
  });

  it('excludes a package from the save payload when its checkbox is unchecked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]!); // Superstructure row (second)

    await user.click(screen.getByRole('button', { name: 'Save draft plan' }));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const payload = mocks.mutate.mock.calls[0][0];
    expect(payload.packages).toHaveLength(1);
    expect(payload.packages[0].name).toBe('Substructure');
  });

  it('moves a BOQ leaf from one suggested package to another before saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });

    // Expand Substructure's item list.
    await user.click(screen.getByText('2 items'));
    const leaf1Row = screen.getByText((_, el) => el?.textContent === '1.1 — Excavation').closest('li')!;
    const moveSelect = within(leaf1Row).getByRole('combobox');
    await user.selectOptions(moveSelect, 'sec-2');

    // The server re-weighs the new grouping (after the debounce): 40k vs 110k of 150k.
    await waitFor(() => expect(screen.getByDisplayValue('73')).toBeInTheDocument());
    expect(screen.getByDisplayValue('27')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save draft plan' }));

    const payload = mocks.mutate.mock.calls[0][0];
    const sub = payload.packages.find((p: { name: string }) => p.name === 'Substructure');
    const sup = payload.packages.find((p: { name: string }) => p.name === 'Superstructure');
    expect(sub.boqNodeIds).toEqual(['leaf-2']);
    expect(sup.boqNodeIds).toEqual(['leaf-3', 'leaf-1']);
    expect([sub.progressWeight, sup.progressWeight]).toEqual([0.27, 0.73]);
  });

  it('keeps a weight the PM typed when the grouping is re-weighed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });

    const typed = await screen.findByDisplayValue('67');
    await user.clear(typed);
    await user.type(typed, '50');
    await user.click(screen.getByText('2 items'));
    const leaf2Row = screen.getByText((_, el) => el?.textContent === '1.2 — Foundation concrete').closest('li')!;
    await user.selectOptions(within(leaf2Row).getByRole('combobox'), 'sec-2');

    // Superstructure follows the server (90k of 150k = 60%); Substructure keeps the typed 50.
    await waitFor(() => expect(screen.getByDisplayValue('60')).toBeInTheDocument());
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
  });

  it('works for a money-blind PM: an even split with one quiet note, no amounts, no false Unpriced', async () => {
    const user = userEvent.setup();
    const blindTree = [substructure, superstructure].map(moneyBlind);
    mocks.useBoqTree.mockReturnValue(loaded(blindTree));
    // The server splits evenly for a caller without the cost tier (owner decision 2026-09-29).
    mocks.useProposedPackageWeights.mockImplementation(
      (_projectId: string, packages: { key: string; boqNodeIds: string[] }[]) => ({
        data: {
          projectId: 'p-1',
          weights: packages.map((p) => ({ key: p.key, weight: 1 / packages.length })),
          valueWeighted: false,
          unpricedLeafIds: [],
        },
        isPending: false,
      }),
    );
    renderWithProviders(
      <DeliveryPlanDialog projectId="p-1" currency="USD" moneyHidden open onOpenChange={() => {}} />,
      { withToast: true },
    );

    expect(await screen.findAllByDisplayValue('50')).toHaveLength(2);
    expect(
      screen.getByText(
        'Weights are split evenly. Value-based weighting needs cost access — adjust the weights, or ask the Construction Director.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unpriced')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(JSON.stringify(blindTree)).not.toMatch(/valueShare|60000|40000|50000/);

    // A weight the PM typed is kept.
    const [first] = screen.getAllByDisplayValue('50');
    await user.clear(first!);
    await user.type(first!, '70');
    expect(screen.getByDisplayValue('70')).toBeInTheDocument();
  });

  it('shows no even-split note when the weights are value-based', async () => {
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });
    expect(await screen.findByDisplayValue('67')).toBeInTheDocument();
    expect(screen.queryByText(/split evenly/)).not.toBeInTheDocument();
  });

  it('shows nothing to propose once every BOQ section is already fully allocated', () => {
    mocks.useWorkPackages.mockReturnValue(
      loaded([{ code: 'WP-01', boqNodeIds: ['leaf-1', 'leaf-2', 'leaf-3'] }]),
    );
    renderWithProviders(<DeliveryPlanDialog projectId="p-1" currency="USD" open onOpenChange={() => {}} />, { withToast: true });

    expect(screen.getByText(/Nothing to propose/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft plan' })).not.toBeInTheDocument();
  });
});
