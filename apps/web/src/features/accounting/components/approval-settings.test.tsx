import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getApprovalSettings, updateApprovalSettings } from '../api/accounting-api';

import { ApprovalSettingsPanel } from './approval-settings';

vi.mock('../api/accounting-api', () => ({ getApprovalSettings: vi.fn(), updateApprovalSettings: vi.fn() }));

const defaults = { invoiceApprovalAbove: null, billApprovalAbove: null, autoPostToleratedBills: false, paymentAutoApproveUpTo: '1000.00' };

describe('ApprovalSettingsPanel (ADR-046 §8)', () => {
  it('shows the defaults and saves an invoice approval amount', async () => {
    const user = userEvent.setup();
    vi.mocked(getApprovalSettings).mockResolvedValue(defaults);
    vi.mocked(updateApprovalSettings).mockImplementation(async (body) => body);
    renderWithProviders(<ApprovalSettingsPanel />, { permissions: ['manage:accounting'] });

    // Payments are approved on save up to $1,000 by default; nothing else needs approval.
    expect(await screen.findByRole('switch', { name: /Approve small payments/ })).toBeChecked();
    expect(screen.getByLabelText('Payments up to')).toHaveValue('1,000.00');
    expect(screen.getByRole('switch', { name: /Large invoices need approval/ })).not.toBeChecked();

    await user.click(screen.getByRole('switch', { name: /Large invoices need approval/ }));
    await user.type(screen.getByLabelText('Invoices of this amount or more'), '25000');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => expect(updateApprovalSettings).toHaveBeenCalled());
    expect(vi.mocked(updateApprovalSettings).mock.calls[0]![0]).toEqual({
      invoiceApprovalAbove: '25000',
      billApprovalAbove: null,
      autoPostToleratedBills: false,
      paymentAutoApproveUpTo: '1000.00',
    });
  });

  it('is read-only without manage:accounting', async () => {
    vi.mocked(getApprovalSettings).mockResolvedValue(defaults);
    renderWithProviders(<ApprovalSettingsPanel />, { permissions: ['view:accounting'] });
    expect(await screen.findByText('Only someone who manages accounting can change these rules.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();
    expect(screen.getByRole('switch', { name: /Approve small payments/ })).toBeDisabled();
  });
});
