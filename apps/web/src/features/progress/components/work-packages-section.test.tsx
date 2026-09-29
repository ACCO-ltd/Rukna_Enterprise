import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  getProjectRollup: vi.fn(),
  update: vi.fn(),
  suggest: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
  useAllocateBoqNode: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateWorkPackage: () => ({ mutate: vi.fn(), isPending: false }),
  progressKeys: { rollup: (projectId: string) => ['progress', projectId, 'rollup'] },
}));
vi.mock('../api/progress-api', () => ({ getProjectRollup: mocks.getProjectRollup }));
vi.mock('@/features/programme/hooks/use-programme', () => ({
  useUpdateWorkPackage: () => ({ mutateAsync: mocks.update, mutate: vi.fn(), isPending: false }),
  useSuggestWeights: () => ({ mutate: mocks.suggest, isPending: false }),
}));
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({ leaves: [], hasBaseline: true }),
  lineLabel: (l: { code: string }) => l.code,
}));

import { WorkPackageEditor } from './work-packages-section';

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

/** Sums to 1 but not in whole percents: 27.21 / 40.46 / 32.33. */
const SET = [pkg('a', 'WP-01', '0.2721'), pkg('b', 'WP-02', '0.4046'), pkg('c', 'WP-03', '0.3233')];

function rollupOf(packages: ReturnType<typeof pkg>[]) {
  const total = packages.filter((p) => !p.scheduleOnly).reduce((s, p) => s + Number(p.weight), 0);
  return { projectId: 'p1', physicalPercent: 0, weightsTotal: String(total), weightsComplete: total === 1, packages };
}
function query(packages: ReturnType<typeof pkg>[]) {
  return { data: rollupOf(packages), isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
}

const render = (permissions = ['manage:project']) =>
  renderWithProviders(<WorkPackageEditor projectId="p1" primary="weights" />, { permissions, withToast: true });

const weight = (code: string) => screen.getByRole('spinbutton', { name: `Weight for ${code}` });
const totalLine = (text: string) => screen.getByText(text, { selector: 'p' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.useProjectRollup.mockReturnValue(query(SET));
  // By default nobody else has changed anything.
  mocks.getProjectRollup.mockResolvedValue(rollupOf(SET));
});

describe('WorkPackageEditor weights', () => {
  it('shows stored weights at two places with a live total', async () => {
    const user = userEvent.setup();
    render();

    expect(weight('WP-01')).toHaveValue(27.21);
    expect(weight('WP-01')).toHaveAttribute('step', '0.01');
    expect(totalLine('Total 100%')).toHaveClass('text-success');

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '25.46');
    expect(totalLine('Total 85% — must be 100%')).toHaveClass('text-warning');
    // One primary: Save weights takes over from "Suggest from BOQ values".
    expect(screen.getByRole('button', { name: 'Save weights' })).toHaveClass('bg-brand-ink');
    expect(screen.getByRole('button', { name: 'Suggest from BOQ values' })).not.toHaveClass('bg-brand-ink');
  });

  it('announces the total once typing stops, atomically', async () => {
    const user = userEvent.setup();
    render();
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-atomic') === 'true')!;
    expect(live).toHaveAttribute('aria-atomic', 'true');
    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '25.46');
    expect(live).toHaveTextContent('Total 100%');
    await waitFor(() => expect(live).toHaveTextContent('Total 85% — must be 100%'), { timeout: 2000 });
  });

  it('saves only the row the user edited — an untouched 0.2721 is never re-sent', async () => {
    const user = userEvent.setup();
    render();

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '30');
    // The total is off (89.54%): saving is still allowed, the server only reports completeness.
    await user.click(screen.getByRole('button', { name: 'Save weights' }));

    await screen.findByText('Weights saved.');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'b', body: { progressWeight: 0.3 } });
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ workPackageId: 'a' }));
  });

  it('balances only the edited rows to 100% by default, all rows on opt-in', async () => {
    const user = userEvent.setup();
    render();

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '30');
    await user.click(screen.getByRole('button', { name: 'Balance to 100%' }));
    // 100 − 27.21 − 32.33 = 40.46 goes to the one edited row; the others are untouched.
    expect(weight('WP-02')).toHaveValue(40.46);
    expect(weight('WP-01')).toHaveValue(27.21);
    expect(totalLine('Total 100%')).toBeInTheDocument();

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '0');
    await user.click(screen.getByRole('checkbox', { name: 'Include rows I have not edited' }));
    await user.click(screen.getByRole('button', { name: 'Balance to 100%' }));
    // 27.21 : 0 : 32.33 scaled to 100 by largest remainder.
    expect(weight('WP-01')).toHaveValue(45.7);
    expect(weight('WP-02')).toHaveValue(0);
    expect(weight('WP-03')).toHaveValue(54.3);
  });

  it('keeps the drafts of rows that failed, names them, and retries just those', async () => {
    const user = userEvent.setup();
    mocks.update.mockImplementation(({ workPackageId }: { workPackageId: string }) =>
      workPackageId === 'c' ? Promise.reject(new ApiError(500, 'Server down.', 'INTERNAL')) : Promise.resolve({}),
    );
    render();

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '40');
    await user.clear(weight('WP-03'));
    await user.type(weight('WP-03'), '32.79');
    await user.click(screen.getByRole('button', { name: 'Save weights' }));

    expect(
      await screen.findByText('Could not save WP-03: Server down. Your values are kept — save again to retry.'),
    ).toBeInTheDocument();
    expect(weight('WP-03')).toHaveValue(32.79);
    // WP-02 saved; the stale mock rollup shows its stored value again. Save stays for the retry.
    expect(weight('WP-02')).toHaveValue(40.46);

    mocks.update.mockClear();
    mocks.update.mockResolvedValue({});
    await user.click(screen.getByRole('button', { name: 'Save weights' }));
    await screen.findByText('Weights saved.');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'c', body: { progressWeight: 0.3279 } });
  });

  it('stops when another manager changed a row being saved, and shows the fresh value', async () => {
    const user = userEvent.setup();
    render();

    await user.clear(weight('WP-02'));
    await user.type(weight('WP-02'), '30');
    mocks.getProjectRollup.mockResolvedValue(
      rollupOf([SET[0]!, pkg('b', 'WP-02', '0.25'), SET[2]!]),
    );
    await user.click(screen.getByRole('button', { name: 'Save weights' }));

    expect(
      await screen.findByText('WP-02 was changed by someone else (now 25%) — review and save again.'),
    ).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    // Reviewed: a second Save goes through.
    await user.click(screen.getByRole('button', { name: 'Save weights' }));
    await screen.findByText('Weights saved.');
    expect(mocks.update).toHaveBeenCalledWith({ workPackageId: 'b', body: { progressWeight: 0.3 } });
  });

  it('blocks saving an out-of-range weight', async () => {
    const user = userEvent.setup();
    render();
    await user.clear(weight('WP-01'));
    await user.type(weight('WP-01'), '140');
    expect(weight('WP-01')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save weights' })).toBeDisabled();
  });

  it('is read-only without manage:project', () => {
    render(['view:progress']);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('27.21%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest from BOQ values' })).not.toBeInTheDocument();
  });

  it('gives a schedule-only phase no weight input and leaves it out of the total', () => {
    mocks.useProjectRollup.mockReturnValue(
      query([pkg('a', 'WP-01', '1'), pkg('m', 'WP-00', '0', { scheduleOnly: true, percentComplete: null })]),
    );
    render();
    expect(screen.queryByRole('spinbutton', { name: 'Weight for WP-00' })).not.toBeInTheDocument();
    expect(totalLine('Total 100%')).toBeInTheDocument();
  });

  it('keeps the even-split note for a money-blind suggestion', async () => {
    const user = userEvent.setup();
    mocks.suggest.mockImplementation((_v, opts) =>
      opts.onSuccess({
        valueWeighted: false,
        weights: SET.map((p) => ({ workPackageId: p.id, suggestedWeight: 1 / 3 })),
      }),
    );
    render();
    await user.click(screen.getByRole('button', { name: 'Suggest from BOQ values' }));
    expect(screen.getByText(/Weights are split evenly/)).toBeInTheDocument();
  });
});
