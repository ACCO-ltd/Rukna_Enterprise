import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';
import { createJournal, listAccounts, listFiscalYears } from '@/features/accounting/api/accounting-api';
import type { Account, AccountVersion } from '@/features/accounting/types';

import { JournalForm } from './journal-form';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  listAccounts: vi.fn(),
  createJournal: vi.fn(),
  // The accounting-date picker refuses days outside an open period, and reads the periods
  // through useFiscalYears -> listFiscalYears.
  listFiscalYears: vi.fn(),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Office Expense',
    parentAccountId: null,
    accountClass: 'EXPENSE',
    accountSubtype: 'ADMINISTRATIVE_EXPENSE',
    isPostingAllowed: true,
    isControlAccount: false,
    controlledSubledgerType: null,
    controlPostingPolicy: 'UNRESTRICTED',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function account(id: string, code: string, name: string, extra: Partial<AccountVersion> = {}): Account {
  return {
    id,
    organizationId: 'org-1',
    code,
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version({ accountId: id, name, ...extra })],
  };
}

const EXPENSE = account('acc-expense', '60100', 'Office Expense');
const ACCRUAL = account('acc-accrual', '21000', 'Accrued Liabilities');
/** AR control: SYSTEM_ONLY, so a manual journal may never target it. */
const AR_CONTROL = account('acc-ar', '11000', 'Accounts Receivable', {
  isControlAccount: true,
  controlPostingPolicy: 'SYSTEM_ONLY',
});

beforeEach(() => {
  vi.mocked(listAccounts).mockReset();
  vi.mocked(createJournal).mockReset();
  push.mockReset();
  vi.mocked(listAccounts).mockResolvedValue([EXPENSE, ACCRUAL, AR_CONTROL]);
  // No periods loaded means the calendar constrains nothing, which is what these tests want.
  vi.mocked(listFiscalYears).mockResolvedValue([]);
});

/** Fills the header and both opening lines with a balanced 2,500 entry. */
async function fillBalancedJournal(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Description'), 'January office rent');

  await chooseOption(user, screen.getByLabelText('Account 1'), 'acc-expense');
  await user.type(screen.getByLabelText('Debit 1'), '2500.00');

  await chooseOption(user, screen.getByLabelText('Account 2'), 'acc-accrual');
  await user.type(screen.getByLabelText('Credit 2'), '2500.00');
}

describe('JournalForm', () => {
  it('opens with the two lines every entry needs', async () => {
    renderWithProviders(<JournalForm />);

    expect(await screen.findByLabelText('Account 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Account 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account 3')).not.toBeInTheDocument();
  });

  /**
   * A `SYSTEM_ONLY` control account is written by the posting engine alone. Offering it here
   * invites an entry the server rejects at POST time — after a CFO has approved it, which is
   * the most expensive moment to find out.
   */
  it('does not offer control accounts, which the posting engine owns', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    // The trigger only shows what is chosen now, so what is *offered* has to be read from the
    // open list rather than from the control's own text.
    await openSelect(user, await screen.findByLabelText('Account 1'));
    expect(screen.getByRole('option', { name: '60100 — Office Expense' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Accounts Receivable/ })).not.toBeInTheDocument();
  });

  it('shows the running totals as lines are entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await user.type(screen.getByLabelText('Debit 1'), '2500.00');

    expect(screen.getByText('Total debits')).toBeInTheDocument();
    expect(screen.getByText('Total credits')).toBeInTheDocument();

    // 2,500 appears twice, and that is the point: it is the debit total, and — with nothing
    // on the credit side yet — it is also the amount the journal is out of balance by.
    expect(screen.getAllByText('$2,500.00')).toHaveLength(2);
    expect(screen.queryByText('Balanced')).not.toBeInTheDocument();
  });

  it('reports the journal as balanced once both sides agree', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await fillBalancedJournal(user);

    expect(screen.getByText('Balanced')).toBeInTheDocument();
  });

  it('saves a balanced journal and opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(createJournal).mockResolvedValue({ id: 'jrn-1' } as never);

    renderWithProviders(<JournalForm />);
    await screen.findByLabelText('Account 1');
    await fillBalancedJournal(user);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(vi.mocked(createJournal)).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'January office rent',
        currencyCode: 'USD',
        lines: [
          expect.objectContaining({ accountId: 'acc-expense', debitAmount: 2500 }),
          expect.objectContaining({ accountId: 'acc-accrual', creditAmount: 2500 }),
        ],
      }),
    );
    expect(push).toHaveBeenCalledWith('/finance/accounting/journals/jrn-1');
  });

  it('refuses to save an unbalanced journal and says by how much', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await user.type(screen.getByLabelText('Description'), 'Unbalanced');
    await chooseOption(user, screen.getByLabelText('Account 1'), 'acc-expense');
    await user.type(screen.getByLabelText('Debit 1'), '2500.00');
    await chooseOption(user, screen.getByLabelText('Account 2'), 'acc-accrual');
    await user.type(screen.getByLabelText('Credit 2'), '2400.00');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(vi.mocked(createJournal)).not.toHaveBeenCalled();
    expect(screen.getByText(/Currently out by 100\.00/)).toBeInTheDocument();
  });

  /**
   * The bug the strict parser exists for. `Number("1,000")` is NaN but a coalescing parse
   * returns 0 — the balance check would then pass on a typo, and the rejection would surface
   * at posting, to someone else.
   */
  it('rejects an unparseable amount rather than reading it as zero', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await user.type(screen.getByLabelText('Description'), 'Typo');
    await chooseOption(user, screen.getByLabelText('Account 1'), 'acc-expense');
    // A lone decimal point is non-blank but has no value — it must not read as zero.
    await user.type(screen.getByLabelText('Debit 1'), '.');
    await chooseOption(user, screen.getByLabelText('Account 2'), 'acc-accrual');
    await user.type(screen.getByLabelText('Credit 2'), '1000.00');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(vi.mocked(createJournal)).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid amount.')).toBeInTheDocument();
  });

  it('accepts amounts typed with thousands separators', async () => {
    const user = userEvent.setup();
    vi.mocked(createJournal).mockResolvedValue({ id: 'jrn-2' } as never);

    renderWithProviders(<JournalForm />);
    await screen.findByLabelText('Account 1');
    await user.type(screen.getByLabelText('Description'), 'Grouped');
    await chooseOption(user, screen.getByLabelText('Account 1'), 'acc-expense');
    const debit = screen.getByLabelText('Debit 1') as HTMLInputElement;
    await user.type(debit, '1000000');
    // The field groups as you type; the raw value sent stays comma-free.
    expect(debit.value).toBe('1,000,000');
    await chooseOption(user, screen.getByLabelText('Account 2'), 'acc-accrual');
    await user.type(screen.getByLabelText('Credit 2'), '1000000');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(vi.mocked(createJournal)).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({ accountId: 'acc-expense', debitAmount: 1000000 }),
          expect.objectContaining({ accountId: 'acc-accrual', creditAmount: 1000000 }),
        ],
      }),
    );
  });

  it('rejects a line carrying both a debit and a credit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await user.type(screen.getByLabelText('Description'), 'Both sides');
    await chooseOption(user, screen.getByLabelText('Account 1'), 'acc-expense');
    await user.type(screen.getByLabelText('Debit 1'), '100.00');
    await user.type(screen.getByLabelText('Credit 1'), '100.00');
    await chooseOption(user, screen.getByLabelText('Account 2'), 'acc-accrual');
    await user.type(screen.getByLabelText('Credit 2'), '100.00');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(vi.mocked(createJournal)).not.toHaveBeenCalled();
    expect(screen.getByText('A line cannot carry both a debit and a credit.')).toBeInTheDocument();
  });

  it('does not flag the opening blank lines before anything is typed', async () => {
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    expect(screen.queryByText('Every line needs an account.')).not.toBeInTheDocument();
  });

  it('adds a line on request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    expect(screen.getByLabelText('Account 3')).toBeInTheDocument();
  });

  it('will not remove a line below the two the server requires', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalForm />);

    await screen.findByLabelText('Account 1');
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeEnabled();
  });

  it('surfaces a save failure without losing what was typed', async () => {
    const user = userEvent.setup();
    vi.mocked(createJournal).mockRejectedValue(new Error('network'));

    renderWithProviders(<JournalForm />);
    await screen.findByLabelText('Account 1');
    await fillBalancedJournal(user);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Could not save the journal.')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('January office rent');
  });

});
