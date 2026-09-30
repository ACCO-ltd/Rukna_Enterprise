import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCostBudgetLineResponse } from '@erp/types';

import Link from 'next/link';

import { renderWithProviders } from '@/test/render';

/**
 * The cost budget is edited in its own table (ADR-039), not in a side sheet. What matters:
 * the save model is unchanged (the whole version in one call — POST to start a version, PATCH to
 * replace a working version's lines), an edit starts from every saved line and never writes over
 * lines it has not seen, invalid or retired targets never reach the server, the total is live,
 * and every way out — Cancel, an internal link — asks before discarding edits.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  push: vi.fn(),
  createPending: false,
  draft: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
// next/link renders a plain anchor; the guard sees internal links by their DOM `<a href>`.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/procurement/hooks/use-project-procurement', () => ({
  useCreateProjectCostBudget: () => ({
    mutate: mocks.create,
    isPending: mocks.createPending,
    error: null,
  }),
  useUpdateProjectCostBudget: () => ({ mutate: mocks.update, isPending: false, error: null }),
  useProjectCostBudget: () => mocks.draft,
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

function line(i: number, over: Partial<ProjectCostBudgetLineResponse> = {}): ProjectCostBudgetLineResponse {
  return {
    id: `d${i}`,
    boqNodeId: null,
    boqNodeCode: null,
    spendCategoryId: 'c1',
    spendCategoryName: 'Labour',
    description: `Line ${i}`,
    budgetAmount: `${i * 100}.00`,
    sortOrder: i - 1,
    ...over,
  };
}

function renderEditor(over: Partial<React.ComponentProps<typeof BudgetLinesEditor>> = {}) {
  const onExit = vi.fn();
  renderWithProviders(
    <>
      <Link href="/projects">Projects</Link>
      <BudgetLinesEditor
        projectId="p1"
        mode="create"
        versionNumber={3}
        currency="USD"
        seedLines={seeded}
        onExit={onExit}
        {...over}
      />
    </>,
  );
  return { onExit };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPending = false;
  mocks.draft = { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
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

  it('opens a 12-line working version with all 12 lines and saves the edited set in one PATCH', async () => {
    const user = userEvent.setup();
    mocks.draft = {
      data: { id: 'b3', lines: Array.from({ length: 12 }, (_, i) => line(i + 1)) },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderEditor({ mode: 'edit', budgetId: 'b3', seedLines: undefined });

    expect(screen.getByText('12 lines')).toBeInTheDocument();
    expect(screen.getByLabelText('Description, line 12')).toHaveValue('Line 12');
    expect(screen.queryByText(/can't be shown here/i)).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Description, line 3'));
    await user.type(screen.getByLabelText('Description, line 3'), 'Concrete pour');
    await user.click(screen.getByRole('button', { name: 'Remove line 12' }));
    await user.click(screen.getByRole('button', { name: 'Save budget' }));

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [{ budgetId, payload }] = mocks.update.mock.calls[0]!;
    expect(budgetId).toBe('b3');
    expect(payload.lines).toHaveLength(11);
    expect(payload.lines[0]).toEqual({ spendCategoryId: 'c1', description: 'Line 1', budgetAmount: 100 });
    expect(payload.lines[2]).toEqual({
      spendCategoryId: 'c1',
      description: 'Concrete pour',
      budgetAmount: 300,
    });
  });

  it('shows a skeleton while the working version loads, with Save unavailable', () => {
    mocks.draft = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderEditor({ mode: 'edit', budgetId: 'b3', seedLines: undefined });

    expect(screen.getByRole('status', { name: /loading the working version/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Description, line 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeDisabled();
  });

  it('never saves over lines it could not load', async () => {
    const user = userEvent.setup();
    mocks.draft = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    const { onExit } = renderEditor({ mode: 'edit', budgetId: 'b3', seedLines: undefined });

    expect(screen.getByText("Could not load this version's lines")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.draft.refetch).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('flags a saved target that is no longer offered and blocks Save until it is re-picked', async () => {
    const user = userEvent.setup();
    mocks.draft = {
      data: {
        id: 'b3',
        lines: [
          line(1, { boqNodeId: 'gone', boqNodeCode: '9.9', spendCategoryId: null, spendCategoryName: null }),
          line(2, { spendCategoryId: 'retired', spendCategoryName: 'Old plant' }),
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderEditor({ mode: 'edit', budgetId: 'b3', seedLines: undefined });

    // Said at once, naming the old target — not only after Save.
    expect(screen.getByText('9.9: no longer available — pick another.')).toBeInTheDocument();
    expect(screen.getByText('Old plant: no longer available — pick another.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(mocks.update).not.toHaveBeenCalled();
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
    renderEditor({ seedLines: [] });
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

  it('intercepts an internal link while there are unsaved edits, and only goes on agreement', async () => {
    const user = userEvent.setup();
    renderEditor();

    // Clean: the link is not held.
    const link = screen.getByRole('link', { name: 'Projects' });
    await user.type(screen.getByLabelText('Description, line 1'), ' works');
    await user.click(link);

    const confirm = await screen.findByRole('dialog', { name: 'Discard budget edits?' });
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(within(confirm).getAllByRole('button', { name: 'Keep editing' })[0]!);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Description, line 1')).toHaveValue('Excavation works');

    await user.click(link);
    await user.click(await screen.findByRole('button', { name: 'Discard edits' }));
    expect(mocks.push).toHaveBeenCalledWith('/projects');
  });

  it('locks the table and the actions while a save is in flight', () => {
    mocks.createPending = true;
    renderEditor();

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Description, line 1')).toBeDisabled();
  });
});
