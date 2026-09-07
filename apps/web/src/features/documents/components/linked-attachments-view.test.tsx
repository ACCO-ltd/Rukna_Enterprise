import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedAttachmentListResponse, LinkedAttachmentResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Linked Attachments is a read model, and the tests that matter are the ones proving it stays
 * one: no Attach, no Delete, no edit of any kind. Every file here belongs to another aggregate
 * with its own rules about when its evidence may change, and a mutation offered on this screen
 * would route around all of them.
 */
const docMocks = vi.hoisted(() => ({ useLinkedAttachments: vi.fn() }));
vi.mock('../hooks/use-documents', () => docMocks);

import { LinkedAttachmentsView } from './linked-attachments-view';

function attachment(over: Partial<LinkedAttachmentResponse> = {}): LinkedAttachmentResponse {
  return {
    attachmentId: 'a1',
    fileId: 'f1',
    fileName: 'site-photo-14.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 512000,
    lifecycle: 'IMMUTABLE',
    sourceType: 'DAILY_PROGRESS_REPORT',
    sourceId: 'dpr1',
    sourceReference: 'DPR 2026-09-04',
    context: 'Progress',
    sourceHref: '/projects/p1/progress',
    uploadedBy: 'u1',
    uploadedByName: 'Ahmed Shirie',
    uploadedAt: '2026-09-04T09:00:00.000Z',
    ...over,
  };
}

function mount(items: LinkedAttachmentResponse[] | undefined) {
  const data: LinkedAttachmentListResponse | undefined = items
    ? { items, total: items.length, page: 1, pageSize: 25 }
    : undefined;
  docMocks.useLinkedAttachments.mockReturnValue({
    data,
    isPending: items === undefined,
    isError: false,
    refetch: vi.fn(),
  });
  return renderWithProviders(<LinkedAttachmentsView projectId="p1" />);
}

describe('LinkedAttachmentsView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the owning record and where it lives', () => {
    mount([attachment()]);
    expect(screen.getByText('Daily Progress Report')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('links the reference to the record that can actually change the file', () => {
    mount([attachment()]);
    expect(screen.getByRole('link', { name: 'DPR 2026-09-04' })).toHaveAttribute(
      'href',
      '/projects/p1/progress',
    );
  });

  it('renders a reference with no screen as text rather than a link that 404s', () => {
    mount([attachment({ sourceHref: null, sourceReference: 'BILL-00031' })]);
    expect(screen.queryByRole('link', { name: 'BILL-00031' })).not.toBeInTheDocument();
    expect(screen.getByText('BILL-00031')).toBeInTheDocument();
  });

  it('offers no way to attach or delete from the aggregation', () => {
    mount([attachment()]);
    expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
  });

  /** "Locked" is why the parent will refuse — stated before the reader goes looking. */
  it('shows the file state so a frozen file is explained, not just refused later', () => {
    mount([attachment()]);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('marks a still-replaceable file differently from a frozen one', () => {
    mount([attachment({ lifecycle: 'BOUND' })]);
    expect(screen.getByText('Attached')).toBeInTheDocument();
  });

  it('does not tell an empty project to drag files anywhere', () => {
    mount([]);
    expect(screen.getByText('No linked evidence yet')).toBeInTheDocument();
    expect(screen.queryByText(/drag/i)).not.toBeInTheDocument();
  });
});
