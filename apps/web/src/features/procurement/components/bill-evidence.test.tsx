import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/** A bill recorded from a store receipt shows the buyer's photos as evidence (ADR-045 review). */

vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));

import { BillEvidence } from './bill-evidence';

const evidence = {
  storeDocumentId: 'sd-1',
  number: 'SD-00019',
  kind: 'RECEIPT' as const,
  photos: [
    { fileId: 'f-1', pageNumber: 1 },
    { fileId: 'f-2', pageNumber: 2 },
  ],
};

describe('BillEvidence', () => {
  it('shows the receipt photos to someone who may see prices', async () => {
    renderWithProviders(<BillEvidence evidence={evidence} />, {
      permissions: ['view:procurement', 'view:commitment-ledger', 'manage:payable'],
    });
    expect(screen.getByText("Recorded from the store's receipt SD-00019, photographed by the buyer.")).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Receipt, page 1' })).toHaveAttribute('src', 'https://files.test/f-1');
    expect(await screen.findByRole('img', { name: 'Receipt, page 2' })).toBeInTheDocument();
  });

  it('withholds the photos without cost visibility and says how many pages there are', () => {
    renderWithProviders(<BillEvidence evidence={evidence} />, { permissions: ['manage:payable'] });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('2 photos')).toBeInTheDocument();
  });
});
