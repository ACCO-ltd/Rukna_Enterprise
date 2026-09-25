import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import * as commercialApi from '../api/commercial-api';

import type { MilestoneItemViewModel } from '../milestone-journey.adapter';
import { SendInvoiceDialog } from './send-invoice-dialog';

vi.mock('../api/commercial-api', async (importOriginal) => {
  const actual = await importOriginal<typeof commercialApi>();
  return { ...actual, getIssuedInvoiceDocument: vi.fn(), recordPackageDelivery: vi.fn() };
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
      // A persisted journey only ever surfaces once its billing package has ≥1 document
      // (contract-milestones-tab.tsx's `.find(... candidate.documents.length > 0)`), so an
      // empty array here would not be a realistic default — it would silently exercise a
      // state real production data never reaches.
      documents: [
        {
          invoiceId: 'inv-1',
          invoiceNumber: 'INV-2026-0142',
          sourceType: 'MILESTONE',
          sourceReference: 'Structure payment',
          subtotal: '200000.00',
          salesTax: '10000.00',
          total: '210000.00',
          dueDate: '2026-10-17',
          outstanding: '210000.00',
          deliveries: [],
        },
      ],
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
  clientName = 'Client',
  onSent = vi.fn(),
  onClose = vi.fn(),
} = {}) {
  return renderWithProviders(
    <SendInvoiceDialog
      open={open}
      milestone={milestone}
      projectId={projectId}
      currency={currency}
      clientName={clientName}
      onSent={onSent}
      onClose={onClose}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SendInvoiceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commercialApi.getIssuedInvoiceDocument).mockResolvedValue({
      url: 'https://files.example/invoice-0142.pdf',
    });
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
    renderDialog({
      milestone: makeMilestone({
        invoiceJourney: {
          phase: 'issued',
          invoiceId: 'inv-1',
          invoiceDate: '2026-09-17',
          dueDate: '2026-10-17',
          documents: [
            {
              invoiceId: 'inv-1',
              invoiceNumber: 'INV-2026-0142',
              sourceType: 'MILESTONE',
              sourceReference: 'Structure payment',
              subtotal: '200000.00',
              salesTax: '10000.00',
              total: '210000.00',
              dueDate: '2026-10-17',
              outstanding: '210000.00',
              deliveries: [],
            },
          ],
        },
      }),
    });

    const markBtn = screen.getByRole('button', { name: /mark as sent/i });
    expect(markBtn).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /whatsapp/i }));
    await user.type(screen.getByLabelText('Recipient'), '+252 61 123 4567');
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

  it('opens WhatsApp before recording the package as sent', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSent = vi.fn();
    renderDialog({
      onSent,
      milestone: makeMilestone({
        invoiceJourney: {
          phase: 'issued',
          invoiceId: 'inv-1',
          invoiceDate: '2026-09-17',
          dueDate: '2026-10-17',
          documents: [
            {
              invoiceId: 'inv-1',
              invoiceNumber: 'INV-2026-0142',
              sourceType: 'MILESTONE',
              sourceReference: 'Structure payment',
              subtotal: '200000.00',
              salesTax: '10000.00',
              total: '210000.00',
              dueDate: '2026-10-17',
              outstanding: '210000.00',
              deliveries: [],
            },
          ],
        },
      }),
    });

    await user.click(screen.getByRole('radio', { name: /whatsapp/i }));
    await user.type(screen.getByLabelText('Recipient'), '+252 61 123 4567');
    await user.click(screen.getByRole('button', { name: /open whatsapp/i }));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/'),
      '_blank',
      'noopener,noreferrer',
    );
    const openedUrl = new URL(vi.mocked(open).mock.calls[0]?.[0] as string);
    const message = openedUrl.searchParams.get('text');
    expect(message).toContain('Dear Client,');
    expect(message).toContain('INV-2026-0142');
    expect(message).toContain('Structure payment');
    expect(message).toContain('Amount due: $210,000.00');
    expect(message).toContain('Kind regards');
    expect(message).toContain('https://files.example/invoice-0142.pdf');
    expect(commercialApi.recordPackageDelivery).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /confirm sent/i }));
    expect(commercialApi.recordPackageDelivery).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith('inst-1', 'whatsapp');
    open.mockRestore();
  });

  it('hard-blocks every delivery method — not just WhatsApp — while any document lacks an invoice number', async () => {
    const user = userEvent.setup();
    renderDialog({
      milestone: makeMilestone({
        invoiceJourney: {
          phase: 'issued',
          invoiceId: 'inv-1',
          invoiceDate: '2026-09-17',
          dueDate: '2026-10-17',
          documents: [
            {
              invoiceId: 'inv-1',
              invoiceNumber: null,
              sourceType: 'MILESTONE',
              sourceReference: 'Structure payment',
              subtotal: '200000.00',
              salesTax: '10000.00',
              total: '210000.00',
              dueDate: '2026-10-17',
              outstanding: '210000.00',
              deliveries: [],
            },
          ],
        },
      }),
    });

    await user.click(screen.getByRole('radio', { name: /email/i }));
    expect(screen.getByRole('button', { name: /mark as sent/i })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /physical/i }));
    expect(screen.getByRole('button', { name: /mark as sent/i })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /other/i }));
    expect(screen.getByRole('button', { name: /mark as sent/i })).toBeDisabled();
  });

  it('does not open WhatsApp when a package contains an unnumbered invoice', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderDialog({
      milestone: makeMilestone({
        invoiceJourney: {
          phase: 'issued',
          invoiceId: 'inv-1',
          invoiceDate: '2026-09-17',
          dueDate: '2026-10-17',
          documents: [
            {
              invoiceId: 'inv-1',
              invoiceNumber: null,
              sourceType: 'MILESTONE',
              sourceReference: 'Structure payment',
              subtotal: '200000.00',
              salesTax: '10000.00',
              total: '210000.00',
              dueDate: '2026-10-17',
              outstanding: '210000.00',
              deliveries: [],
            },
          ],
        },
      }),
    });

    await user.click(screen.getByRole('radio', { name: /whatsapp/i }));
    await user.type(screen.getByLabelText('Recipient'), '+252 61 123 4567');

    expect(screen.getByText(/cannot be sent until every invoice has an assigned inv number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open whatsapp/i })).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
