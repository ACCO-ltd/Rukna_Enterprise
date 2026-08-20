import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Material, SpendCategory, UnitOfMeasure } from '../types';

/**
 * The MR line editor is where the two rules that make a material request valid are
 * enforced client-side, so it gets a component test rather than only logic coverage:
 *
 *  - a MATERIAL line must name a material (rule CAT-001)
 *  - a MATERIAL line's unit is the material's own and is not editable (rule UOM-001)
 *
 * `quantities.test.ts` already proves `validateMrLine` decides correctly. What it cannot
 * prove is that choosing a material actually locks the unit control in the DOM — which is
 * the part a user experiences and the part a refactor breaks.
 */

const mocks = vi.hoisted(() => ({
  useMaterials: vi.fn(),
  useUoms: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { MrLineEditor, emptyMrLine, mrLineError, type MrLineDraft } from './mr-line-editor';

const TON: UnitOfMeasure = {
  id: 'uom-1',
  code: 'TON',
  name: 'Metric Ton',
  symbol: 't',
  status: 'ACTIVE',
};

const LOT: UnitOfMeasure = {
  id: 'uom-2',
  code: 'LOT',
  name: 'Lot',
  symbol: 'lot',
  status: 'ACTIVE',
};

const REBAR: Material = {
  id: 'mat-1',
  code: 'REBAR-12MM',
  name: '12mm Deformed Steel Rebar',
  description: null,
  status: 'ACTIVE',
  materialCategoryId: 'cat-1',
  defaultSpendCategoryId: 'spend-1',
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
    status: 'ACTIVE',
    parentId: null,
    children: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useMaterials.mockReturnValue({ data: [REBAR], isLoading: false, isError: false });
  mocks.useUoms.mockReturnValue({ data: [TON, LOT], isLoading: false, isError: false });
});

/** Renders the editor as a controlled component and reports what it emits. */
function setup(initial: MrLineDraft[] = [emptyMrLine('line-1')], showErrors = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <MrLineEditor
      lines={initial}
      onChange={onChange}
      spendCategories={SPEND}
      showErrors={showErrors}
    />,
  );
  return { onChange };
}

describe('MrLineEditor — material selection', () => {
  it('locks the unit to the material once one is chosen (rule UOM-001)', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.type(screen.getByRole('combobox', { name: '' }), 'REBAR');
    await user.click(await screen.findByRole('option', { name: /REBAR-12MM/ }));

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted[0]!.material?.code).toBe('REBAR-12MM');
    expect(emitted[0]!.uomCode).toBe('TON');
  });

  it('fills an empty description from the material name', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.type(screen.getByRole('combobox', { name: '' }), 'REBAR');
    await user.click(await screen.findByRole('option', { name: /REBAR-12MM/ }));

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted[0]!.description).toBe('12mm Deformed Steel Rebar');
  });

  it('does not overwrite a description the user has already written', async () => {
    const user = userEvent.setup();
    const typed: MrLineDraft = { ...emptyMrLine('line-1'), description: 'Pile cap rebar' };
    const { onChange } = setup([typed]);

    await user.type(screen.getByRole('combobox', { name: '' }), 'REBAR');
    await user.click(await screen.findByRole('option', { name: /REBAR-12MM/ }));

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted[0]!.description).toBe('Pile cap rebar');
  });

  it('renders the locked unit as text with a lock, not as a disabled select', () => {
    const withMaterial: MrLineDraft = {
      ...emptyMrLine('line-1'),
      material: REBAR,
      uomCode: 'TON',
    };
    setup([withMaterial]);

    // The symbol is shown, and there is no unit select to be tempted by.
    expect(screen.getByTitle('Locked to material base unit')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /LOT/ })).not.toBeInTheDocument();
  });
});

describe('MrLineEditor — line type', () => {
  it('offers a free unit select on a SERVICE line', async () => {
    const user = userEvent.setup();
    const service: MrLineDraft = { ...emptyMrLine('line-1'), lineType: 'SERVICE' };
    setup([service]);

    // A SERVICE line has no material picker and does have a unit to choose.
    expect(screen.queryByPlaceholderText('Search by code or name')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /LOT/ })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Type' }));
  });

  it('clears the material when switching away from MATERIAL', async () => {
    const user = userEvent.setup();
    const withMaterial: MrLineDraft = {
      ...emptyMrLine('line-1'),
      material: REBAR,
      uomCode: 'TON',
    };
    const { onChange } = setup([withMaterial]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'SERVICE');

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted[0]!.lineType).toBe('SERVICE');
    expect(emitted[0]!.material).toBeNull();
  });
});

describe('MrLineEditor — validation', () => {
  it('stays quiet until the user has tried to submit', () => {
    setup([emptyMrLine('line-1')], false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a MATERIAL line with no material (rule CAT-001)', () => {
    setup([emptyMrLine('line-1')], true);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a material. Material lines cannot be free text.',
    );
  });

  it('reports a missing quantity once a material is chosen', () => {
    const line: MrLineDraft = {
      ...emptyMrLine('line-1'),
      material: REBAR,
      uomCode: 'TON',
      description: '12mm rebar',
      quantity: '',
    };
    setup([line], true);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a quantity greater than zero.',
    );
  });

  it('accepts a complete line', () => {
    const line: MrLineDraft = {
      ...emptyMrLine('line-1'),
      material: REBAR,
      uomCode: 'TON',
      description: '12mm rebar',
      quantity: '25',
    };
    setup([line], true);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mrLineError(line)).toBeNull();
  });

  /** A typo must not read as a valid zero — `parseMinorUnits` returns null, not 0. */
  it('rejects an unparseable quantity rather than treating it as zero', () => {
    const line: MrLineDraft = {
      ...emptyMrLine('line-1'),
      material: REBAR,
      description: '12mm rebar',
      quantity: '25o',
    };
    expect(mrLineError(line)).toBe('quantityMustBePositive');
  });
});

describe('MrLineEditor — rows', () => {
  it('adds a line with a distinct key', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Add line' }));

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted).toHaveLength(2);
    expect(emitted[1]!.key).not.toBe(emitted[0]!.key);
  });

  it('does not offer to remove the only line', () => {
    setup([emptyMrLine('line-1')]);
    expect(screen.queryByRole('button', { name: 'Remove line' })).not.toBeInTheDocument();
  });

  it('removes the right line when there are several', async () => {
    const user = userEvent.setup();
    const lines = [emptyMrLine('line-1'), emptyMrLine('line-2')];
    const { onChange } = setup(lines);

    const second = screen.getAllByRole('group')[1]!;
    await user.click(within(second).getByRole('button', { name: 'Remove line' }));

    const emitted = onChange.mock.calls.at(-1)![0] as MrLineDraft[];
    expect(emitted.map((l) => l.key)).toEqual(['line-1']);
  });

});
