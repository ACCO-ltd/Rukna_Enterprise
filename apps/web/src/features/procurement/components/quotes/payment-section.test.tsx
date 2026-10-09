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
  cont: vi.fn(),
  apply: vi.fn(),
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
  continuePendingPayment: (...args: unknown[]) => api.cont(...args),
  applyPrepayment: (...args: unknown[]) => api.apply(...args),
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
  // clearAllMocks keeps queued *Once results; a test that does not consume one must not leak it.
  api.release.mockReset();
  api.pay.mockReset();
  api.cont.mockReset();
  api.apply.mockReset();
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
        { id: 'adv1', recipientUserId: 'u-ahmed', recipientName: 'Ahmed Ali', amount: '1000.00', advancedAt: '2026-10-08', applied: '0.00', returned: '0.00', outstanding: '1000.00', legacy: false },
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

  it('a gated release is not a failure: "Sent for approval", waiting for the step role, no button that would 409', async () => {
    const user = userEvent.setup();
    api.release.mockImplementationOnce(async () => {
      // The server now holds the draft and its approval chain.
      api.detail = awarded({
        state: 'AWAITING_APPROVAL',
        approval: { instanceId: 'wf-7', status: 'PENDING', currentStepRole: 'CFO' },
        pending: [
          {
            kind: 'BUYER_ADVANCE',
            id: 'adv-d',
            idempotencyKey: 'k',
            amount: '1000.00',
            awaiting: 'APPROVAL',
            approvalInstanceId: 'wf-7',
            continue: { method: 'POST', path: '/buyer-advances/adv-d/post' },
          },
        ],
        allowedActions: [{ action: 'TOP_UP', enabled: false, reason: 'NOTHING_TO_FUND' }],
      });
      throw new ApiError(409, 'Approval required', 'CONFLICT', [], { code: 'APPROVAL_REQUIRED', approvalInstanceId: 'wf-7', advanceId: 'adv-d' });
    });
    renderWithProviders(<Harness />, { permissions: PAYER });

    await user.click(await screen.findByRole('button', { name: 'Release cash to Ahmed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    await user.click(within(dialog).getByRole('button', { name: 'Release $1,000.00' }));

    expect(await screen.findByText('Sent for approval')).toBeInTheDocument();
    expect(await screen.findByText('Waiting for CFO.')).toBeInTheDocument();
    // A Finance Officer cannot act on the CFO step: no workflow panel (it would 403), no Release now.
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release now' })).not.toBeInTheDocument();
  });

  it('finishes the server-pending attempt from any device: continue path, no body, chain from its instance', async () => {
    const user = userEvent.setup();
    api.detail = awarded({
      state: 'AWAITING_APPROVAL',
      approval: { instanceId: 'wf-3', status: 'APPROVED', currentStepRole: null },
      pending: [
        {
          kind: 'BUYER_ADVANCE',
          id: 'adv-d',
          idempotencyKey: 'k-from-another-phone',
          amount: '4000.00',
          awaiting: 'APPROVAL',
          approvalInstanceId: 'wf-3',
          continue: { method: 'POST', path: '/buyer-advances/adv-d/post' },
        },
      ],
      allowedActions: [{ action: 'TOP_UP', enabled: false, reason: 'NOTHING_TO_FUND' }],
    });
    api.cont.mockResolvedValueOnce({ id: 'adv-d' });
    renderWithProviders(<Harness />, { permissions: PAYER });

    expect(await screen.findByText('Approved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release now' }));
    await waitFor(() => expect(api.cont).toHaveBeenCalledWith('/buyer-advances/adv-d/post'));
    expect(api.release).not.toHaveBeenCalled();
  });

  it('mounts the approve panel only for whoever can act on the current step', async () => {
    api.detail = awarded({
      state: 'AWAITING_APPROVAL',
      approval: { instanceId: 'wf-5', status: 'PENDING', currentStepRole: 'CFO' },
      pending: [
        {
          kind: 'BUYER_ADVANCE',
          id: 'adv-d',
          idempotencyKey: null,
          amount: '4000.00',
          awaiting: 'APPROVAL',
          approvalInstanceId: 'wf-5',
          continue: { method: 'POST', path: '/buyer-advances/adv-d/post' },
        },
      ],
      allowedActions: [],
    });
    renderWithProviders(<Harness />, { permissions: [...PAYER, 'manage:workflow'] });
    expect(await screen.findByTestId('approval-panel')).toHaveTextContent('wf-5');
  });

  it('a duplicate tap answered 409 after the release landed just closes the dialog (no error)', async () => {
    const user = userEvent.setup();
    api.release.mockImplementationOnce(async () => {
      api.detail = awarded({
        state: 'CASH_WITH_BUYER',
        funded: '1000.00',
        withBuyer: '1000.00',
        advances: [
          { id: 'adv1', recipientUserId: 'u-ahmed', recipientName: 'Ahmed Ali', amount: '1000.00', advancedAt: '2026-10-08', documentStatus: 'APPROVED', postingStatus: 'POSTED', applied: '0.00', returned: '0.00', outstanding: '1000.00', legacy: false },
        ],
        allowedActions: [{ action: 'TOP_UP', enabled: false, reason: 'NOTHING_TO_FUND' }],
      });
      throw new ApiError(409, 'Key reused', 'CONFLICT', [], { code: 'IDEMPOTENCY_KEY_REUSED' });
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Release cash to Ahmed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release cash' });
    await user.click(within(dialog).getByRole('button', { name: 'Release $1,000.00' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/already started with different details/)).not.toBeInTheDocument();
    expect(await screen.findByText('Cash with buyer')).toBeInTheDocument();
  });

  it('a release waiting for approval is not released money: Released $0, waiting $1,900, still to pay $1,900', async () => {
    api.detail = awarded({
      state: 'AWAITING_APPROVAL',
      orderedAmount: '1900.00',
      funded: '1900.00',
      remainingToFund: '0.00',
      released: '0.00',
      pendingAmount: '1900.00',
      stillToPay: '1900.00',
      withBuyer: '0.00',
      approval: { instanceId: 'wf-1', status: 'PENDING', currentStepRole: 'CFO' },
      allowedActions: [],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    const facts = within(await screen.findByRole('region', { name: 'Payment' }));
    const fact = (label: string) => facts.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(fact('Released')).toBe('$0.00');
    expect(fact('Waiting for approval')).toBe('$1,900.00');
    expect(fact('Still to pay')).toBe('$1,900.00');
  });

  it('a dual-control payment is waiting for signatures — on the totals and on its row', async () => {
    api.detail = awarded({
      path: 'FINANCE_PAYS_SUPPLIER',
      state: 'AWAITING_SIGNATURES',
      orderedAmount: '280.00',
      funded: '280.00',
      remainingToFund: '0.00',
      paid: '0.00',
      pendingAmount: '280.00',
      stillToPay: '280.00',
      payments: [
        { id: 'sp-2', number: 'PAY-0050', amount: '280.00', shape: 'PREPAY', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED', pendingSignatures: true },
      ],
      allowedActions: [{ action: 'PAY_SUPPLIER', enabled: false, reason: 'NOTHING_TO_FUND' }],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    const section = within(await screen.findByRole('region', { name: 'Payment' }));
    expect(section.getByText('Paid', { selector: 'dt' }).nextElementSibling?.textContent).toBe('$0.00');
    expect(section.getAllByText('Waiting for signatures').length).toBeGreaterThanOrEqual(2);
    const row = section.getByRole('link', { name: /Payment PAY-0050/ });
    expect(within(row).getByText('Waiting for signatures')).toBeInTheDocument();
  });

  it('says what each cash release is: waiting for approval, cancelled — never "settled"', async () => {
    api.detail = awarded({
      state: 'AWAITING_APPROVAL',
      advances: [
        { id: 'a1', recipientUserId: 'u-ahmed', recipientName: 'Ahmed Ali', amount: '1900.00', advancedAt: '2026-10-08', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', applied: '0.00', returned: '0.00', outstanding: '0.00', legacy: false },
        { id: 'a2', recipientUserId: 'u-ahmed', recipientName: 'Ahmed Ali', amount: '900.00', advancedAt: '2026-10-07', documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED', applied: '0.00', returned: '0.00', outstanding: '0.00', legacy: false },
      ],
      allowedActions: [],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    expect(await screen.findByText(/waiting for approval/)).toBeInTheDocument();
    expect(screen.getByText(/· cancelled/)).toBeInTheDocument();
    expect(screen.queryByText(/settled/)).not.toBeInTheDocument();
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
    expect(
      within(dialog).getByText('No approval needed — two bank signatories release it before the money goes out.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('No approval needed — you release it.')).not.toBeInTheDocument();
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

  it('a gated payment shows the approval; once approved, Complete the payment calls the continue path', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.pay.mockImplementationOnce(async () => {
      api.detail = awarded({
        path: 'FINANCE_PAYS_SUPPLIER',
        state: 'AWAITING_APPROVAL',
        approval: { instanceId: 'wf-9', status: 'APPROVED', currentStepRole: null },
        pending: [
          {
            kind: 'SUPPLIER_PAYMENT',
            id: 'sp-1',
            idempotencyKey: 'k',
            amount: '1000.00',
            awaiting: 'APPROVAL',
            approvalInstanceId: 'wf-9',
            continue: { method: 'POST', path: '/supplier-payments/sp-1/continue' },
          },
        ],
        allowedActions: [{ action: 'PAY_SUPPLIER', enabled: false, reason: 'NOTHING_TO_FUND' }],
      });
      throw new ApiError(409, 'Approval required', 'CONFLICT', [], { code: 'APPROVAL_REQUIRED', approvalInstanceId: 'wf-9', paymentId: 'sp-1' });
    });
    api.cont.mockResolvedValueOnce({ payment: { id: 'sp-1' }, paymentSummary: null });
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    await user.click(within(dialog).getByRole('button', { name: 'Pay $1,000.00' }));

    await user.click(await screen.findByRole('button', { name: 'Complete the payment' }));
    await waitFor(() => expect(api.cont).toHaveBeenCalledWith('/supplier-payments/sp-1/continue'));
    expect(api.pay).toHaveBeenCalledTimes(1);
  });

  it('when the order is paid, shows the next step blocked in words — not "nothing to finish"', async () => {
    api.detail = awarded({
      path: 'FINANCE_PAYS_SUPPLIER',
      state: 'WAITING_FOR_GOODS',
      allowedActions: [
        { action: 'PAY_SUPPLIER', enabled: false, reason: 'NOTHING_TO_FUND' },
        { action: 'FINISH_PAYMENT', enabled: false, reason: 'NOTHING_TO_FINISH' },
        { action: 'PHOTOGRAPH_RECEIPT', enabled: false, reason: 'MISSING_PERMISSION' },
        { action: 'RECORD_RECEIPT', enabled: false, reason: 'NO_RECEIPT_TO_RECORD' },
      ],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    expect(await screen.findByRole('button', { name: 'Pay Bakaara Steel' })).toBeDisabled();
    expect(screen.getByText('The order is already fully paid.')).toBeInTheDocument();
    expect(screen.queryByText('There is no payment waiting to be finished.')).not.toBeInTheDocument();
  });

  it('applies a posted prepayment to the bill instead of paying again (APPLY_PREPAYMENT is primary)', async () => {
    const user = userEvent.setup();
    api.detail = awarded({
      path: 'FINANCE_PAYS_SUPPLIER',
      state: 'SETTLING',
      payments: [{ id: 'sp-1', number: 'PAY-0042', amount: '1000.00', shape: 'PREPAY', documentStatus: 'APPROVED', postingStatus: 'POSTED' }],
      allowedActions: [
        { action: 'PAY_SUPPLIER', enabled: false, reason: 'PREPAYMENT_NOT_APPLIED' },
        { action: 'APPLY_PREPAYMENT', enabled: true },
        { action: 'FINISH_PAYMENT', enabled: false, reason: 'NOTHING_TO_FINISH' },
      ],
    });
    api.payDraft.mockResolvedValue(
      payDraftFixture({
        shape: 'PAY_BILL',
        bills: [{ id: 'b-91', number: 'BILL-0091', outstanding: '980.00' }],
        unappliedPrepayments: [{ paymentId: 'sp-1', unallocated: '1000.00' }],
        blockers: ['PREPAYMENT_NOT_APPLIED'],
      }),
    );
    api.apply.mockResolvedValueOnce({});
    renderWithProviders(<Harness />, { permissions: PAYER });

    // Pay stays visible, disabled, with why — not hidden.
    expect(await screen.findByRole('button', { name: 'Pay Bakaara Steel' })).toBeDisabled();
    expect(screen.getByText('Apply the prepayment to this bill first.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Apply the prepayment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply the prepayment' });
    expect(within(dialog).getByText('Apply $980.00 from PAY-0042 to BILL-0091.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Apply $980.00' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('sp-1', 'b-91', 980));
  });

  it('says to apply the prepayment first when paying is refused with PREPAYMENT_NOT_APPLIED', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.pay.mockRejectedValueOnce(
      new ApiError(409, 'Prepayment not applied', 'CONFLICT', [], {
        code: 'PREPAYMENT_NOT_APPLIED',
        unappliedPrepayments: [{ paymentId: 'sp-1', unallocated: '1000.00' }],
      }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    await user.click(within(dialog).getByRole('button', { name: 'Pay $1,000.00' }));
    expect(await within(dialog).findByText('Apply the prepayment to this bill first.')).toBeInTheDocument();
  });

  it('shows Pay disabled with the reason when this finance user approved the bill (QA H)', async () => {
    api.detail = awarded({
      path: 'FINANCE_PAYS_SUPPLIER',
      allowedActions: [{ action: 'PAY_SUPPLIER', enabled: false, reason: 'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT' }],
    });
    renderWithProviders(<Harness />, { permissions: PAYER });
    expect(await screen.findByRole('button', { name: 'Pay Bakaara Steel' })).toBeDisabled();
    expect(screen.getByText("You approved this store's bill, so another finance user must approve the payment.")).toBeInTheDocument();
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

  it('offers no "pay before goods" while a posted bill is owed (the server would refuse BILL_TO_PAY)', async () => {
    const user = userEvent.setup();
    api.detail = awarded({ path: 'FINANCE_PAYS_SUPPLIER', allowedActions: [{ action: 'PAY_SUPPLIER', enabled: true }] });
    api.payDraft.mockResolvedValue(
      payDraftFixture({ shape: 'PREPAY', bills: [{ id: 'b1', number: 'BILL-0091', outstanding: '980.00' }] }),
    );
    renderWithProviders(<Harness />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Pay Bakaara Steel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay Bakaara Steel' });
    expect(within(dialog).getByRole('radio', { name: /Pay the invoice BILL-0091/ })).toBeChecked();
    expect(within(dialog).queryByRole('radio', { name: /Pay now, before goods/ })).not.toBeInTheDocument();
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
