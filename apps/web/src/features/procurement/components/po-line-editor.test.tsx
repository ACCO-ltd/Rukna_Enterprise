import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Material, UnitOfMeasure } from '../types';

/**
 * The PO line editor is the one screen where a scale change happens in front of the user:
 * quantity is 3dp, price is 2dp, and `extendedAmount` is 2dp. Getting that wrong by a
 * factor of ten produces a plausible number, which is the dangerous kind of wrong — this
 * figure becomes a commitment against a project budget.
 *
 * `quantities.test.ts` proves `extendedAmountMinor` computes correctly in isolation. These
 * tests prove the editor feeds it the right things and renders the result, including the
 * cases where it must show nothing rather than a wrong number.
 *
 * Round 2 (D2/D7): PO lines no longer link to material-request lines, and spend category is
 * no longer chosen on the line — it is a read-only "Derived on issue" chip. The tests that
 * exercised the MR allocation picker and the spend-category select are gone with them.
 */

const mocks = vi.hoisted(() => ({
  useMaterials: vi.fn(),
  useUoms: vi.fn(),
  // UomDisplay offers "Add a unit" from the picker itself, so the hook it uses must exist.
  useCreateUom: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useProjects: vi.fn(),
  useBoqWorkspace: vi.fn(),
  useBoqTree: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => ({
  useMaterials: mocks.useMaterials,
  useUoms: mocks.useUoms,
  useCreateUom: mocks.useCreateUom,
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: mocks.useProjects,
}));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: mocks.useBoqWorkspace,
  useBoqTree: mocks.useBoqTree,
}));

import {
  PoLineEditor,
  emptyPoLine,
  lineAmounts,
  orderTotalMinor,
  poLineCostTargetIncomplete,
  poLineError,
  type PoLineDraft,
} from './po-line-editor';
import type { CostTargetValue } from './po-cost-target-picker';

const TON: UnitOfMeasure = {
  id: 'uom-1',
  code: 'TON',
  name: 'Metric Ton',
  symbol: 't',
  status: 'ACTIVE',
};

const REBAR: Material = {
  id: 'mat-1',
  code: 'REBAR-12MM',
  name: '12mm Deformed Steel Rebar',
  description: null,
  status: 'ACTIVE',
  materialCategoryId: 'cat-1',
  defaultSpendCategoryId: null,
  baseUnitOfMeasureId: 'uom-1',
  materialCategory: null,
  defaultSpendCategory: null,
  baseUom: TON,
};

/** A complete line matching the §12.9 worked example: 25 t at 850 = 21,250. */
const COMPLETE: PoLineDraft = {
  ...emptyPoLine('line-1'),
  material: REBAR,
  uomCode: 'TON',
  description: '12mm deformed rebar',
  quantity: '25',
  unitPrice: '850.00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useMaterials.mockReturnValue({ data: [REBAR], isLoading: false, isError: false });
  mocks.useUoms.mockReturnValue({ data: [TON], isLoading: false, isError: false });
  mocks.useProjects.mockReturnValue({ data: [], isLoading: false, isError: false });
  mocks.useBoqWorkspace.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  mocks.useBoqTree.mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

const CHARGEABLE: CostTargetValue = {
  notChargeable: false,
  projectId: 'proj-1',
  boqNodeId: 'node-1',
};
const NOT_CHARGEABLE: CostTargetValue = {
  notChargeable: true,
  projectId: null,
  boqNodeId: null,
};
const HALF: CostTargetValue = { notChargeable: false, projectId: 'proj-1', boqNodeId: null };

function setup(lines: PoLineDraft[], showErrors = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <PoLineEditor
      lines={lines}
      onChange={onChange}
      currencyCode="SAR"
      showErrors={showErrors}
    />,
  );
  return { onChange };
}

describe('PoLineEditor — extended amount', () => {
  it('renders the §12.9 worked example: 25 t at 850 shows as 21,250', () => {
    setup([COMPLETE]);
    expect(screen.getAllByText(/21,250\.00/).length).toBeGreaterThanOrEqual(1);
  });

  it('carries the quantity scale across correctly — 2.5 × 10.00 is 25.00', () => {
    const line: PoLineDraft = { ...COMPLETE, quantity: '2.5', unitPrice: '10.00' };
    const { extendedMinor } = lineAmounts(line);

    expect(extendedMinor).toBe(2500); // 25.00 in money minor units
    setup([line]);
    expect(screen.getAllByText(/25\.00/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows nothing rather than a wrong figure while the price is half-typed', () => {
    const line: PoLineDraft = { ...COMPLETE, unitPrice: '' };
    const { extendedMinor } = lineAmounts(line);

    expect(extendedMinor).toBeNull();
    setup([line]);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('totals several lines exactly, where floats would drift', () => {
    const a: PoLineDraft = { ...COMPLETE, key: 'a', quantity: '1', unitPrice: '0.10' };
    const b: PoLineDraft = { ...COMPLETE, key: 'b', quantity: '1', unitPrice: '0.20' };

    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    expect(orderTotalMinor([a, b])).toBe(30);
  });

  it('ignores incomplete lines in the total instead of treating them as zero-priced', () => {
    const incomplete: PoLineDraft = { ...emptyPoLine('line-2') };
    expect(orderTotalMinor([COMPLETE, incomplete])).toBe(2125000);
  });
});

describe('PoLineEditor — validation', () => {
  it('accepts a complete line', () => {
    expect(poLineError(COMPLETE)).toBeNull();
  });

  it('rejects a zero unit price, which @IsPositive() refuses server-side', () => {
    expect(poLineError({ ...COMPLETE, unitPrice: '0' })).toBe('priceMustBePositive');
  });

  it('rejects an unparseable price rather than reading it as zero', () => {
    expect(poLineError({ ...COMPLETE, unitPrice: '85o' })).toBe('priceMustBePositive');
  });

  it('requires a material on a MATERIAL line before anything else', () => {
    expect(poLineError({ ...COMPLETE, material: null })).toBe('materialRequired');
  });

  it('surfaces the price error in the DOM once submit has been attempted', () => {
    // A complete cost target keeps the A3 error off, so the price error is the only alert.
    setup([{ ...COMPLETE, unitPrice: '0', costTarget: CHARGEABLE }], true);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a unit price greater than zero.',
    );
  });
});

describe('PoLineEditor — D7 derived spend category', () => {
  it('shows spend category as a read-only "Derived on issue" chip, not a select', () => {
    setup([COMPLETE]);
    expect(screen.getByText('Derived on issue')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /spend category/i })).not.toBeInTheDocument();
  });
});

/**
 * A3 (no. 148): a line is project-cost-relevant by default → project + BOQ node required, with a
 * per-line not-chargeable opt-out. `poLineCostTargetIncomplete` mirrors the server's
 * `validateCostTarget` both-or-neither rule and blocks submit on a half-specified line.
 */
describe('PoLineEditor — A3 cost target', () => {
  it('treats a fresh line (neither project nor node, not opted out) as incomplete', () => {
    // emptyPoLine defaults to a decision-pending cost target; it must not be submittable.
    expect(poLineCostTargetIncomplete(COMPLETE)).toBe(true);
  });

  it('accepts a fully-specified cost target (both project and node)', () => {
    expect(poLineCostTargetIncomplete({ ...COMPLETE, costTarget: CHARGEABLE })).toBe(false);
  });

  it('accepts the not-chargeable opt-out (neither id, explicitly org/overhead)', () => {
    expect(poLineCostTargetIncomplete({ ...COMPLETE, costTarget: NOT_CHARGEABLE })).toBe(false);
  });

  it('rejects a half-specified target — a project without a node', () => {
    expect(poLineCostTargetIncomplete({ ...COMPLETE, costTarget: HALF })).toBe(true);
  });

  it('rejects a half-specified target — a node without a project', () => {
    const nodeOnly: CostTargetValue = {
      notChargeable: false,
      projectId: null,
      boqNodeId: 'node-1',
    };
    expect(poLineCostTargetIncomplete({ ...COMPLETE, costTarget: nodeOnly })).toBe(true);
  });

  it('offers the not-chargeable toggle and, when off, the project selector', () => {
    setup([{ ...COMPLETE, costTarget: emptyPoLine('x').costTarget }]);
    expect(
      screen.getByText('Not chargeable to a project cost line'),
    ).toBeInTheDocument();
    // With the opt-out off, the project selector is present.
    expect(screen.getByText('Select a project')).toBeInTheDocument();
  });

  it('hides the cost-target selectors when the line is marked not chargeable', () => {
    setup([{ ...COMPLETE, costTarget: NOT_CHARGEABLE }]);
    expect(screen.queryByText('Select a project')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a cost node')).not.toBeInTheDocument();
  });

  it('surfaces the incomplete error once submit is attempted on a half-specified line', () => {
    setup([{ ...COMPLETE, costTarget: HALF }], true);
    expect(
      screen.getByText(
        'Choose both a project and a BOQ cost node, or mark this line not chargeable to a project.',
      ),
    ).toBeInTheDocument();
  });
});
