import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { QuotationRequestDetail } from '../../quotations/types';

/**
 * Finance's decision screen (spec Q12): totals auto-advance and autosave, the lowest is
 * recomputed live (ties included), Choose appears only once every total is typed, a non-lowest
 * choice needs a reason, the exception acceptance only shows when short, pay-by is required, and
 * segregation of duties is rendered from the server — never decided here.
 */

vi.mock('@/features/workflows/components/approval-panel', () => ({
  ApprovalPanel: ({ instanceId }: { instanceId: string | null }) =>
    instanceId ? <div>Approval chain {instanceId}</div> : null,
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));

const api = vi.hoisted(() => ({
  detail: null as unknown,
  get: vi.fn(),
  total: vi.fn(),
  award: vi.fn(),
  ask: vi.fn(),
  reject: vi.fn(),
}));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: (...args: unknown[]) => api.get(...args),
  enterQuoteTotal: (...args: unknown[]) => api.total(...args),
  awardQuotation: (...args: unknown[]) => api.award(...args),
  askForAnotherQuote: (...args: unknown[]) => api.ask(...args),
  rejectQuote: (...args: unknown[]) => api.reject(...args),
}));

import { QuoteDecisionScreen } from './decision-screen';

// A Finance Officer: may also register a new store as a supplier (manage:payable).
const SELECTOR = ['view:procurement', 'award:quotation', 'manage:payable'];

function pendingWith(approval: { status: string; currentStepOrder: number | null }): Partial<QuotationRequestDetail> {
  return {
    status: 'AWARD_PENDING_APPROVAL',
    quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '5000.00' })],
    proposal: { quoteId: 'k1', paymentPath: 'BUYER_CASH' },
    approval: {
      instanceId: 'inst-9',
      status: approval.status,
      currentStepOrder: approval.currentStepOrder,
      currentStepRole: approval.currentStepOrder ? 'Finance Officer' : null,
      steps: [
        { stepOrder: 1, roleRequired: 'Construction Director', approvedBy: { id: 'cd', name: 'Cabdi' }, approvedAt: '2026-10-07T08:00:00Z' },
        {
          stepOrder: 2,
          roleRequired: 'Finance Officer',
          approvedBy: approval.status === 'APPROVED' ? { id: 'fo', name: 'Faadumo' } : null,
          approvedAt: approval.status === 'APPROVED' ? '2026-10-07T09:00:00Z' : null,
        },
      ],
    },
  };
}

const three = () => [
  quoteFixture({ id: 'k1', name: 'Hodan' }),
  quoteFixture({ id: 'k2', name: 'Bakaara' }),
  quoteFixture({ id: 'k3', name: 'Xamar' }),
];

function render(detail: Partial<QuotationRequestDetail>) {
  api.detail = detailFixture({
    status: 'AWAITING_DECISION',
    sentAt: '2026-10-07T07:00:00.000Z',
    waitingWorkingMinutes: 250,
    slaTone: 'red',
    distinctSupplierCount: 3,
    ...detail,
  });
  api.get.mockImplementation(async () => api.detail);
  return renderWithProviders(<QuoteDecisionScreen id="qr1" />, { permissions: SELECTOR, withToast: true });
}

/** The server echoes the typed total back on the detail. */
function echoTotals() {
  api.total.mockImplementation(async (_id: string, quoteId: string, total: string) => {
    const current = api.detail as QuotationRequestDetail;
    api.detail = {
      ...current,
      quotes: current.quotes.map((q) => (q.id === quoteId ? { ...q, enteredTotal: total } : q)),
    };
    return api.detail;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  echoTotals();
});

describe('QuoteDecisionScreen', () => {
  it('moves to the next total on Enter and autosaves each on blur', async () => {
    const user = userEvent.setup();
    render({ quotes: three() });
    const first = await screen.findByLabelText('Total for Hodan');
    await user.type(first, '2350{Enter}');
    expect(screen.getByLabelText('Total for Bakaara')).toHaveFocus();
    await waitFor(() => expect(api.total).toHaveBeenCalledWith('qr1', 'k1', '2350'));
  });

  it('says when a total did not save, in plain words', async () => {
    const user = userEvent.setup();
    api.total.mockRejectedValue(new TypeError('Failed to fetch'));
    render({ quotes: three() });
    await user.type(await screen.findByLabelText('Total for Hodan'), '2350{Enter}');
    expect(await screen.findByText('Not saved')).toBeInTheDocument();
    expect(screen.getByText('No connection. Try again when you have signal.')).toBeInTheDocument();
  });

  it('marks no quote lowest until every total is in', async () => {
    const user = userEvent.setup();
    render({ quotes: three() });
    await user.type(await screen.findByLabelText('Total for Hodan'), '2350{Enter}');
    expect(screen.queryByText('Lowest')).not.toBeInTheDocument();
  });

  it('highlights the lowest live, including ties, and hides Choose until every total is in', async () => {
    const user = userEvent.setup();
    render({ quotes: three() });
    await user.type(await screen.findByLabelText('Total for Hodan'), '2350{Enter}');
    expect(screen.getAllByText('Type every total to choose').length).toBe(3);
    expect(screen.queryByRole('button', { name: /^Choose / })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Total for Bakaara'), '2410{Enter}');
    await user.type(screen.getByLabelText('Total for Xamar'), '2295{Enter}');

    const cards = screen.getAllByRole('article');
    expect(within(cards[2]!).getByText('Lowest')).toBeInTheDocument();
    expect(within(cards[0]!).queryByText('Lowest')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Choose / })).toHaveLength(3);

    // A tie: both are lowest.
    await user.clear(screen.getByLabelText('Total for Hodan'));
    await user.type(screen.getByLabelText('Total for Hodan'), '2295');
    expect(within(cards[0]!).getByText('Lowest')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Lowest')).toBeInTheDocument();
  });

  it('chooses the lowest with pay-by only (one question)', async () => {
    const user = userEvent.setup();
    api.award.mockResolvedValue(detailFixture({ status: 'AWARDED' }));
    render({
      quotes: [
        quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '2350.00' }),
        quoteFixture({ id: 'k2', name: 'Xamar', enteredTotal: '2295.00' }),
      ],
      distinctSupplierCount: 3,
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Xamar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose Xamar — $2,295.00' });
    expect(within(dialog).queryByText(/Not the lowest/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Fewer stores than needed')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(await within(dialog).findByText('Choose how it is paid')).toBeInTheDocument();
    expect(api.award).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('radio', { name: 'Finance pays supplier' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(api.award).toHaveBeenCalledWith('qr1', { quoteId: 'k2', paymentPath: 'FINANCE_PAYS_SUPPLIER' }),
    );
  });

  it('requires a reason chip for a non-lowest choice, and words for Other', async () => {
    const user = userEvent.setup();
    api.award.mockResolvedValue(detailFixture({ status: 'AWARDED' }));
    render({
      quotes: [
        quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '2350.00' }),
        quoteFixture({ id: 'k2', name: 'Xamar', enteredTotal: '2295.00' }),
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Hodan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose Hodan — $2,350.00' });
    const reasons = within(dialog).getByRole('radiogroup', { name: 'Not the lowest ($2,295.00). Why?' });
    await user.click(within(dialog).getByRole('radio', { name: 'Buyer pays cash' }));
    await user.click(within(reasons).getByRole('radio', { name: 'Other' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(await within(dialog).findByText('Say why you chose it')).toBeInTheDocument();
    expect(api.award).not.toHaveBeenCalled();

    await user.click(within(reasons).getByRole('radio', { name: 'Has stock now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(api.award).toHaveBeenCalledWith('qr1', {
        quoteId: 'k1',
        paymentPath: 'BUYER_CASH',
        nonLowestReason: 'HAS_STOCK',
      }),
    );
  });

  it('asks to accept the exception only when the request is short', async () => {
    const user = userEvent.setup();
    api.award.mockResolvedValue(detailFixture({ status: 'AWARDED' }));
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '180.00' })],
      distinctSupplierCount: 1,
      exceptionReason: 'URGENT',
    });
    expect(await screen.findByText('1 of 3 stores · Urgent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose Hodan' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Buyer pays cash' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(await within(dialog).findByText('Accept the reason to continue')).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Accept 1 of 3 stores: Urgent'));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(api.award).toHaveBeenCalledWith('qr1', {
        quoteId: 'k1',
        paymentPath: 'BUYER_CASH',
        acceptException: true,
      }),
    );
  });

  it('says a server SoD refusal in plain words', async () => {
    const user = userEvent.setup();
    api.award.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'FORBIDDEN', [], { code: 'REQUESTER_CANNOT_SELECT' }),
    );
    render({ quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '90.00' })], requiredQuoteCount: 1, distinctSupplierCount: 1 });
    await user.click(await screen.findByRole('button', { name: 'Choose Hodan' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Buyer pays cash' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(
      await within(dialog).findByText('You raised this material request, so someone else in finance must choose.'),
    ).toBeInTheDocument();
  });

  it('shows a barred selector the photos read-only with the server reason', async () => {
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '90.00' })],
      allowedActions: [
        { action: 'ENTER_TOTAL', enabled: false, reasonCode: 'QUOTE_UPLOADER_CANNOT_SELECT' },
        { action: 'AWARD', enabled: false, reasonCode: 'QUOTE_UPLOADER_CANNOT_SELECT' },
      ],
    });
    expect(await screen.findByText("You can't choose on this request")).toBeInTheDocument();
    expect(
      screen.getByText('You added photos to this request, so someone else in finance must choose.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Total for Hodan')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for another quote' })).not.toBeInTheDocument();
  });

  it('treats 409 AWARD_PENDING_APPROVAL as the approval gate and shows the chain', async () => {
    const user = userEvent.setup();
    api.award.mockRejectedValue(
      new ApiError(409, 'Pending', 'AWARD_PENDING_APPROVAL', [], {
        code: 'AWARD_PENDING_APPROVAL',
        approvalInstanceId: 'inst-9',
      }),
    );
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '5000.00' })],
      requiredQuoteCount: 1,
      distinctSupplierCount: 1,
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Hodan' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Finance pays supplier' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(await screen.findByText('Approval chain inst-9')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists the award chain steps from the read model while pending', async () => {
    render({
      status: 'AWARD_PENDING_APPROVAL',
      quotes: [quoteFixture({ id: 'k1', name: 'Hodan', enteredTotal: '5000.00' })],
      proposal: { quoteId: 'k1', paymentPath: 'BUYER_CASH' },
      approval: {
        instanceId: 'inst-9',
        status: 'PENDING',
        currentStepOrder: 2,
        currentStepRole: 'Finance Officer',
        steps: [
          { stepOrder: 1, roleRequired: 'Construction Director', approvedBy: { id: 'cd', name: 'Cabdi' }, approvedAt: '2026-10-07T08:00:00Z' },
          { stepOrder: 2, roleRequired: 'Finance Officer', approvedBy: null, approvedAt: null },
        ],
      },
    });
    const chain = await screen.findByRole('list', { name: 'Approval chain' });
    expect(within(chain).getByText('Approved by Cabdi')).toBeInTheDocument();
    expect(within(chain).getByText('Waiting')).toBeInTheDocument();
  });

  it('shows the chain to a selector without workflow access, but no approve panel that would fail to load', async () => {
    render(pendingWith({ status: 'PENDING', currentStepOrder: 2 }));
    expect(await screen.findByRole('list', { name: 'Approval chain' })).toBeInTheDocument();
    expect(screen.queryByText(/^Approval chain inst-/)).not.toBeInTheDocument();
  });

  it('mounts the approve panel for someone who can act on the step', async () => {
    api.detail = null;
    const detail = pendingWith({ status: 'PENDING', currentStepOrder: 2 });
    api.get.mockImplementation(async () => detailFixture({ status: 'AWAITING_DECISION', ...detail }));
    renderWithProviders(<QuoteDecisionScreen id="qr1" />, { permissions: [...SELECTOR, 'manage:workflow'] });
    expect(await screen.findByText('Approval chain inst-9')).toBeInTheDocument();
  });

  it('says Approved — complete the choice once every step approved', async () => {
    render(pendingWith({ status: 'APPROVED', currentStepOrder: null }));
    expect(await screen.findByText('Approved — complete the choice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete the choice' })).toBeInTheDocument();
    expect(screen.queryByText(/^Approval chain inst-/)).not.toBeInTheDocument();
  });

  it('still offers Choose while the server only lacks the typed totals (QUOTE_TOTALS_MISSING)', async () => {
    const user = userEvent.setup();
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Hodan' })],
      requiredQuoteCount: 1,
      distinctSupplierCount: 1,
      allowedActions: [
        { action: 'ENTER_TOTAL', enabled: true, reasonCode: null },
        { action: 'AWARD', enabled: false, reasonCode: 'QUOTE_TOTALS_MISSING' },
      ],
    });
    await user.type(await screen.findByLabelText('Total for Hodan'), '90');
    expect(screen.getByRole('button', { name: 'Choose Hodan' })).toBeInTheDocument();
  });

  it('says photos are hidden for the role, with the count, instead of image boxes', async () => {
    render({
      photosVisible: false,
      quotes: [
        quoteFixture({ id: 'k1', name: 'Hodan', photos: [], photoCount: 2 }),
        quoteFixture({ id: 'k2', name: 'Xamar', photos: [], photoCount: 1 }),
      ],
    });
    expect(await screen.findAllByText('Quote photos are hidden for your role')).toHaveLength(2);
    expect(screen.getByText('2 photos')).toBeInTheDocument();
    expect(screen.getByText('1 photo')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open photo full screen/ })).not.toBeInTheDocument();
  });

  it('defaults the supplier to a registered match; registering a new one is an explicit choice', async () => {
    const user = userEvent.setup();
    api.award.mockResolvedValue(detailFixture({ status: 'AWARDED' }));
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Xamar Steel', enteredTotal: '90.00' })],
      requiredQuoteCount: 1,
      distinctSupplierCount: 1,
      supplierMatches: [{ quoteId: 'k1', suppliers: [{ id: 's9', code: 'SUP-9', name: 'Xamar Steel Ltd' }] }],
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Xamar Steel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Xamar Steel Ltd' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('radio', { name: 'Buyer pays cash' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(api.award).toHaveBeenCalledWith('qr1', { quoteId: 'k1', paymentPath: 'BUYER_CASH', awardSupplierId: 's9' }),
    );
  });

  it('says a new store will be registered when nothing matches', async () => {
    const user = userEvent.setup();
    render({
      quotes: [quoteFixture({ id: 'k1', name: 'Bakaara Market', enteredTotal: '90.00' })],
      requiredQuoteCount: 1,
      distinctSupplierCount: 1,
    });
    await user.click(await screen.findByRole('button', { name: 'Choose Bakaara Market' }));
    expect(
      await screen.findByText('Choosing this store registers it as a new supplier: Bakaara Market'),
    ).toBeInTheDocument();
  });

  it('tells a selector without manage:payable up front that a Finance Officer must register the store', async () => {
    api.detail = detailFixture({
      status: 'AWAITING_DECISION',
      quotes: [quoteFixture({ id: 'k1', name: 'Bakaara Market', enteredTotal: '90.00' })],
      requiredQuoteCount: 1,
      distinctSupplierCount: 1,
    });
    api.get.mockImplementation(async () => api.detail);
    renderWithProviders(<QuoteDecisionScreen id="qr1" />, { permissions: ['view:procurement', 'award:quotation'] });
    expect(await screen.findByText('A Finance Officer must register this store first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose Bakaara Market' })).not.toBeInTheDocument();
  });

  it('asks for another quote with a quick note', async () => {
    const user = userEvent.setup();
    api.ask.mockResolvedValue(detailFixture({ status: 'RETURNED' }));
    render({ quotes: three() });
    await user.click(await screen.findByRole('button', { name: 'Ask for another quote' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask for another quote' });
    await user.click(within(dialog).getByRole('button', { name: 'Get one more store' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send note' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledWith('qr1', 'Get one more store'));
  });

  it('shows the waiting time with its tone in words', async () => {
    render({ quotes: three() });
    const waiting = await screen.findByText('Over 4 h');
    expect(waiting.closest('[data-sla]')).toHaveAttribute('data-sla', 'red');
    expect(screen.getByText('4 h 10 m')).toBeInTheDocument();
  });
});
