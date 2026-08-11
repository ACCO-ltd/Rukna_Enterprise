import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Material, MaterialRequest, SpendCategory, UnitOfMeasure } from '../types';

/**
 * The PO line editor is the one screen where a scale change happens in front of the user:
 * quantity is 3dp, price is 2dp, and `extendedAmount` is 2dp. Getting that wrong by a
 * factor of ten produces a plausible number, which is the dangerous kind of wrong — this
 * figure becomes a commitment against a project budget.
 *
 * `quantities.test.ts` proves `extendedAmountMinor` computes correctly in isolation. These
 * tests prove the editor feeds it the right things and renders the result, including the
 * cases where it must show nothing rather than a wrong number.
 */

const mocks = vi.hoisted(() => ({
  useMaterials: vi.fn(),
  useUoms: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import {
  PoLineEditor,
  emptyPoLine,
  lineAmounts,
  orderTotalMinor,
  poLineError,
  type PoLineDraft,
} from './po-line-editor';

const TON: UnitOfMeasure = {
  id: 'uom-1',
  code: 'TON',
  name: 'Metric Ton',
  nameAr: null,
  symbol: 't',
  status: 'ACTIVE',
};

const REBAR: Material = {
  id: 'mat-1',
  code: 'REBAR-12MM',
  name: '12mm Deformed Steel Rebar',
  nameAr: null,
  description: null,
  status: 'ACTIVE',
  materialCategoryId: 'cat-1',
  defaultSpendCategoryId: null,
  baseUnitOfMeasureId: 'uom-1',
  materialCategory: null,
  defaultSpendCategory: null,
  baseUom: TON,
};

const SPEND: SpendCategory[] = [
  {
    id: 'spend-1',
    code: 'DIRECT_MATERIAL',
    name: 'Direct Material',
    nameAr: null,
    status: 'ACTIVE',
    parentId: null,
    children: [],
  },
];

const APPROVED_MR: MaterialRequest = {
  id: 'mr-1',
  mrNumber: 'MR-00001',
  requestScope: 'PROJECT',
  projectId: 'proj-1',
  approvalInstanceId: null,
  status: 'APPROVED',
  requestedDate: '2026-08-10T00:00:00.000Z',
  requiredByDate: null,
  description: null,
  notes: null,
  lines: [
    {
      id: 'mrl-1',
      lineNumber: 1,
      lineType: 'MATERIAL',
      materialId: 'mat-1',
      description: '12mm rebar for pile caps',
      requestedQuantity: '25',
      approvedQuantity: '25',
      boqNodeId: null,
      spendCategoryId: null,
      notes: null,
      material: { code: 'REBAR-12MM', name: '12mm Deformed Steel Rebar' },
      uom: { code: 'TON', symbol: 't' },
    },
  ],
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
});

function setup(lines: PoLineDraft[], showErrors = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <PoLineEditor
      lines={lines}
      onChange={onChange}
      spendCategories={SPEND}
      approvedRequests={[APPROVED_MR]}
      currencyCode="SAR"
      showErrors={showErrors}
    />,
  );
  return { onChange };
}

describe('PoLineEditor — extended amount', () => {
  it('renders the §12.9 worked example: 25 t at 850 shows as 21,250', () => {
    setup([COMPLETE]);

    // Once on the line, once as the order total.
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
    // Two em-dashes: the line amount and the order total.
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
    setup([{ ...COMPLETE, unitPrice: '0' }], true);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a unit price greater than zero.',
    );
  });
});

describe('PoLineEditor — MR allocations', () => {
  it('offers approved MR lines to link against', async () => {
    const user = userEvent.setup();
    setup([COMPLETE]);

    await user.click(screen.getByRole('button', { name: 'Link to MR' }));

    expect(
      screen.getByRole('option', { name: /MR-00001.*12mm rebar for pile caps/ }),
    ).toBeInTheDocument();
  });

  it('records the allocation with its quantity', async () => {
    const user = userEvent.setup();
    const { onChange } = setup([COMPLETE]);

    await user.click(screen.getByRole('button', { name: 'Link to MR' }));
    await user.selectOptions(
      screen.getByLabelText('MR Allocations'),
      'mrl-1',
    );
    await user.type(screen.getByLabelText('Allocated Qty'), '25');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const emitted = onChange.mock.calls.at(-1)![0] as PoLineDraft[];
    expect(emitted[0]!.allocations).toEqual([
      { materialRequestLineId: 'mrl-1', allocatedQuantity: 25 },
    ]);
  });

  it('renders in Arabic without a missing key', () => {
    renderWithProviders(
      <PoLineEditor
        lines={[COMPLETE]}
        onChange={vi.fn()}
        spendCategories={SPEND}
        approvedRequests={[APPROVED_MR]}
        currencyCode="SAR"
        showErrors={false}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByRole('button', { name: 'ربط بطلب مواد' })).toBeInTheDocument();
  });
});
