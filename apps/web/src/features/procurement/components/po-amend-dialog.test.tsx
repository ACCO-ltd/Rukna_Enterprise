import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrder, PurchaseOrderRevision } from '../types';
import { PoAmendDialog } from './po-amend-dialog';

/**
 * The amend dialog on FormDialog (ADR-039): the line editor itself is covered by
 * `po-line-editor.test.tsx`, so it is stubbed here and these tests are about the container —
 * the dismissal guard, the pinned footer, and the revise call being unchanged.
 */

const mocks = vi.hoisted(() => ({
  revise: { mutate: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('../hooks/use-procurement', () => ({
  useRevisePurchaseOrder: () => mocks.revise,
}));

vi.mock('./po-line-editor', async (importOriginal) => {
  const original = await importOriginal<typeof import('./po-line-editor')>();
  return { ...original, PoLineEditor: () => <div data-testid="line-editor" /> };
});

const source = {
  id: 'rev-1',
  revisionNumber: 1,
  status: 'ACTIVE',
  currencyCode: 'USD',
  effectiveFrom: '2026-09-01T00:00:00.000Z',
  reason: null,
  deliveryAddress: 'Site gate 2',
  expectedDeliveryDate: null,
  approvedAt: null,
  approvedBy: null,
  quotationRef: null,
  quotationDate: null,
  quotedAmount: null,
  lines: [],
} as unknown as PurchaseOrderRevision;

const order = {
  id: 'po-1',
  poNumber: 'PO-0007',
  status: 'OPEN',
  supplierId: 'sup-1',
  currentRevisionId: 'rev-1',
  supplier: null,
  approvalInstanceId: null,
  closedAt: null,
  revisions: [source],
} as unknown as PurchaseOrder;

function renderDialog() {
  const onClose = vi.fn();
  renderWithProviders(<PoAmendDialog order={order} source={source} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.revise = { mutate: vi.fn(), isPending: false, error: null };
});

describe('PoAmendDialog — FormDialog', () => {
  it('is titled by the order and keeps the line editor in the scrolling body', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Amend PO-0007' });
    const body = dialog.querySelector('[data-form-dialog-body]');
    expect(body!.contains(screen.getByTestId('line-editor'))).toBe(true);
    expect(body!.contains(screen.getByRole('button', { name: 'Save draft revision' }))).toBe(false);
  });

  it('closes straight away when nothing was changed', async () => {
    const onClose = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding a typed reason', async () => {
    const onClose = renderDialog();
    await userEvent.type(screen.getByLabelText('Reason'), 'Price change');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while the revision is being saved', async () => {
    mocks.revise = { mutate: vi.fn(), isPending: true, error: null };
    const onClose = renderDialog();
    expect(screen.getByRole('button', { name: 'Save draft revision' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still requires a reason before calling revise', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft revision' }));
    expect(mocks.revise.mutate).not.toHaveBeenCalled();
  });
});
