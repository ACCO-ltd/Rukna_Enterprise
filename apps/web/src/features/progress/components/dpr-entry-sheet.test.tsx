import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useDpr: vi.fn(),
  useWorkPackages: vi.fn(),
  useProjectProgress: vi.fn(),
  useSubmitDpr: vi.fn(),
  useAddMeasurement: vi.fn(),
  usePatchDprContext: vi.fn(),
  useRemoveMeasurement: vi.fn(),
  useBoqLeaves: vi.fn(),
  submit: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useDpr: mocks.useDpr,
  useWorkPackages: mocks.useWorkPackages,
  useProjectProgress: mocks.useProjectProgress,
  useSubmitDpr: mocks.useSubmitDpr,
  useAddMeasurement: mocks.useAddMeasurement,
  usePatchDprContext: mocks.usePatchDprContext,
  useRemoveMeasurement: mocks.useRemoveMeasurement,
  progressKeys: {
    report: (id: string) => ['progress-report', id],
    reports: (projectId: string) => ['progress', projectId, 'reports'],
  },
}));
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: mocks.useBoqLeaves,
  lineLabel: (l: { code: string; description: string }) => `${l.code} ${l.description}`,
}));
// Labour, evidence and the read-only detail reuse dpr-detail's own (separately tested) pieces.
vi.mock('./dpr-detail', () => ({
  DprDetail: () => <p>read-only report</p>,
  DprEvidence: () => <p>photos</p>,
  LabourSection: () => <p>labour rows</p>,
}));

import { DprEntrySheet } from './dpr-entry-sheet';

const DPR = {
  id: 'dpr-1',
  projectId: 'p1',
  reportDate: '2026-09-28',
  status: 'DRAFT',
  preparedBy: 'test-user',
  measurements: [{ id: 'm1', dprId: 'dpr-1', boqNodeId: 'n1', quantity: '2' }],
  attachments: [],
  labourRows: [],
  equipmentRows: [],
  observations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDpr.mockReturnValue({ data: DPR, isPending: false, isError: false });
  mocks.useBoqLeaves.mockReturnValue({
    isPending: false,
    hasBaseline: true,
    leaves: [
      { id: 'n1', code: '1.1', description: 'Excavation', path: [], unit: 'm3', quantity: '100' },
      { id: 'n2', code: '2.1', description: 'Columns', path: [], unit: 'm3', quantity: '40' },
      { id: 'n3', code: '9.9', description: 'Loose item', path: [], unit: null, quantity: null },
    ],
  });
  mocks.useWorkPackages.mockReturnValue({
    isPending: false,
    data: [
      { id: 'wp1', code: 'WP-01', name: 'Substructure', boqNodeIds: ['n1'] },
      { id: 'wp2', code: 'WP-02', name: 'Frame', boqNodeIds: ['n2'] },
    ],
  });
  mocks.useProjectProgress.mockReturnValue({
    data: [{ boqNodeId: 'n1', measurableQuantity: '100', verifiedToDate: '10' }],
  });
  mocks.useSubmitDpr.mockReturnValue({ mutate: mocks.submit, isPending: false });
  mocks.useAddMeasurement.mockReturnValue({ mutate: mocks.add, isPending: false });
  mocks.patch.mockResolvedValue({});
  mocks.usePatchDprContext.mockReturnValue({ mutateAsync: mocks.patch, isPending: false });
  mocks.useRemoveMeasurement.mockReturnValue({ mutate: mocks.remove, isPending: false });
});

const render = (onClose = vi.fn()) =>
  renderWithProviders(<DprEntrySheet projectId="p1" dprId="dpr-1" onClose={onClose} />, {
    permissions: ['record:progress'],
    withToast: true,
  });

describe('DprEntrySheet', () => {
  it('groups every item by work package with a to-date hint', () => {
    render();

    expect(screen.getByText('WP-01 Substructure')).toBeInTheDocument();
    expect(screen.getByText('WP-02 Frame')).toBeInTheDocument();
    expect(screen.getByText('Not in a work package')).toBeInTheDocument();
    // verified 10 + 2 already on this report, of 100.
    expect(screen.getByText(/To date 12.000 m3 of 100.000 m3/)).toBeInTheDocument();
    expect(screen.getByText(/2.000 m3 on this report/)).toBeInTheDocument();
    expect(screen.getByText('labour rows')).toBeInTheDocument();
    expect(screen.getByText('photos')).toBeInTheDocument();
  });

  it('saves a quantity as it is entered', async () => {
    const user = userEvent.setup();
    render();

    await user.type(screen.getByRole('spinbutton', { name: 'Quantity today for 2.1 Columns' }), '5');
    const row = screen.getByText('2.1 Columns').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Add' }));
    expect(mocks.add).toHaveBeenCalledWith({ boqNodeId: 'n2', quantity: 5 }, expect.anything());
  });

  it('"Save draft" only closes; "Submit for review" is the primary', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(onClose);

    expect(screen.getByRole('button', { name: 'Submit for review' })).toHaveClass('bg-brand-ink');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('maps DPR_EXCEEDS_BOQ_QUANTITY to an inline error on the item', async () => {
    const user = userEvent.setup();
    mocks.submit.mockImplementation((_v, opts) =>
      opts.onError(
        new ApiError(400, 'Over quantity', 'DPR_EXCEEDS_BOQ_QUANTITY', [], {
          lines: [{ boqNodeId: 'n1', maxForThisReport: '88', unit: 'm3' }],
        }),
      ),
    );
    render();

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    // Inline, with a direct "remove what is recorded here" hint…
    expect(
      screen.getByText('Enter 88.000 m3 or less, or raise a variation. Remove 2.000 m3 recorded here to correct it.'),
    ).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: 'Quantity today for 1.1 Excavation' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // …a form-level summary naming the item…
    expect(
      screen.getByText('1 item exceeds its BOQ quantity: 1.1 Excavation — enter 88.000 m3 or less'),
    ).toBeInTheDocument();
    // …and focus on the first errored field.
    expect(input).toHaveFocus();
  });

  it('removes a recorded entry, and says so when the server refuses', async () => {
    const user = userEvent.setup();
    mocks.remove.mockImplementation((_id, opts) => opts.onError(new ApiError(404, 'Not found', 'NOT_FOUND')));
    render();

    await user.click(screen.getByRole('button', { name: 'Remove 2.000 m3 from 1.1 Excavation' }));
    expect(mocks.remove).toHaveBeenCalledWith('m1', expect.anything());
    expect(screen.getByText('Could not remove the entry: Not found')).toBeInTheDocument();
  });

  it('saves pending site notes and waits before submitting', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    mocks.patch.mockImplementation(async () => {
      order.push('patch');
    });
    mocks.submit.mockImplementation(() => order.push('submit'));
    render();

    await user.type(screen.getByRole('textbox', { name: 'Site notes' }), 'Poured slab B');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(mocks.patch).toHaveBeenCalledWith({ narrative: 'Poured slab B' });
    expect(order[order.length - 1]).toBe('submit');
    expect(order).toContain('patch');
  });

  it('keeps the sheet open with the error when the notes cannot be saved', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.patch.mockRejectedValue(new ApiError(500, 'Server down', 'INTERNAL'));
    render(onClose);

    const notes = screen.getByRole('textbox', { name: 'Site notes' });
    await user.type(notes, 'Rain stopped work');
    // Straight to Save draft: the flush is what saves the notes, and its failure blocks the close.
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Site notes could not be saved: Server down')).length).toBeGreaterThan(0);
  });

  it('offers no Remove on a reopened report, whose earlier entries the server keeps', () => {
    mocks.useDpr.mockReturnValue({ data: { ...DPR, status: 'REOPENED' }, isPending: false, isError: false });
    render();
    expect(screen.getByText(/2.000 m3 on this report/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    // The entry itself is still listed, and one line says why it cannot be removed.
    expect(screen.getByRole('list', { name: '2.000 m3 on this report' })).toHaveTextContent('2.000 m3');
    expect(
      screen.getByText("Entries approved before the reopen can't be removed; add a correction note instead."),
    ).toBeInTheDocument();
  });

  it('falls back to a form-level message for any other error', async () => {
    const user = userEvent.setup();
    mocks.submit.mockImplementation((_v, opts) => opts.onError(new ApiError(409, 'Already submitted', 'CONFLICT')));
    render();

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(screen.getByText('Already submitted')).toBeInTheDocument();
  });

  it('shows the reviewer reason on a returned report', () => {
    mocks.useDpr.mockReturnValue({
      data: { ...DPR, status: 'RETURNED', returnReason: 'Add photos of the pour' },
      isPending: false,
      isError: false,
    });
    render();
    expect(screen.getByText('Returned by the reviewer: Add photos of the pour')).toBeInTheDocument();
  });

  it('opens a submitted report read-only', () => {
    mocks.useDpr.mockReturnValue({ data: { ...DPR, status: 'SUBMITTED' }, isPending: false, isError: false });
    render();
    expect(screen.getByText('read-only report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });
});
