import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrder, PurchaseOrderRevision } from '../../types';

const attachments = vi.hoisted(() => ({ fail: false, rows: null as unknown }));
vi.mock('../../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listPoRevisionAttachments: async () => {
    if (attachments.fail) throw new Error('403');
    if (attachments.rows) return attachments.rows;
    return [
    {
      id: 'a1',
      purchaseOrderRevisionId: 'rev1',
      platformFileId: 'f1',
      purpose: 'QUOTATION',
      supplierRef: 'QR-00041',
      attachedBy: 'u1',
      createdAt: '2026-10-07',
      file: { originalName: 'quote-1.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
      quotationEvidence: true,
    },
  ];
  },
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));

import { AwardEvidence, isAwardReference } from './award-evidence';

const order = { id: 'po7', poNumber: 'PO-00007' } as PurchaseOrder;
const revision = (quotationRef: string | null) =>
  ({ id: 'rev1', revisionNumber: 1, quotationRef }) as PurchaseOrderRevision;

describe('AwardEvidence on a purchase order', () => {
  it('says the award is the approval and shows the winning photo with open/download', async () => {
    renderWithProviders(<AwardEvidence order={order} revision={revision('QR-00041')} />);
    expect(screen.getByText('Approved by quotation award QR-00041')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open: quote-1.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download: quote-1.jpg' })).toBeInTheDocument();
  });

  it('shows only the approval line when the evidence is withheld or the read fails', async () => {
    attachments.rows = [];
    const { unmount } = renderWithProviders(<AwardEvidence order={order} revision={revision('QR-00041')} />);
    expect(screen.getByText('Approved by quotation award QR-00041')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Quote photos')).not.toBeInTheDocument();
    unmount();

    attachments.rows = null;
    attachments.fail = true;
    renderWithProviders(<AwardEvidence order={order} revision={revision('QR-00041')} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Quote photos')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    attachments.fail = false;
  });

  it('renders nothing on an order not raised from an award', () => {
    const { container } = renderWithProviders(<AwardEvidence order={order} revision={revision('SUP-INV-9')} />);
    expect(container).toBeEmptyDOMElement();
    expect(isAwardReference('qr-00002')).toBe(true);
    expect(isAwardReference(null)).toBe(false);
  });
});
