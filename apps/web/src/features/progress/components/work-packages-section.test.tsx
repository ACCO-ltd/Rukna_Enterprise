import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  update: vi.fn(),
  suggest: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
  useAllocateBoqNode: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateWorkPackage: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/programme/hooks/use-programme', () => ({
  useUpdateWorkPackage: () => ({ mutateAsync: mocks.update, mutate: vi.fn(), isPending: false }),
  useSuggestWeights: () => ({ mutate: mocks.suggest, isPending: false }),
}));
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({ leaves: [], hasBaseline: true }),
  lineLabel: (l: { code: string }) => l.code,
}));

import { displayPercents, WorkPackageEditor } from './work-packages-section';

function pkg(id: string, code: string, weight: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    code,
    name: `Package ${code}`,
    responsibleOwner: null,
    weight,
    percentComplete: 0,
    leafCount: 2,
    plannedStart: null,
    plannedEnd: null,
    durationDays: null,
    forecastEnd: null,
    scheduleOnly: false,
    actualStart: null,
    actualFinish: null,
    scheduleStatus: 'INSUFFICIENT_DATA',
    ...extra,
  };
}

const THIRDS = [pkg('a', 'WP-01', '0.3334'), pkg('b', 'WP-02', '0.3333'), pkg('c', 'WP-03', '0.3333')];

function rollup(packages: ReturnType<typeof pkg>[]) {
  const total = packages.filter((p) => !p.scheduleOnly).reduce((s, p) => s + Number(p.weight), 0);
  return {
    data: { projectId: 'p1', physicalPercent: 0, weightsTotal: String(total), weightsComplete: total === 1, packages },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

const render = (permissions = ['manage:project']) =>
  renderWithProviders(<WorkPackageEditor projectId="p1" primary="weights" />, { permissions, withToast: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.useProjectRollup.mockReturnValue(rollup(THIRDS));
});

describe('displayPercents', () => {
  it('shows a complete set as whole percents that add up to exactly 100', () => {
    expect([...displayPercents(THIRDS as never).values()]).toEqual([34, 33, 33]);
  });

  it('shows an incomplete set as it is, never normalised to 100', () => {
    const set = [pkg('a', 'WP-01', '0.5'), pkg('b', 'WP-02', '0.35')];
    expect([...displayPercents(set as never).values()]).toEqual([50, 35]);
  });
});

describe('WorkPackageEditor weights', () => {
  it('edits weights in the table with a live total', async () => {
    const user = userEvent.setup();
    render();

    expect(screen.getByText('Total 100%')).toHaveClass('text-success');
    const first = screen.getByRole('spinbutton', { name: 'Weight for WP-01' });
    expect(first).toHaveValue(34);

    await user.clear(first);
    await user.type(first, '19');
    expect(screen.getByText('Total 85% — must be 100%')).toHaveClass('text-warning');
    // One primary: Save weights takes over from "Suggest from BOQ values".
    expect(screen.getByRole('button', { name: 'Save weights' })).toHaveClass('bg-brand-ink');
    expect(screen.getByRole('button', { name: 'Suggest from BOQ values' })).not.toHaveClass('bg-brand-ink');
  });

  it('saves every row whose stored weight differs from what the table shows', async () => {
    const user = userEvent.setup();
    render();

    const first = screen.getByRole('spinbutton', { name: 'Weight for WP-01' });
    await user.clear(first);
    await user.type(first, '40');
    const second = screen.getByRole('spinbutton', { name: 'Weight for WP-02' });
    await user.clear(second);
    await user.type(second, '27');
    await user.click(screen.getByRole('button', { name: 'Save weights' }));

    // WP-03 was untouched but shows 33 while storing 0.3333: saved too, so the set is exactly 100.
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'a', body: { progressWeight: 0.4 } });
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'b', body: { progressWeight: 0.27 } });
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'c', body: { progressWeight: 0.33 } });
    expect(await screen.findByText('Weights saved.')).toBeInTheDocument();
  });

  it('blocks saving an out-of-range weight', async () => {
    const user = userEvent.setup();
    render();

    const first = screen.getByRole('spinbutton', { name: 'Weight for WP-01' });
    await user.clear(first);
    await user.type(first, '140');
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save weights' })).toBeDisabled();
  });

  it('is read-only without manage:project', () => {
    render(['view:progress']);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('34%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest from BOQ values' })).not.toBeInTheDocument();
  });

  it('gives a schedule-only phase no weight input and leaves it out of the total', () => {
    mocks.useProjectRollup.mockReturnValue(
      rollup([pkg('a', 'WP-01', '1'), pkg('m', 'WP-00', '0', { scheduleOnly: true, percentComplete: null })]),
    );
    render();
    expect(screen.queryByRole('spinbutton', { name: 'Weight for WP-00' })).not.toBeInTheDocument();
    expect(screen.getByText('Total 100%')).toBeInTheDocument();
  });

  it('keeps the even-split note for a money-blind suggestion', async () => {
    const user = userEvent.setup();
    mocks.suggest.mockImplementation((_v, opts) =>
      opts.onSuccess({
        valueWeighted: false,
        weights: THIRDS.map((p) => ({ workPackageId: p.id, suggestedWeight: 1 / 3 })),
      }),
    );
    render();
    await user.click(screen.getByRole('button', { name: 'Suggest from BOQ values' }));
    expect(screen.getByText(/Weights are split evenly/)).toBeInTheDocument();
  });
});
