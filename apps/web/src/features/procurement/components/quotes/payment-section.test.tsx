import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { payDraftFixture, paymentFixture, releaseDraftFixture } from '../../quotations/payment-fixtures';
import type { QuotationPayment } from '../../quotations/payment-types';
import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { QuotationRequestDetail } from '../../quotations/types';

/**
 * Finance's Payment section (ADR-045 P11, wireframes A–C, F): prefilled dialogs, one tap, the
 * server's refusals and disabled reasons in words, the approval gate, money hidden when blind.
 */

const api = vi.hoisted(() => ({
  detail: null as unknown,
  releaseDraft: vi.fn(),
  release: vi.fn(),
  payDraft: vi.fn(),
  pay: vi.fn(),
}));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: async () => api.detail,
}));
vi.mock('../../api/quotation-payment-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getReleaseDraft: (...args: unknown[]) => api.releaseDraft(...args),
  releaseCash: (...args: unknown[]) => api.release(...args),
  getPayDraft: (...args: unknown[]) => api.payDraft(...args),
  payFromAward: (...args: unknown[]) => api.pay(...args),
}));
vi.mock('@/features/workflows/components/approval-panel', () => ({
  ApprovalPanel: ({ instanceId }: { instanceId: string | null }) => <div data-testid="approval-panel">{instanceId}</div>,
}));

import { useQuotationRequest } from '../../hooks/use-quotations';
import { PaymentSection } from './payment-section';

const PAYER = ['view:procurement', 'manage:payable', 'award:quotation', 'view:commitment-ledger'];

function awarded(payment: Partial<QuotationPayment> = {}): QuotationRequestDetail {
  return detailFixture({
    status: 'AWARDED',
    quotes: [quoteFixture({ id: 'k1', name: 'Bakaara Steel', enteredTotal: '1000.00' })],
    award: {
      quoteId: 'k1',
      total: '1000.00',
      supplier: { id: 's9', name: 'Bakaara Steel' },
      paymentPath: payment.path ?? 'BUYER_CASH',
    },
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311', status: 'OPEN' },
    payment: paymentFixture(payment),
  });
}

/** Renders the section from the query cache, as the decision screen does. */
function Harness() {
  const detail = useQuotationRequest('qr1');
  return detail.data ? <PaymentSection detail={detail.data} /> : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.detail = awarded();
  api.releaseDraft.mockResolvedValue(releaseDraftFixture());
  api.payDraft.mockResolvedValue(payDraftFixture());
});

describe('PaymentSection — buyer cash', () => {
  it('names the buyer on the one primary button and opens the release dialog prefilled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { permissions: PAYER });

    const primary = await screen.findByRole('button', { name: 'Release cash to Ahmed' });
    expect(screen.getByText('Ready to pay')).toBeInTheDocument();
    await user.click(primary);

    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    expect(within(dialog).getByText('PO-00311 · Bakaara Steel')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('1,000.00');
    expect(within(dialog).getByText('At most $1,000.00 — what the order still needs.')).toBeInTheDocument();
    expect(within(dialog).getByText('Only cash accounts without signatories can hand out buyer cash.')).toBeInTheDocument();
    expect(within(dialog).getByText('No approval needed — you release it.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Release $1,000.00' })).toBeEnabled();
  });

  it('one tap posts with the prefilled body and the section moves to cash with the buyer', async () => {
    const user = userEvent.setup();
    const released = paymentFixture({
      state: 'CASH_WITH_BUYER',
      funded: '1000.00',
      remainingToFund: '0.00',
      withBuyer: '1000.00',
      advances: [
        { id: 'adv1', recipientName: 'Ahmed Ali', amount: '1000.00', advancedAt: '2026-10-08', applied: '0.00', returned: '0.00', outstanding: '1000.00', legacy: false },
      ],
      allowedActions: [{ action: 'RECORD_RECEIPT', enabled: false, reason: 'GOODS_NOT_RECEIVED' }],
    });
    api.release.mockImplementation(async () => {
      api.detail = awarded(released);
      return { advance: { id: 'adv1' }, payment: released };
    });
    renderWithProviders(<Harness />, { permissions: PAYER });

    await user.click(await screen.findByRole('button', { name: 'Release cash to Ahmed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    await user.click(within(dialog).getByRole('button', { name: 'Release $1,000.00' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const body = api.release.mock.calls[0]![0];
    expect(body).toMatchObject({
      quotationRequestId: 'qr1',
      recipientUserId: 'u-ahmed',
      amount: '1000.00',
      bankAccountId: 'ba-cash',
      paymentMethod: 'CASH',
      advancedAt: '2026-10-08',
    });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    expect(await screen.findByText('Cash with buyer')).toBeInTheDocument();
    expect(screen.getByText('With Ahmed')).toBeInTheDocument();
    // Recording waits for the goods — said in words under the disabled button.
    expect(screen.getByRole('button', { name: /Record receipt/ })).toBeDisabled();
    expect(screen.getByText('Waiting for the site to receive the goods.')).toBeInTheDocument();
  });

  it('a gated release is not a failure: it says "Sent for approval" and keeps the body for "Release now"', async () => {
    const user = userEvent.setup();
    api.release.mockRejectedValueOnce(
      new ApiError(409, 'Approval required', 'CONFLICT', [], { approvalInstanceId: 'wf-7' }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });

    await user.click(await screen.findByRole('button', { name: 'Release cash to Ahmed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    await user.click(within(dialog).getByRole('button', { name: 'Release $1,000.00' }));

    expect(await screen.findByText('Sent for approval')).toBeInTheDocument();
    expect(screen.getByTestId('approval-panel')).toHaveTextContent('wf-7');
    const firstBody = api.release.mock.calls[0]![0];

    api.release.mockResolvedValueOnce({ advance: { id: 'adv1' }, payment: null });
    await user.click(screen.getByRole('button', { name: 'Release now' }));
    await waitFor(() => expect(api.release).toHaveBeenCalledTimes(2));
    expect(api.release.mock.calls[1]![0]).toEqual(firstBody);
  });

  it('renders a disabled action with the server reason in words (dual-control account)', async () => {
    api.detail = awarded({
      allowedActions: [{ action: 'RELEASE_CASH', enabled: false, reason: 'ACCOUNT_REQUIRES_DUAL_CONTROL' }],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    expect(await screen.findByRole('button', { name: 'Release cash to Ahmed' })).toBeDisabled();
    expect(
      screen.getByText(
        "This account needs two signatories, so it can't hand out buyer cash. Choose the cash box or the EVC float.",
      ),
    ).toBeInTheDocument();
  });

  it('explains missing set-up (no cash account, no Staff advances profile) with links to fix it', async () => {
    api.releaseDraft.mockResolvedValue(
      releaseDraftFixture({
        accounts: [],
        blockers: ['NO_ELIGIBLE_CASH_ACCOUNT', 'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE'],
      }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });

    expect(await screen.findByText(/Buyer cash comes only from a cash box or an EVC float/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a cash box or EVC float' })).toHaveAttribute(
      'href',
      '/finance/accounting/bank-accounts?preset=cash-box',
    );
    expect(screen.getByRole('link', { name: 'Set up staff advances' })).toHaveAttribute(
      'href',
      '/finance/accounting/posting-profiles',
    );
  });

  it('shows the refusal in words inside the dialog (funding cap)', async () => {
    const user = userEvent.setup();
    api.release.mockRejectedValueOnce(
      new ApiError(409, 'Funding exceeds order', 'CONFLICT', [], { code: 'FUNDING_EXCEEDS_ORDER' }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Release cash to Ahmed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    await user.click(within(dialog).getByRole('button', { name: 'Release $1,000.00' }));
    expect(await within(dialog).findByText('That would pay more than the order total. Lower the amount.')).toBeInTheDocument();
  });

  it('hides money for a money-blind viewer and offers no money command without manage:payable', async () => {
    api.detail = awarded({ moneyVisible: false, orderedAmount: null, funded: null, remainingToFund: null, withBuyer: null });
    renderWithProviders(<Harness />, { permissions: ['view:procurement', 'collect:quotation'] });
    expect(await screen.findByText('Amounts are hidden for your role.')).toBeInTheDocument();
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Release cash/ })).not.toBeInTheDocument();
    expect(api.releaseDraft).not.toHaveBeenCalled();
  });
});

describe('PaymentSection — finance pays supplier', () => {
  it('opens Pay prefilled (prepay by default) and says the account needs signatures', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.pay.mockResolvedValueOnce({ payment: { id: 'sp1' }, awaiting: 'RELEASE_SIGNATURES' });
    renderWithProviders(<Harness />, { permissions: PAYER });

    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    expect(within(dialog).getByRole('radio', { name: /Pay now, before goods/ })).toBeChecked();
    expect(within(dialog).getByText('This account needs two bank signatures before the money goes out.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Pay $1,000.00' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.pay.mock.calls[0]![0]).toMatchObject({
      quotationRequestId: 'qr1',
      bankAccountId: 'ba-salaam',
      paymentMethod: 'BANK',
      amount: '1000.00',
      shape: 'PREPAY',
    });
    expect(screen.getByText('Waiting for bank signatures')).toBeInTheDocument();
  });

  it('pre-empts the vendor-maintainer rule: the store was registered by this user', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.payDraft.mockResolvedValue(
      payDraftFixture({ supplier: { id: 's9', name: 'Bakaara Steel', isVendorMaintainer: true, maintainerName: null } }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    expect(within(dialog).getByText('You registered this store, so another finance user must pay it.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Pay $1,000.00' })).toBeDisabled();
  });

  it('defaults to paying the posted invoice when there is one', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.payDraft.mockResolvedValue(
      payDraftFixture({ shape: 'PAY_BILL', bills: [{ id: 'b1', number: 'BILL-0091', outstanding: '980.00' }] }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    expect(within(dialog).getByRole('radio', { name: /Pay the invoice BILL-0091/ })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Pay $980.00' })).toBeEnabled();
  });
});
