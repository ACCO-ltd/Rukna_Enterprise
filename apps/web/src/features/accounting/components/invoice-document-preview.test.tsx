import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * The phone preview of an invoice PDF opens in a read-only FormDialog (ADR-039), which is full
 * screen below `sm`. It fetches the signed URL only once opened.
 */
const mocks = vi.hoisted(() => ({ useInvoiceDocumentUrl: vi.fn() }));
vi.mock('../hooks/use-invoices', () => mocks);

import { MobileInvoicePreviewTrigger } from './invoice-document-preview';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useInvoiceDocumentUrl.mockReturnValue({
    data: { url: 'https://files.example/inv.pdf', originalName: 'INV-0001.pdf' },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('MobileInvoicePreviewTrigger', () => {
  it('opens the document in a dialog with Close as its only way out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MobileInvoicePreviewTrigger invoiceId="inv-1" />);

    // Not fetched while closed.
    expect(mocks.useInvoiceDocumentUrl).not.toHaveBeenCalledWith('inv-1', true);

    await user.click(screen.getByRole('button', { name: 'Preview document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invoice document' });
    expect(mocks.useInvoiceDocumentUrl).toHaveBeenLastCalledWith('inv-1', true);
    expect(within(dialog).getByTitle('INV-0001.pdf')).toBeInTheDocument();

    const close = within(dialog)
      .getAllByRole('button', { name: 'Close' })
      .find((button) => button.textContent === 'Close');
    await user.click(close!);
    expect(screen.queryByRole('dialog', { name: 'Invoice document' })).not.toBeInTheDocument();
  });
});
