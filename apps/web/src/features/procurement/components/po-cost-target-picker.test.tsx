import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';

/**
 * The cost-target picker is the A3 control (no. 148): a line points at a project + a leaf, active
 * BOQ cost node, or is explicitly not chargeable to a project. These tests prove it emits both
 * ids or neither (never a half-specified target the server would 400), filters the node list to
 * leaf + active, and degrades honestly when a project has no baselined BOQ.
 */

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  useBoqWorkspace: vi.fn(),
  useBoqTree: vi.fn(),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({ useProjects: mocks.useProjects }));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: mocks.useBoqWorkspace,
  useBoqTree: mocks.useBoqTree,
}));

import {
  PoCostTargetPicker,
  emptyCostTarget,
  isCostTargetComplete,
  type CostTargetValue,
} from './po-cost-target-picker';

const PROJECTS = [
  { id: 'proj-1', code: 'ACCO-WBR-26-0065', name: 'Waberi Roadworks', status: 'ACTIVE' },
];

/** A tree with one section, one active leaf, one inactive leaf, and one nested active leaf. */
function treeNode(over: Record<string, unknown>) {
  return {
    id: 'x',
    boqId: 'b',
    versionId: 'v1',
    parentId: null,
    path: '01',
    depth: 0,
    sortOrder: 1,
    code: '01',
    description: 'Section',
    isLeaf: false,
    measurementMethod: 'QUANTITY',
    pricingBasis: 'UNIT_RATE',
    unit: null,
    quantity: null,
    unitRate: null,
    currency: 'USD',
    totalAmount: null,
    originNodeId: null,
    sourceType: 'BASELINE',
    sourceChangeOrderId: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    children: [],
    computedTotal: null,
    ...over,
  };
}

const TREE = [
  treeNode({
    id: 'sec-1',
    code: '01',
    description: 'Earthworks',
    isLeaf: false,
    children: [
      treeNode({ id: 'leaf-1', code: '01.01', description: 'Excavation', isLeaf: true }),
      treeNode({
        id: 'leaf-inactive',
        code: '01.02',
        description: 'Deleted item',
        isLeaf: true,
        isActive: false,
      }),
    ],
  }),
];

function setup(value: CostTargetValue = emptyCostTarget(), showError = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <PoCostTargetPicker value={value} onChange={onChange} showError={showError} />,
  );
  return { onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProjects.mockReturnValue({ data: PROJECTS, isLoading: false, isError: false });
  mocks.useBoqWorkspace.mockReturnValue({
    data: { approved: { id: 'v1' }, contractBaseline: null },
    isLoading: false,
    isError: false,
  });
  mocks.useBoqTree.mockReturnValue({ data: TREE, isLoading: false, isError: false });
});

describe('isCostTargetComplete', () => {
  it('is false for a fresh, undecided target', () => {
    expect(isCostTargetComplete(emptyCostTarget())).toBe(false);
  });

  it('is true when both ids are set', () => {
    expect(
      isCostTargetComplete({ notChargeable: false, projectId: 'p', boqNodeId: 'n' }),
    ).toBe(true);
  });

  it('is true for the not-chargeable opt-out', () => {
    // The org/overhead opt-out is a complete, valid decision — it needs no ids.
    expect(
      isCostTargetComplete({ notChargeable: true, projectId: null, boqNodeId: null }),
    ).toBe(true);
  });

  it('is false for a half-specified target', () => {
    expect(
      isCostTargetComplete({ notChargeable: false, projectId: 'p', boqNodeId: null }),
    ).toBe(false);
  });
});

describe('PoCostTargetPicker — not-chargeable toggle', () => {
  it('emits the org/overhead opt-out with neither id when toggled on', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByLabelText(/not chargeable/i));
    expect(onChange).toHaveBeenCalledWith({
      notChargeable: true,
      projectId: null,
      boqNodeId: null,
    });
  });

  it('hides the project and node selectors while not chargeable', () => {
    setup({ notChargeable: true, projectId: null, boqNodeId: null });
    expect(screen.queryByText('Select a project')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a cost node')).not.toBeInTheDocument();
  });
});

describe('PoCostTargetPicker — BOQ node select', () => {
  it('offers only leaf, active nodes and hides sections and inactive nodes', async () => {
    const user = userEvent.setup();
    setup({ notChargeable: false, projectId: 'proj-1', boqNodeId: null });
    // The active leaf is offered.
    await openSelect(user, screen.getByLabelText(/BOQ cost node/i));
    expect(screen.getByRole('option', { name: /01\.01 · Excavation/ })).toBeInTheDocument();
    // The section and the inactive leaf are not.
    expect(screen.queryByRole('option', { name: /Earthworks/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Deleted item/ })).not.toBeInTheDocument();
  });

  it('emits both ids when a node is chosen under a project', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ notChargeable: false, projectId: 'proj-1', boqNodeId: null });
    await chooseOption(user, screen.getByLabelText(/BOQ cost node/i), /01\.01 · Excavation/);
    expect(onChange).toHaveBeenCalledWith({
      notChargeable: false,
      projectId: 'proj-1',
      boqNodeId: 'leaf-1',
    });
  });

  it('clears the node when the project changes', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ notChargeable: false, projectId: null, boqNodeId: null });
    await chooseOption(user, screen.getByLabelText('Project'), /Waberi Roadworks/);
    expect(onChange).toHaveBeenCalledWith({
      notChargeable: false,
      projectId: 'proj-1',
      boqNodeId: null,
    });
  });

  it('says so when the project has no baselined BOQ rather than offering an empty list', () => {
    mocks.useBoqWorkspace.mockReturnValue({
      data: { approved: null, contractBaseline: null },
      isLoading: false,
      isError: false,
    });
    mocks.useBoqTree.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    setup({ notChargeable: false, projectId: 'proj-1', boqNodeId: null });
    expect(screen.getByText(/no baselined BOQ yet/i)).toBeInTheDocument();
  });
});
