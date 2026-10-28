import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { documentReaderApi } from './api';
import { ReadPhotoButton } from './read-photo-button';

const mocks = vi.hoisted(() => ({ ready: true }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  useDocumentReader: () => ({ ready: mocks.ready, status: undefined }),
  documentReaderApi: { read: vi.fn() },
}));

describe('ReadPhotoButton (Step 7)', () => {
  it('is not offered while the company has the reader off', () => {
    mocks.ready = false;
    renderWithProviders(<ReadPhotoButton fileId="f1" kind="RECEIPT" onRead={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Read the photo' })).toBeNull();
  });

  it('reads the photo, hands the result to the form, and asks the person to check it', async () => {
    mocks.ready = true;
    vi.mocked(documentReaderApi.read).mockResolvedValue({
      readingId: 'r1', kind: 'RECEIPT', supplierName: 'Horn Cement', documentNumber: 'R-9', date: '2026-10-05', currency: 'USD',
      total: '105.00', taxAmount: '5.00', lines: [], warnings: ['The total does not equal the sum of the lines.'],
    });
    const onRead = vi.fn();
    renderWithProviders(<ReadPhotoButton fileId="f1" kind="RECEIPT" onRead={onRead} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Read the photo' }));
    expect(documentReaderApi.read).toHaveBeenCalledWith('f1', 'RECEIPT');
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ total: '105.00' }));
    expect(await screen.findByText('Filled in from the photo — check each field')).toBeInTheDocument();
    expect(screen.getByText('The total does not equal the sum of the lines.')).toBeInTheDocument();
  });
});
