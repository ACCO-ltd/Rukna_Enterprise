import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqTreeNodeResponse, UnitOfMeasureOption } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { chooseOption, openSelect } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import type { BoqLibraryItem } from '../api/boq-item-library-api';
import { toCreateNodePayload, toUpdateNodePayload, type NodeFormValues } from '../node-form';
import { testNode } from '../test-node';
import type { ItemDialogTarget, LibraryIntent } from './boq-item-dialog';

/**
 * The BOQ item dialog (ADR-039): pricing-basis cards, the list-only unit picker, the live
 * amount, the dirty guard, money-blind rendering, server errors, and the library fast-entry
 * path (ADR-020).
 */

const mocks = vi.hoisted(() => ({ useLibrarySearch: vi.fn(), useUnitsOfMeasure: vi.fn() }));
vi.mock('../hooks/use-boq-item-library', () => ({ useLibrarySearch: mocks.useLibrarySearch }));
vi.mock('@/features/units-of-measure/hooks/use-units-of-measure', () => ({
  useUnitsOfMeasure: mocks.useUnitsOfMeasure,
}));

import { BoqItemDialog } from './boq-item-dialog';

const UNITS: UnitOfMeasureOption[] = [
  { code: 'M3', name: 'Cubic metre', symbol: 'm³' },
  { code: 'M2', name: 'Square metre', symbol: 'm²' },
  { code: 'NR', name: 'Number', symbol: 'nr' },
];

const ITEM: BoqLibraryItem = {
  id: 'lib-1',
  organizationId: 'org-1',
  code: 'EXC-100',
  description: 'Bulk excavation in ordinary soil',
  defaultUnit: 'm³',
  measurementMethod: 'MILESTONE',
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

const SECTION = testNode({ id: 's2', code: '2', description: 'Superstructure' });
const ADD_ITEM: ItemDialogTarget = { mode: 'add', kind: 'item', parent: SECTION, node: null };

function itemNode(overrides: Partial<BoqTreeNodeResponse> = {}) {
  return testNode({
    id: 'n1',
    code: '2.1',
    description: 'Reinforced concrete to columns',
    isLeaf: true,
    parentId: 's2',
    unit: 'm³',
    quantity: '42.000',
    unitRate: '160.00',
    totalAmount: '6720.00',
    computedTotal: '6720.00',
    ...overrides,
  });
}

const edit = (node = itemNode()): ItemDialogTarget => ({ mode: 'edit', kind: 'item', parent: null, node });

function unitsState(state: 'ok' | 'empty' | 'error' | 'pending', data: UnitOfMeasureOption[] = UNITS) {
  mocks.useUnitsOfMeasure.mockReturnValue({
    data: state === 'ok' ? data : state === 'empty' ? [] : undefined,
    isPending: state === 'pending',
    isSuccess: state === 'ok' || state === 'empty',
    isError: state === 'error',
  });
}

function renderDialog(target: ItemDialogTarget, overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn<(v: NodeFormValues, t: ItemDialogTarget, lib: LibraryIntent) => void>();
  const onClose = vi.fn();
  renderWithProviders(
    <BoqItemDialog
      target={target}
      currency="USD"
      readOnly={false}
      isPending={false}
      libraryEnabled
      canViewCommercials
      canSaveToLibrary
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

const unitTrigger = () => screen.getByLabelText(/^Unit$/);
const rateField = () => screen.getByLabelText(/Unit rate \(USD\)/);
const lumpSumField = () => screen.getByRole('textbox', { name: /^Lump sum/ });

beforeEach(() => {
  mocks.useLibrarySearch.mockReturnValue({ data: [], isPending: false, isError: false });
  unitsState('ok');
});

describe('BoqItemDialog — anatomy', () => {
  it('titles an existing item by its code, with the measurement-and-pricing subtitle', () => {
    renderDialog(edit());
    const dialog = screen.getByRole('dialog', { name: 'Item 2.1' });
    expect(within(dialog).getByText('Measurement and pricing')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save item' })).toBeInTheDocument();
  });

  it('titles a new item by the section it goes into', () => {
    renderDialog(ADD_ITEM);
    expect(screen.getByRole('dialog', { name: 'New item in 2 · Superstructure' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('shows a section only the fields a section has', () => {
    renderDialog({ mode: 'edit', kind: 'section', parent: null, node: SECTION });
    expect(screen.getByRole('dialog', { name: 'Section 2' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Pricing basis' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Unit$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Measurement method/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save section' })).toBeInTheDocument();
  });

  it('puts focus in the description, not on a footer button', async () => {
    renderDialog(edit());
    await waitFor(() => expect(screen.getByLabelText(/Description/)).toHaveFocus());
  });
});

describe('BoqItemDialog — pricing basis', () => {
  it('shows unit, quantity and rate for a unit-rate item, with the live amount line', () => {
    renderDialog(edit());
    expect(screen.getByRole('radio', { name: 'Unit rate' })).toHaveAttribute('aria-checked', 'true');
    expect(unitTrigger()).toHaveTextContent('m³');
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue('42.000');
    expect(rateField()).toHaveValue('160.00');
    expect(screen.getByText(/42 m³ × \$160\.00 =/)).toHaveTextContent('42 m³ × $160.00 = $6,720.00');
  });

  it('omits the amount line while the rate is empty', async () => {
    renderDialog(edit(itemNode({ unitRate: null, totalAmount: null, computedTotal: null })));
    expect(screen.queryByText(/ × .* = /)).not.toBeInTheDocument();

    await userEvent.type(rateField(), '10');
    expect(screen.getByText(/42 m³ × \$10\.00 =/)).toHaveTextContent('= $420.00');
  });

  it('switches to a single lump-sum amount seeded from what the line totals to, and back', async () => {
    renderDialog(edit());

    await userEvent.click(screen.getByRole('radio', { name: 'Lump sum' }));
    expect(screen.queryByLabelText(/^Unit$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Quantity/)).not.toBeInTheDocument();
    expect(lumpSumField()).toHaveValue('6,720.00');
    expect(screen.getByText('USD. The amount is recalculated on save.')).toBeInTheDocument();

    // Back to unit rate: the measured quantity and rate were kept.
    await userEvent.click(screen.getByRole('radio', { name: 'Unit rate' }));
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue('42.000');
    expect(rateField()).toHaveValue('160.00');
  });

  it('reads an existing lump sum (quantity 1) back as its amount', () => {
    renderDialog(edit(itemNode({ pricingBasis: 'LUMP_SUM', quantity: '1.000', unitRate: '25000.00', unit: null })));
    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('aria-checked', 'true');
    expect(lumpSumField()).toHaveValue('25,000.00');
  });

  it('saves a lump sum as quantity 1 × rate = amount — the existing model', async () => {
    const { onSubmit } = renderDialog(edit());

    await userEvent.click(screen.getByRole('radio', { name: 'Lump sum' }));
    await userEvent.clear(lumpSumField());
    await userEvent.type(lumpSumField(), '9000');
    await userEvent.click(screen.getByRole('button', { name: 'Save item' }));

    const [values] = onSubmit.mock.calls[0]!;
    expect(values.pricingBasis).toBe('LUMP_SUM');
    const payload = toUpdateNodePayload(values, { kind: 'item' });
    expect(payload).toMatchObject({ pricingBasis: 'LUMP_SUM', quantity: '1', unitRate: '9000' });
  });

  it('maps the measurement method choices onto the existing enum', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog(edit());

    await chooseOption(user, screen.getByLabelText(/Measurement method/), 'MILESTONE');
    expect(screen.getByLabelText(/Measurement method/)).toHaveTextContent('On completion');
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(onSubmit.mock.calls[0]![0].measurementMethod).toBe('MILESTONE');
  });
});

describe('BoqItemDialog — unit dropdown', () => {
  it('offers the active units, symbol first with the name beside it', async () => {
    const user = userEvent.setup();
    renderDialog(ADD_ITEM);

    await openSelect(user, unitTrigger());
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /m² Square metre/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /nr Number/ })).toBeInTheDocument();
  });

  it('saves the chosen unit symbol and shows it inside the quantity field', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog(ADD_ITEM);

    await user.type(screen.getByLabelText(/Description/), 'Blockwork');
    await chooseOption(user, unitTrigger(), 'm²');
    expect(screen.getByLabelText(/^Quantity/).parentElement).toHaveTextContent('m²');
    await user.type(screen.getByLabelText(/^Quantity/), '12.5');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    const [values, target] = onSubmit.mock.calls[0]!;
    const payload = toCreateNodePayload(values, { kind: 'item', parentId: target.parent?.id });
    expect(payload).toMatchObject({ unit: 'm²', quantity: '12.5', parentId: 's2', isLeaf: true });
  });

  it('keeps a legacy unit that is not in the list, flagged, and never clears it', async () => {
    const { onSubmit } = renderDialog(edit(itemNode({ unit: 'bags' })));

    expect(unitTrigger()).toHaveTextContent('bags');
    expect(
      screen.getByText('Not in the units list — ask an admin to add it, or pick a listed unit.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save item' }));
    expect(onSubmit.mock.calls[0]![0].unit).toBe('bags');
  });

  it('shows an imported spelling (m2) as the listed unit, unflagged, and saves the listed symbol', async () => {
    const { onSubmit } = renderDialog(edit(itemNode({ unit: 'm2' })));

    expect(unitTrigger()).toHaveTextContent('m²');
    expect(screen.queryByText(/Not in the units list/)).not.toBeInTheDocument();
    expect(screen.getByText(/42 m² × \$160\.00 =/)).toBeInTheDocument();

    // Opening and closing an untouched line is not an edit.
    await userEvent.click(screen.getByRole('button', { name: 'Save item' }));
    expect(onSubmit.mock.calls[0]![0].unit).toBe('m²');
  });

  it('says so when no units are set up, and links an administrator to Procurement setup', () => {
    unitsState('empty');
    renderDialog(ADD_ITEM, { unitsAdminHref: '/procurement/setup/uom' });

    expect(screen.getByText(/No units of measure are set up yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage units in Procurement setup' })).toHaveAttribute(
      'href',
      '/procurement/setup/uom',
    );
  });

  it('asks a non-administrator to find one when the list cannot load', () => {
    unitsState('error');
    renderDialog(ADD_ITEM);

    expect(screen.getByText(/Could not load the units of measure/)).toHaveTextContent(
      'Ask an administrator to add units.',
    );
    expect(screen.queryByRole('link', { name: /Manage units/ })).not.toBeInTheDocument();
  });
});

describe('BoqItemDialog — money-blind', () => {
  it('draws no rate, no amount line and no $0 for a unit-rate item', () => {
    renderDialog(edit(), { canViewCommercials: false });

    expect(screen.getByText('Measurement')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Unit rate \(USD\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue('42.000');
  });

  it('draws no lump-sum amount either', async () => {
    renderDialog(edit(), { canViewCommercials: false });
    await userEvent.click(screen.getByRole('radio', { name: 'Lump sum' }));

    expect(screen.queryByRole('textbox', { name: /^Lump sum/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe('BoqItemDialog — dismissal', () => {
  it('closes straight away when nothing was changed', async () => {
    const { onClose } = renderDialog(edit());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding unsaved edits', async () => {
    const { onClose } = renderDialog(edit());

    await userEvent.type(screen.getByLabelText(/Description/), ' — revised');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while saving', async () => {
    const { onClose } = renderDialog(edit(), { isPending: true });

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BoqItemDialog — server errors', () => {
  it('puts a rule violation on its field and anything else in a form-level notice', () => {
    const error = new ApiError(400, 'Unit rate accepts at most 2 decimal places.', 'VALIDATION', [], {
      violations: [
        { code: 'RATE_SCALE', message: 'Unit rate accepts at most 2 decimal places.' },
        { code: 'MAX_DEPTH_EXCEEDED', message: 'The BOQ is nested too deeply.' },
      ],
    });
    renderDialog(edit(), { error });

    expect(rateField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Unit rate accepts at most 2 decimal places.')).toBeInTheDocument();
    expect(screen.getByText('The BOQ is nested too deeply.')).toBeInTheDocument();
  });

  it('shows a duplicate code in the notice while the code override is closed', () => {
    const error = new ApiError(400, 'Code 2.1 is already used.', 'VALIDATION', [], {
      violations: [{ code: 'DUPLICATE_CODE', message: 'Code 2.1 is already used.' }],
    });
    renderDialog(edit(), { error });
    expect(screen.getByText('Code 2.1 is already used.')).toBeInTheDocument();
  });
});

describe('BoqItemDialog — library fast entry', () => {
  it('prefills the form from a picked library item, leaving every field editable', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    renderDialog(ADD_ITEM);

    await userEvent.click(screen.getByRole('button', { name: /Add from library/i }));
    await userEvent.click(await screen.findByRole('option', { name: /EXC-100/ }));

    expect(screen.getByLabelText(/Description/i)).toHaveValue('Bulk excavation in ordinary soil');
    expect(unitTrigger()).toHaveTextContent('m³');
    expect(rateField()).toHaveValue('12.50');
    // The code is server-assigned (D2), never the library item's own code.
    expect(screen.queryByText(ITEM.code)).not.toBeInTheDocument();
  });

  it('prefills a lump-sum library item as a lump-sum amount', async () => {
    mocks.useLibrarySearch.mockReturnValue({
      data: [{ ...ITEM, pricingBasis: 'LUMP_SUM', lastUsedRate: '5000.00' }],
      isPending: false,
      isError: false,
    });
    renderDialog(ADD_ITEM);

    await userEvent.click(screen.getByRole('button', { name: /Add from library/i }));
    await userEvent.click(await screen.findByRole('option', { name: /EXC-100/ }));

    expect(screen.getByRole('radio', { name: 'Lump sum' })).toHaveAttribute('aria-checked', 'true');
    expect(lumpSumField()).toHaveValue('5,000.00');
  });

  it('carries the picked item id out on submit so the workspace records its usage', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    const { onSubmit } = renderDialog(ADD_ITEM);

    await userEvent.click(screen.getByRole('button', { name: /Add from library/i }));
    await userEvent.click(await screen.findByRole('option', { name: /EXC-100/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![2]).toEqual({ pickedItemId: 'lib-1', saveToLibrary: false });
  });

  it('carries a save-to-library choice out on submit for a manual entry', async () => {
    const { onSubmit } = renderDialog(ADD_ITEM);

    await userEvent.type(screen.getByLabelText(/Description/i), 'A new work item');
    await userEvent.click(screen.getByLabelText(/save this item to the library/i));
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(onSubmit.mock.calls[0]![2]).toEqual({ pickedItemId: null, saveToLibrary: true });
  });

  it('sends no code on a plain add (the server numbers it)', async () => {
    const { onSubmit } = renderDialog(ADD_ITEM);
    await userEvent.type(screen.getByLabelText(/Description/i), 'Auto-numbered item');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onSubmit.mock.calls[0]![0].code).toBe('');
  });

  it('overrides the auto code through Advanced', async () => {
    const { onSubmit } = renderDialog(ADD_ITEM);

    await userEvent.type(screen.getByLabelText(/Description/i), 'Custom-coded item');
    await userEvent.click(screen.getByRole('button', { name: /Set a custom code/i }));
    await userEvent.clear(screen.getByLabelText(/Item code/i));
    await userEvent.type(screen.getByLabelText(/Item code/i), '07.07.007');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(onSubmit.mock.calls[0]![0].code).toBe('07.07.007');
  });

  it('offers no library affordance when editing an item, or for a section', () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    renderDialog(edit());
    expect(screen.queryByRole('button', { name: /Add from library/i })).not.toBeInTheDocument();
  });

  it('refuses to submit without a description', async () => {
    const { onSubmit } = renderDialog(ADD_ITEM);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('A description is required.')).toBeInTheDocument();
  });
});
