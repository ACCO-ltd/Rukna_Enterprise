import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import * as commercialApi from '../api/commercial-api';

import type { MilestoneItemViewModel } from '../milestone-journey.adapter';
import { SendInvoiceDialog } from './send-invoice-dialog';

vi.mock('../api/commercial-api', async (importOriginal) => {
  const actual = await importOriginal<typeof commercialApi>();
  return { ...actual, recordPackageDelivery: vi.fn() };
});

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeMilestone(
  overrides: Partial<MilestoneItemViewModel> = {},
): MilestoneItemViewModel {
  return {
    id: 'inst-1',
    sortOrder: 1,
    name: 'Structure payment',
    percentage: '0.4000',
    baseAmount: '200000.00',
    triggerType: 'MILESTONE',
    userState: 'invoice-issued',
    expectedDate: null,
    dateLabel: null,
    programmeMilestone: null,
    variationAllocations: [],
    readyToBill: true,
    invoiceReference: null,
    invoiceJourney: {
      phase: 'issued',
      invoiceId: 'inv-1',
      invoiceDate: '2026-09-17',
      dueDate: '2026-10-17',
    },
    ...overrides,
  };
}

function renderDialog({
  open = true,
  milestone = makeMilestone(),
  projectId = 'p-1',
  currency = 'USD',
  onSent = vi.fn(),
  onClose = vi.fn(),
} = {}) {
  return renderWithProviders(
    <SendInvoiceDialog
      open={open}
      milestone={milestone}
      projectId={projectId}
      currency={currency}
      onSent={onSent}
      onClose={onClose}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SendInvoiceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commercialApi.recordPackageDelivery).mockResolvedValue({ deliveries: [] });
  });

  it('1. Shows invoice total (with VAT) and due date after issue', () => {
    renderDialog();
    // 200,000 × 1.05 = 210,000
    expect(screen.getByText(/210,000/)).toBeInTheDocument();
    // Due date from journey
    expect(screen.getByText(/oct.*17.*2026|17.*oct.*2026|2026.*10.*17/i)).toBeInTheDocument();
  });

  it('2. Delivery method RadioGroup: all four options render and are selectable', async () => {
    const user = userEvent.setup();
    renderDialog();
    const whatsapp = screen.getByRole('radio', { name: /whatsapp/i });
    const email = screen.getByRole('radio', { name: /email/i });
    const physical = screen.getByRole('radio', { name: /physical/i });
    const other = screen.getByRole('radio', { name: /other/i });

    expect(whatsapp).toBeInTheDocument();
    expect(email).toBeInTheDocument();
    expect(physical).toBeInTheDocument();
    expect(other).toBeInTheDocument();

    await user.click(email);
    expect(email).toBeChecked();
  });

  it('3. "Mark as sent" disabled until delivery method selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    const markBtn = screen.getByRole('button', { name: /mark as sent/i });
    expect(markBtn).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /whatsapp/i }));
    expect(markBtn).not.toBeDisabled();
  });

  it('4. "Mark as sent" calls onSent with correct installmentId and deliveryMethod', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    renderDialog({ onSent });

    await user.click(screen.getByRole('radio', { name: /email/i }));
    await user.click(screen.getByRole('button', { name: /mark as sent/i }));

    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith('inst-1', 'email');
  });

  it('5. "I\'ll send it later" calls onClose and NOT onSent', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSent, onClose });

    // Select a method so the button state isn't a factor
    await user.click(screen.getByRole('radio', { name: /physical/i }));
    await user.click(screen.getByRole('button', { name: /send it later/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
  });
});
