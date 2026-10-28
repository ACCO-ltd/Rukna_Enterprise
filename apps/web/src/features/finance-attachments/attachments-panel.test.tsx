import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { AttachmentsPanel, formatFileSize } from './attachments-panel';

const mocks = vi.hoisted(() => ({
  held: new Set<string>(),
  list: vi.fn(),
  attach: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/features/auth/permissions/can', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/permissions/can')>()),
  usePermissions: () => ({ can: (p: string) => mocks.held.has(p) }),
}));
vi.mock('./hooks', () => ({
  useFinanceAttachments: () => mocks.list(),
  useAttachFinanceFile: () => ({ mutateAsync: mocks.attach, isPending: false }),
  useRemoveFinanceAttachment: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  fileId: 'f1',
  fileName: 'supplier-invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 245_760,
  addedAfterPosting: false,
  locked: false,
  createdBy: 'u1',
  createdAt: '2026-10-28T09:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mocks.held = new Set();
  mocks.list.mockReset();
  mocks.attach.mockReset();
  mocks.remove.mockReset();
});

describe('AttachmentsPanel (Step 4)', () => {
  it('lets the payables clerk attach and remove files on a draft bill', async () => {
    mocks.held = new Set(['manage:payable']);
    mocks.list.mockReturnValue({ data: [row()], isPending: false, isError: false });
    renderWithProviders(<AttachmentsPanel kind="BILL" ownerId="bill-1" />);

    expect(screen.getByRole('button', { name: 'supplier-invoice.pdf' })).toBeInTheDocument();
    expect(screen.getByText(/240 KB/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove supplier-invoice.pdf' }));
    expect(mocks.remove).toHaveBeenCalledWith('a1');

    const file = new File(['x'], 'delivery-note.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Attach files'), file);
    expect(mocks.attach).toHaveBeenCalledWith(file);
  });

  it('keeps a posted document’s files: no remove, and marks late additions', () => {
    mocks.held = new Set(['manage:receivable']);
    mocks.list.mockReturnValue({ data: [row({ locked: true, addedAfterPosting: true })], isPending: false, isError: false });
    renderWithProviders(<AttachmentsPanel kind="INVOICE" ownerId="inv-1" />);

    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText('Added after posting')).toBeInTheDocument();
    expect(screen.getByText(/its files are part of the record/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
  });

  it('is read-only for a reader of the books, and hidden from everyone else', () => {
    mocks.held = new Set(['view:accounting']);
    mocks.list.mockReturnValue({ data: [], isPending: false, isError: false });
    const { unmount } = renderWithProviders(<AttachmentsPanel kind="PAYMENT" ownerId="p-1" />);
    expect(screen.getByText('No files attached.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    unmount();

    mocks.held = new Set(['manage:receivable']);
    renderWithProviders(<AttachmentsPanel kind="JOURNAL" ownerId="j-1" />);
    expect(screen.queryByText('Attachments')).toBeNull();
  });

  it('formats sizes the way people read them', () => {
    expect(formatFileSize(900)).toBe('900 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});
