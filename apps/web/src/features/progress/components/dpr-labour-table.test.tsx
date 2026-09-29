import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));

vi.mock('../hooks/use-progress', () => ({
  useAddLabourRow: () => ({ mutate: mocks.add, isPending: false }),
  useRemoveLabourRow: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock('@/features/procurement/hooks/use-procurement', () => ({
  useSuppliers: () => ({ data: [{ id: 's1', name: 'Hodan Builders' }], isPending: false }),
}));
// TRADE_OPTIONS only; the rest of dpr-detail is not needed here.
vi.mock('./dpr-detail', () => ({ TRADE_OPTIONS: ['Mason', 'Carpenter'] }));

import { DprLabourTable } from './dpr-labour-table';

const ROWS = [
  { id: 'r1', dprId: 'd1', trade: 'Mason', headcount: 6, contractor: 'In-House / Direct', hours: '8' },
];

beforeEach(() => vi.clearAllMocks());

describe('DprLabourTable', () => {
  it('lists the rows with their man-hours', () => {
    renderWithProviders(<DprLabourTable dprId="d1" rows={ROWS} />);
    expect(screen.getByText('Mason', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/48 man-hrs total/)).toBeInTheDocument();
  });

  it('adds a row from the add line with a secondary "Add row" button', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderWithProviders(<DprLabourTable dprId="d1" rows={[]} onDirtyChange={onDirtyChange} />);

    const addRow = screen.getByRole('button', { name: 'Add row' });
    // Secondary (outline), never a primary — and disabled until a trade and headcount are in.
    expect(addRow).not.toHaveClass('bg-brand-ink');
    expect(addRow).toBeDisabled();

    await chooseOption(user, screen.getByLabelText('Trade'), 'Carpenter');
    await user.type(screen.getByLabelText('Headcount'), '4');
    await user.type(screen.getByLabelText('Hours per worker'), '7.5');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(addRow);
    expect(mocks.add).toHaveBeenCalledWith(
      { trade: 'Carpenter', headcount: 4, contractor: 'In-House / Direct', hours: 7.5 },
      expect.anything(),
    );
  });

  it('removes a row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DprLabourTable dprId="d1" rows={ROWS} />);
    await user.click(screen.getByRole('button', { name: 'Remove the Mason row' }));
    expect(mocks.remove).toHaveBeenCalledWith('r1', expect.anything());
  });
});
