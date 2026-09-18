import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import * as commercialApi from '../api/commercial-api';

import type { InvoiceJourneyPhase, MilestoneItemViewModel } from '../milestone-journey.adapter';
import type { CommercialSummaryResponse } from '@erp/types';

import { PrepareInvoiceDialog } from './prepare-invoice-dialog';

vi.mock('../api/commercial-api', async (importOriginal) => {
  const actual = await importOriginal<typeof commercialApi>();
  return { ...actual, issuePackage: vi.fn() };
});

// ─── Factories ────────────────────────────────────────────────────────────────

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
    userState: 'ready-to-bill',
    expectedDate: null,
    dateLabel: null,
    programmeMilestone: null,
    variationAllocations: [],
    readyToBill: true,
    invoiceReference: null,
    invoiceJourney: null,
    ...overrides,
  };
}

function makeSummary(
  overrides: Partial<CommercialSummaryResponse> = {},
): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CNT-001',
      status: 'ACTIVE',
      currency: 'USD',
      clientName: 'Test Client',
      billingModel: 'MILESTONE',
      executedAt: null,
    },
    client: null,
    contractValue: null,
    receivables: {
      outstandingInvoices: [],
      overdueInvoices: [],
    },
    recentActivity: [],
    ...overrides,
  } as CommercialSummaryResponse;
}

function renderDialog({
  open = true,
  milestone = makeMilestone() as MilestoneItemViewModel | null,
  summary = makeSummary(),
  onInvoiceIssued = vi.fn(),
  onClose = vi.fn(),
}: {
  open?: boolean;
  milestone?: MilestoneItemViewModel | null;
  summary?: CommercialSummaryResponse;
  onInvoiceIssued?: (id: string, j: InvoiceJourneyPhase) => void;
  onClose?: () => void;
} = {}) {
  return renderWithProviders(
    <PrepareInvoiceDialog
      open={open}
      milestone={milestone}
      summary={summary}
      onInvoiceIssued={onInvoiceIssued}
      onClose={onClose}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PrepareInvoiceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Guard: returns null (nothing rendered) when milestone is null', () => {
    const { container } = renderDialog({ milestone: null });
    expect(container.firstChild).toBeNull();
  });

  it('2. Composition: milestone base amount and each VO render in separate rows', () => {
    const milestone = makeMilestone({
      baseAmount: '200000.00',
      variationAllocations: [
        {
          variationId: 'vo-1',
          reference: 'VO-001',
          title: 'Boundary Wall',
          amount: '15000.00',
          isOmission: false,
        },
        {
          variationId: 'vo-2',
          reference: 'VO-002',
          title: 'Extra Drainage',
          amount: '5000.00',
          isOmission: false,
        },
      ],
    });
    renderDialog({ milestone });
    expect(screen.getAllByText('Milestone base').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VO-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VO-002').length).toBeGreaterThanOrEqual(1);
  });

  it('3. Draft: preview shows "DRAFT PREVIEW" label while form is open', () => {
    renderDialog();
    expect(screen.getAllByText(/draft preview/i).length).toBeGreaterThanOrEqual(1);
  });

  it('4. Null due date: "Issue invoice" button is disabled when dueDate is empty', () => {
    renderDialog();
    const issueBtn = screen.getByRole('button', { name: /issue invoice/i });
    expect(issueBtn).toBeDisabled();
  });

  it('5. Fields: typing into payment terms and due date updates the form', async () => {
    const user = userEvent.setup();
    renderDialog();

    const dueDateInput = screen.getByLabelText(/due date/i, { selector: 'input[type="date"]' });
    await user.type(dueDateInput, '2026-10-31');

    const issueBtn = screen.getByRole('button', { name: /issue invoice/i });
    expect(issueBtn).not.toBeDisabled();

    const termsInput = screen.getByLabelText(/payment terms/i);
    await user.type(termsInput, 'Net 30');
    expect(termsInput).toHaveValue('Net 30');
  });

  it('6. Distinct CTAs: "Issue invoice" (disabled until due date) and "Cancel"', () => {
    renderDialog();
    const issueBtn = screen.getByRole('button', { name: /issue invoice/i });
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(issueBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();
    // Issue invoice is disabled until dueDate is set
    expect(issueBtn).toBeDisabled();
  });

  it('7. Issue success: onInvoiceIssued called with correct installmentId and invoiceJourney', async () => {
    const user = userEvent.setup();
    const onInvoiceIssued = vi.fn();

    vi.mocked(commercialApi.issuePackage).mockResolvedValueOnce({
      milestoneInvoice: { id: 'inv-abc' },
    } as Awaited<ReturnType<typeof commercialApi.issuePackage>>);

    renderDialog({ onInvoiceIssued });

    const dueDateInput = screen.getByLabelText(/due date/i, { selector: 'input[type="date"]' });
    await user.type(dueDateInput, '2026-10-31');

    const issueBtn = screen.getByRole('button', { name: /issue invoice/i });
    await user.click(issueBtn);

    await waitFor(() => {
      expect(onInvoiceIssued).toHaveBeenCalledTimes(1);
    });

    const [calledId, calledJourney] = onInvoiceIssued.mock.calls[0] as [string, InvoiceJourneyPhase];
    expect(calledId).toBe('inst-1');
    expect(calledJourney.phase).toBe('issued');
    expect(calledJourney.invoiceId).toBe('inv-abc');
    expect(calledJourney.dueDate).toBe('2026-10-31');
  });

  it('8. Issue error: API error message shown in form body, not toast', async () => {
    const user = userEvent.setup();

    vi.mocked(commercialApi.issuePackage).mockRejectedValueOnce(
      new Error('Milestone not yet verified'),
    );

    renderDialog();

    const dueDateInput = screen.getByLabelText(/due date/i, { selector: 'input[type="date"]' });
    await user.type(dueDateInput, '2026-10-31');

    const issueBtn = screen.getByRole('button', { name: /issue invoice/i });
    await user.click(issueBtn);

    await waitFor(() => {
      expect(screen.getByText(/milestone not yet verified/i)).toBeInTheDocument();
    });
  });

  it('9. No accounting terminology in rendered DOM', () => {
    const { container } = renderDialog();
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bAPPROVED\b/);
    expect(html).not.toMatch(/\bPOSTED\b/);
    expect(html).not.toMatch(/\bNOT_POSTED\b/);
    expect(html).not.toMatch(/\bDRAFT\b/); // DRAFT is an accounting state; "Draft Preview" label is allowed
  });
});
