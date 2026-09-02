import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { BoqLibraryItem } from '../api/boq-item-library-api';
import type { NodeFormValues } from '../node-form';
import type { DrawerTarget, LibraryIntent } from './boq-item-drawer';

/**
 * The item drawer's library fast-entry path (ADR-020).
 *
 * The plain manual add is unchanged; these pin the *additional* path:
 *  - opening the picker and choosing an item prefills the form (description, unit, method, and
 *    the last-used rate as assistance)
 *  - the picked item's id and the save-to-library choice ride out on submit so the workspace
 *    can run the library side-effects
 *  - the library affordance never appears when editing, or for a section
 */

const mocks = vi.hoisted(() => ({ useLibrarySearch: vi.fn() }));
vi.mock('../hooks/use-boq-item-library', () => mocks);

import { BoqItemDrawer } from './boq-item-drawer';

const ITEM: BoqLibraryItem = {
  id: 'lib-1',
  organizationId: 'org-1',
  code: 'EXC-100',
  description: 'Bulk excavation in ordinary soil',
  defaultUnit: 'm3',
  measurementMethod: 'MILESTONE',
  pricingBasis: 'LUMP_SUM',
  category: 'Earthworks',
  lastUsedRate: '12.50',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  lastUsedProjectId: 'proj-9',
  active: true,
  createdBy: 'u-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ADD_ITEM: DrawerTarget = { mode: 'add', kind: 'item', parent: null, node: null };

function renderDrawer(target: DrawerTarget, overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn<(v: NodeFormValues, t: DrawerTarget, lib: LibraryIntent) => void>();
  renderWithProviders(
    <BoqItemDrawer
      target={target}
      currency="USD"
      readOnly={false}
      isPending={false}
      libraryEnabled
      canViewCommercials
      canSaveToLibrary
      onSubmit={onSubmit}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('BoqItemDrawer — library fast entry', () => {
  it('prefills the form from a picked library item, leaving every field editable', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    renderDrawer(ADD_ITEM);

    // The picker is disclosed, not shown by default — a manual add is unchanged.
    await userEvent.click(screen.getByRole('button', { name: /Add from library/i }));
    await userEvent.click(await screen.findByRole('option', { name: /EXC-100/ }));

    // Description, unit and the last-used rate are seeded from the item.
    expect(screen.getByLabelText(/Description/i)).toHaveValue('Bulk excavation in ordinary soil');
    expect(screen.getByLabelText(/^Unit$/i)).toHaveValue('m3');
    // Rate carried across as assistance.
    expect(screen.getByLabelText(/Unit rate/i)).toHaveValue('12.50');
    // The code is NOT copied — it must be unique within this BOQ, so the user enters their own.
    expect(screen.getByLabelText(/Item code/i)).toHaveValue('');
  });

  it('carries the picked item id out on submit so the workspace records its usage', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    const { onSubmit } = renderDrawer(ADD_ITEM);

    await userEvent.click(screen.getByRole('button', { name: /Add from library/i }));
    await userEvent.click(await screen.findByRole('option', { name: /EXC-100/ }));

    // A code is still required by the form; supply one, then save.
    await userEvent.type(screen.getByLabelText(/Item code/i), '02.01.001');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, , library] = onSubmit.mock.calls[0]!;
    expect(library).toEqual({ pickedItemId: 'lib-1', saveToLibrary: false });
  });

  it('carries a save-to-library choice out on submit for a manual entry', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [], isPending: false, isError: false });
    const { onSubmit } = renderDrawer(ADD_ITEM);

    await userEvent.type(screen.getByLabelText(/Item code/i), 'NEW-1');
    await userEvent.type(screen.getByLabelText(/Description/i), 'A new work item');
    await userEvent.click(screen.getByLabelText(/save this item to the library/i));
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    const [, , library] = onSubmit.mock.calls[0]!;
    expect(library).toEqual({ pickedItemId: null, saveToLibrary: true });
  });

  it('offers no library affordance when editing an existing item', () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    renderDrawer({
      mode: 'edit',
      kind: 'item',
      parent: null,
      node: {
        ...ITEM,
        boqId: 'b1',
        versionId: 'v1',
        parentId: null,
        path: 'n1',
        depth: 1,
        sortOrder: 1,
        isLeaf: true,
        unit: 'm3',
        quantity: '10.000',
        unitRate: '12.00',
        currency: 'USD',
        totalAmount: '120.00',
        originNodeId: null,
        sourceType: 'BASELINE',
        sourceChangeOrderId: null,
        isActive: true,
        children: [],
        computedTotal: '120.00',
      } as unknown as DrawerTarget['node'],
    });

    expect(screen.queryByRole('button', { name: /Add from library/i })).not.toBeInTheDocument();
  });

  it('offers no library affordance for a section', () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    renderDrawer({ mode: 'add', kind: 'section', parent: null, node: null });

    expect(screen.queryByRole('button', { name: /Add from library/i })).not.toBeInTheDocument();
  });

  it('leaves the manual add path untouched when the library is disabled', async () => {
    mocks.useLibrarySearch.mockReturnValue({ data: [ITEM], isPending: false, isError: false });
    const { onSubmit } = renderDrawer(ADD_ITEM, { libraryEnabled: false });

    expect(screen.queryByRole('button', { name: /Add from library/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Item code/i), 'M-1');
    await userEvent.type(screen.getByLabelText(/Description/i), 'Manual item');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [, , library] = onSubmit.mock.calls[0]!;
    expect(library).toEqual({ pickedItemId: null, saveToLibrary: false });
  });
});
