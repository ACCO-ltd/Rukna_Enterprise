import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedViewDto, SavedViewState } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { ListViewsBar, sameViewState } from './list-views-bar';

const create = vi.fn();
const update = vi.fn();
const publish = vi.fn();
const remove = vi.fn();
let savedViews: SavedViewDto[] = [];
let admin = false;

vi.mock('../hooks/use-saved-views', () => ({
  useSavedViews: () => ({ data: savedViews }),
  useSavedViewMutations: () => ({
    create: { mutate: create, isPending: false },
    update: { mutate: update, isPending: false },
    publish: { mutate: publish, isPending: false },
    remove: { mutate: remove, isPending: false },
  }),
}));
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: () => admin }),
}));

const view = (over: Partial<SavedViewDto>): SavedViewDto => ({
  id: 'v1',
  listKey: 'invoices',
  name: 'Water agency',
  state: { search: 'water' },
  published: false,
  mine: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});

/** A list holding its own state, as a real screen does. */
function Harness({ onApply }: { onApply?: (s: SavedViewState) => void }) {
  const [state, setState] = useState<SavedViewState>({});
  return (
    <>
      <ListViewsBar
        listKey="invoices"
        label="Invoice views"
        builtIns={[
          { id: 'all', label: 'All', state: {}, count: 3 },
          { id: 'drafts', label: 'Drafts', state: { filters: { status: 'DRAFT' } }, count: 1 },
        ]}
        current={state}
        onApply={(s) => {
          setState(s);
          onApply?.(s);
        }}
      />
      <button type="button" onClick={() => setState((s) => ({ ...s, search: 'hand typed' }))}>
        type
      </button>
    </>
  );
}

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  publish.mockReset();
  remove.mockReset();
  savedViews = [];
  admin = false;
});

describe('sameViewState', () => {
  it('ignores empty filters and filter order, but not sort or search', () => {
    expect(sameViewState({ filters: { a: '1', b: '' } }, { filters: { a: '1' } })).toBe(true);
    expect(sameViewState({ filters: { a: '1', c: '2' } }, { filters: { c: '2', a: '1' } })).toBe(true);
    expect(sameViewState({ search: 'x' }, {})).toBe(false);
    expect(sameViewState({ sort: { key: 'a', direction: 'asc' } }, { sort: { key: 'a', direction: 'desc' } })).toBe(false);
  });
});

describe('ListViewsBar (Step 2a, ADR-047)', () => {
  it('shows built-in views with counts, and applies one when picked', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness onApply={onApply} />);
    expect(screen.getByRole('tab', { name: /All\s*3/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Drafts/ }));
    expect(onApply).toHaveBeenCalledWith({ filters: { status: 'DRAFT' } });
    expect(screen.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /Save view/ })).not.toBeInTheDocument();
  });

  it('offers Save view once the list is changed by hand, and saves the current state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'type' }));
    // No tab claims to show a list it no longer matches.
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'false');
    await user.click(screen.getByRole('button', { name: /Save view/ }));
    await user.type(screen.getByLabelText(/View name/), 'My search');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(create).toHaveBeenCalledWith(
      { name: 'My search', state: { search: 'hand typed' } },
      expect.anything(),
    );
  });

  it('marks shared views, and lets only an admin share or unshare', async () => {
    savedViews = [view({ id: 'v1', name: 'Mine' }), view({ id: 'v2', name: 'Team', published: true, mine: false })];
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<Harness />);
    expect(screen.getByRole('tab', { name: /Team · Shared/ })).toBeInTheDocument();

    // A non-admin may rename and delete their own view, but not share it.
    await user.click(screen.getByRole('tab', { name: /^Mine/ }));
    await user.click(screen.getByRole('button', { name: 'Manage view Mine' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Share with everyone/ })).not.toBeInTheDocument();
    unmount();

    admin = true;
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('tab', { name: /^Mine/ }));
    await user.click(screen.getByRole('button', { name: 'Manage view Mine' }));
    await user.click(screen.getByRole('menuitem', { name: /Share with everyone/ }));
    expect(publish).toHaveBeenCalledWith({ id: 'v1', published: true });
  });

  it("offers Save changes on an edited view of one's own", async () => {
    savedViews = [view({ id: 'v1', name: 'Mine', state: { search: 'water' } })];
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('tab', { name: /^Mine/ }));
    await user.click(screen.getByRole('button', { name: 'type' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith({ id: 'v1', state: { search: 'hand typed' } });
  });

  it('confirms before deleting a view', async () => {
    savedViews = [view({ id: 'v1', name: 'Mine' })];
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('tab', { name: /^Mine/ }));
    await user.click(screen.getByRole('button', { name: 'Manage view Mine' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete view' }));
    expect(screen.getByText('Delete “Mine”?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete view' }));
    expect(remove).toHaveBeenCalledWith('v1', expect.anything());
  });
});
