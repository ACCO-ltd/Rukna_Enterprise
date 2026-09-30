import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * The cost budget is edited in its own table (ADR-039), not in a side sheet. What matters:
 * the save model is unchanged (the whole version in one call — POST to start a version, PATCH to
 * replace a working version's lines), invalid lines never reach the server, the total is live,
 * and leaving with unsaved edits asks first.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  createPending: false,
}));

vi.mock('@/features/procurement/hooks/use-project-procurement', () => ({
  useCreateProjectCostBudget: () => ({
    mutate: mocks.create,
    isPending: mocks.createPending,
    error: null,
  }),
  useUpdateProjectCostBudget: () => ({ mutate: mocks.update, isPending: false, error: null }),
}));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: () => ({ data: { contractBaseline: { id: 'v1' }, approved: null } }),
  useBoqTree: () => ({
    isLoading: false,
    data: [
      {
        id: 'n1',
        code: '1.1',
        description: 'Excavation',
        isLeaf: true,
        isActive: true,
        children: [],
      },
    ],
  }),
}));
vi.mock('@/features/procurement/hooks/use-procurement', () => ({
  useSpendCategories: () => ({
    isLoading: false,
    data: [{ id: 'c1', code: 'LAB', name: 'Labour', status: 'ACTIVE' }],
  }),
}));

import { BudgetLinesEditor, type BudgetLineDraft } from './budget-lines-editor';

const seeded: BudgetLineDraft[] = [
  {
    key: 'l1',
    target: 'BOQ',
    boqNodeId: 'n1',
    spendCategoryId: '',
    description: 'Excavation',
    amount: '1000.50',
  },
  {
    key: 'l2',
    target: 'CATEGORY',
    boqNodeId: '',
    spendCategoryId: 'c1',
    description: 'Site labour',
    amount: '2000',
  },
];

function renderEditor(over: Partial<React.ComponentProps<typeof BudgetLinesEditor>> = {}) {
  const onExit = vi.fn();
  renderWithProviders(
    <BudgetLinesEditor
      projectId="p1"
      mode="create"
      versionNumber={3}
      currency="USD"
      initialLines={seeded}
      onExit={onExit}
      {...over}
    />,
  );
  return { onExit };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPending = false;
});

describe('BudgetLinesEditor', () => {
  it('turns every line into inputs, with a live total and one primary action', async () => {
    renderEditor();

    expect(screen.getByLabelText('Description, line 1')).toHaveValue('Excavation');
    expect(screen.getByLabelText('Description, line 2')).toHaveValue('Site labour');
    expect(screen.getByText('$3,000.50')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Budget amount, line 2'), {
      target: { value: '4000' },
    });
    expect(screen.getByText('$5,000.50')).toBeInTheDocument();

    const bar = screen.getByRole('region', { name: 'Budget edit actions' });
    expect(within(bar).getByRole('button', { name: 'Save budget' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('starts a new version with the whole budget in one POST, then leaves edit mode', async () => {
    const user = userEvent.setup();
    mocks.create.mockImplementation((_payload, opts) => opts?.onSuccess?.());
    const { onExit } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Save budget' }));

    expect(mocks.create).toHaveBeenCalledWith(
      {
        currency: 'USD',
        lines: [
          { boqNodeId: 'n1', description: 'Excavation', budgetAmount: 1000.5 },
          { spendCategoryId: 'c1', description: 'Site labour', budgetAmount: 2000 },
        ],
      },
      expect.any(Object),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });

  it('replaces a working version’s lines with one PATCH, and says it will', async () => {
    const user = userEvent.setup();
    renderEditor({ mode: 'edit', budgetId: 'b3', unreadableLineCount: 4 });

    expect(
      screen.getByText(/already has 4 lines that can't be shown here/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(mocks.update).toHaveBeenCalledWith(
      {
        budgetId: 'b3',
        payload: {
          lines: [
            { boqNodeId: 'n1', description: 'Excavation', budgetAmount: 1000.5 },
            { spendCategoryId: 'c1', description: 'Site labour', budgetAmount: 2000 },
          ],
        },
      },
      expect.any(Object),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('adds and removes lines; an incomplete line blocks the save and says why', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add cost line' }));
    expect(screen.getByLabelText('Description, line 3')).toHaveValue('');
    expect(screen.getByText('3 lines')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(
      screen.getByText('Choose the BOQ item or spend category this line budgets for.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove line 3' }));
    expect(screen.queryByLabelText('Description, line 3')).not.toBeInTheDocument();
  });

  it('keeps the last line: a version needs at least one', () => {
    renderEditor({ initialLines: [] });
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled();
  });

  it('leaves at once when nothing changed', async () => {
    const user = userEvent.setup();
    const { onExit } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('asks before discarding unsaved edits, and Keep editing keeps them', async () => {
    const user = userEvent.setup();
    const { onExit } = renderEditor();

    await user.clear(screen.getByLabelText('Description, line 1'));
    await user.type(screen.getByLabelText('Description, line 1'), 'Bulk excavation');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('dialog', { name: 'Discard budget edits?' });

    // The close button carries the same name as the footer's way out; either keeps the edits.
    await user.click(within(confirm).getAllByRole('button', { name: 'Keep editing' })[0]!);
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Description, line 1')).toHaveValue('Bulk excavation');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard edits' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('locks the table and the actions while a save is in flight', () => {
    mocks.createPending = true;
    renderEditor();

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Description, line 1')).toBeDisabled();
  });
});
