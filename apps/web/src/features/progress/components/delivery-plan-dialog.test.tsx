import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqTreeNodeResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
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
}));

import { DeliveryPlanDialog } from './delivery-plan-dialog';

const node = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse => ({
  id: 'n', boqId: 'boq-1', versionId: 'v-1', parentId: null, path: 'n', depth: 0,
  sortOrder: 0, code: '1', description: 'Node', isLeaf: false, children: [],
  measurementMethod: 'QUANTITY', pricingBasis: 'UNIT_RATE', unit: null, quantity: null,
  unitRate: null, currency: 'USD', totalAmount: null, computedTotal: null, originNodeId: null,
  sourceType: 'BASELINE', sourceChangeOrderId: null, nodeRole: 'WORK',
  commercialTreatment: 'IN_CONTRACT', isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const leaf = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse => node({ isLeaf: true, children: [], ...over });

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

    await user.click(screen.getByRole('button', { name: 'Save draft plan' }));

    const payload = mocks.mutate.mock.calls[0][0];
    const sub = payload.packages.find((p: { name: string }) => p.name === 'Substructure');
    const sup = payload.packages.find((p: { name: string }) => p.name === 'Superstructure');
    expect(sub.boqNodeIds).toEqual(['leaf-2']);
    expect(sup.boqNodeIds).toEqual(['leaf-3', 'leaf-1']);
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
