import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrder, PurchaseOrderRevision } from '../../types';

vi.mock('../../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listPoRevisionAttachments: async () => [
    {
      id: 'a1',
      purchaseOrderRevisionId: 'rev1',
      platformFileId: 'f1',
      purpose: 'QUOTATION',
      supplierRef: 'QR-00041',
      attachedBy: 'u1',
      createdAt: '2026-10-07',
      file: { originalName: 'quote-1.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
    },
  ],
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

  it('renders nothing on an order not raised from an award', () => {
    const { container } = renderWithProviders(<AwardEvidence order={order} revision={revision('SUP-INV-9')} />);
    expect(container).toBeEmptyDOMElement();
    expect(isAwardReference('qr-00002')).toBe(true);
    expect(isAwardReference(null)).toBe(false);
  });
});
