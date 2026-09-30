import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import type { SetupTemplate, SetupTemplateAccount } from '../accounting-setup';
import { AccountingSetupDialog } from './accounting-setup-dialog';

/**
 * Set up accounting (ADR-040): three steps, nothing written until the last one.
 */

const api = vi.hoisted(() => ({
  getAccountingSetupTemplate: vi.fn(),
  runAccountingSetup: vi.fn(),
}));

vi.mock('../api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

function row(overrides: Partial<SetupTemplateAccount> & { code: string }): SetupTemplateAccount {
  return {
    name: `Account ${overrides.code}`,
    accountClass: 'ASSET',
    accountSubtype: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    isHeading: false,
    parentCode: null,
    isControlAccount: false,
    ...overrides,
  };
}

/** What the API would answer for the given VAT rate and bank count. */
function template(vatRate: number, banks: number): SetupTemplate {
  return {
    templateId: 'CONSTRUCTION',
    version: '1.0.0',
    accounts: [
      row({ code: '10000', name: 'Current assets', isHeading: true }),
      ...Array.from({ length: banks }, (_, i) =>
        row({
          code: String(10100 + i),
          name: `Bank account ${i + 1}`,
          accountSubtype: 'CASH_AND_BANK',
          parentCode: '10000',
          conditional: 'BANK' as const,
        }),
      ),
      row({ code: '10900', name: 'Petty cash', parentCode: '10000' }),
      row({
        code: '11000',
        name: 'Accounts receivable',
        accountSubtype: 'ACCOUNTS_RECEIVABLE',
        parentCode: '10000',
        isControlAccount: true,
      }),
      ...(vatRate > 0
        ? [
            row({
              code: '14100',
              name: 'Input VAT recoverable',
              parentCode: '10000',
              conditional: 'VAT' as const,
            }),
          ]
        : []),
      row({
        code: '40000',
        name: 'Contract revenue',
        accountClass: 'INCOME',
        normalBalance: 'CREDIT',
      }),
    ],
    postingProfiles: [{ code: 'PROJECT_REVENUE', name: 'Contract revenue', accountCode: '40000' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getAccountingSetupTemplate.mockImplementation(
    async ({ vatRate, banks }: { vatRate: number; banks: number }) => template(vatRate, banks),
  );
});

function renderDialog(onDone = vi.fn()) {
  renderWithProviders(<AccountingSetupDialog onDone={onDone} />, {
    permissions: ['view:accounting', 'manage:accounting'],
    withToast: true,
  });
  return onDone;
}

const next = (user: UserEvent) => user.click(screen.getByRole('button', { name: 'Next' }));

async function fillCompany(user: UserEvent, { vat }: { vat: string | null }) {
  if (vat === null) {
    await user.click(screen.getByRole('radio', { name: /Not registered for VAT/ }));
  } else {
    await user.click(screen.getByRole('radio', { name: /^Registered for VAT/ }));
    await user.type(screen.getByLabelText('VAT rate (%)'), vat);
  }
  await user.type(screen.getByLabelText('Account name'), 'Main operating');
  await user.type(screen.getByLabelText('Bank'), 'Salaam Bank');
}

describe('AccountingSetupDialog — step 1', () => {
  it('opens on the company step with the current year and January', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Set up accounting' })).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toHaveValue(String(new Date().getFullYear()));
    expect(screen.getByText(/Covers January \d{4} – December \d{4}/)).toBeInTheDocument();
    expect(screen.getByText('A petty cash account is always added.')).toBeInTheDocument();
  });

  it('will not continue without a VAT decision or with an empty bank row', async () => {
    const user = userEvent.setup();
    renderDialog();

    await next(user);

    expect(
      screen.getByText('Choose whether the company is registered for VAT.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter the account name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the bank.')).toBeInTheDocument();
    expect(api.getAccountingSetupTemplate).not.toHaveBeenCalled();
  });

  it('refuses a VAT rate outside 0 < r ≤ 100', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillCompany(user, { vat: '150' });
    await next(user);

    expect(screen.getByText('Enter a rate above 0 and up to 100.')).toBeInTheDocument();

    const rate = screen.getByLabelText('VAT rate (%)');
    await user.clear(rate);
    await user.type(rate, '5');
    await next(user);

    expect(await screen.findByText(/1 bank account$/)).toBeInTheDocument();
  });

  it('adds and removes bank rows, and allows none', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add bank' }));
    expect(screen.getAllByLabelText('Account name')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Remove bank 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove bank 1' }));
    expect(screen.queryByLabelText('Account name')).not.toBeInTheDocument();
    expect(screen.getByText(/No banks named/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Not registered for VAT/ }));
    await next(user);

    await waitFor(() =>
      expect(api.getAccountingSetupTemplate).toHaveBeenCalledWith({ vatRate: 0, banks: 0 }),
    );
  });

  it('shows the period range for a non-January start', async () => {
    const user = userEvent.setup();
    renderDialog();

    const year = screen.getByLabelText('Year');
    await user.clear(year);
    await user.type(year, '2026');
    await chooseOption(user, screen.getByLabelText('Starts in'), '7');

    expect(screen.getByText('Covers July 2026 – June 2027')).toBeInTheDocument();
  });

  it('says plainly that invoice sales tax does not follow the VAT choice', () => {
    renderDialog();
    expect(
      screen.getByText('Client invoices currently apply 5% sales tax regardless of this choice.'),
    ).toBeInTheDocument();
  });
});

describe('AccountingSetupDialog — review', () => {
  it('previews the chart for the choices: VAT row, typed bank names, control badge, counts', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillCompany(user, { vat: '5' });
    await next(user);

    const chart = await screen.findByRole('table', { name: 'Chart of accounts to be created' });
    expect(api.getAccountingSetupTemplate).toHaveBeenCalledWith({ vatRate: 5, banks: 1 });

    // The bank row carries the name typed on step 1, not the template placeholder.
    expect(within(chart).getByText('Main operating')).toBeInTheDocument();
    expect(within(chart).queryByText('Bank account 1')).not.toBeInTheDocument();
    expect(within(chart).getByText('Input VAT recoverable')).toBeInTheDocument();

    const receivable = within(chart).getByText('Accounts receivable').closest('tr')!;
    expect(within(receivable).getByText('Control')).toBeInTheDocument();

    // Headings are bold; grouped by class.
    expect(within(chart).getByText('Current assets')).toHaveClass('font-semibold');
    expect(within(chart).getByRole('columnheader', { name: /Asset/ })).toBeInTheDocument();
    expect(within(chart).getByRole('columnheader', { name: /Income/ })).toBeInTheDocument();

    const year = new Date().getFullYear();
    expect(
      screen.getByText(
        `6 accounts · 1 posting profile · FY${year} with 12 open periods · 1 bank account`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Posting profiles (1)')).toBeInTheDocument();
  });

  it('leaves the VAT row out when VAT is not charged', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillCompany(user, { vat: null });
    await next(user);

    const chart = await screen.findByRole('table', { name: 'Chart of accounts to be created' });
    expect(within(chart).queryByText('Input VAT recoverable')).not.toBeInTheDocument();
    expect(api.getAccountingSetupTemplate).toHaveBeenCalledWith({ vatRate: 0, banks: 1 });
  });

  it('goes back to step 1 with the input kept', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillCompany(user, { vat: '5' });
    await next(user);
    await screen.findByRole('table', { name: 'Chart of accounts to be created' });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Account name')).toHaveValue('Main operating');
    expect(screen.getByLabelText('VAT rate (%)')).toHaveValue('5');
  });
});

describe('AccountingSetupDialog — confirm and submit', () => {
  async function reachConfirm(user: UserEvent) {
    await fillCompany(user, { vat: '5' });
    await user.type(screen.getByLabelText('Account number (Optional)'), '000123');
    await next(user);
    await screen.findByRole('table', { name: 'Chart of accounts to be created' });
    await next(user);
  }

  it('names a non-January year FY2026/27, as the API does', async () => {
    const user = userEvent.setup();
    renderDialog();

    const year = screen.getByLabelText('Year');
    await user.clear(year);
    await user.type(year, '2026');
    await chooseOption(user, screen.getByLabelText('Starts in'), '7');
    await reachConfirm(user);

    expect(
      screen.getByText(
        'Fiscal year FY2026/27, July 2026 – June 2027, with 12 open monthly periods',
      ),
    ).toBeInTheDocument();
  });

  it('summarises what will be created and says it runs once', async () => {
    const user = userEvent.setup();
    renderDialog();
    await reachConfirm(user);

    expect(screen.getByText('6 accounts in the chart of accounts')).toBeInTheDocument();
    expect(screen.getByText('1 bank account (Main operating) and petty cash')).toBeInTheDocument();
    expect(screen.getByText('VAT tax codes at 5%')).toBeInTheDocument();
    expect(screen.getByText('This can only be done once')).toBeInTheDocument();
    expect(api.runAccountingSetup).not.toHaveBeenCalled();
  });

  it('sends the exact body and shows the success dialog', async () => {
    api.runAccountingSetup.mockResolvedValue({
      accountsCreated: 6,
      postingProfilesCreated: 1,
      fiscalYear: { id: 'fy-1', name: 'FY2026' },
      bankAccountsCreated: 1,
      taxCodesCreated: 1,
    });
    const user = userEvent.setup();
    const onDone = renderDialog();
    await reachConfirm(user);

    await user.click(screen.getByRole('button', { name: 'Set up accounting' }));

    await waitFor(() => expect(api.runAccountingSetup).toHaveBeenCalledTimes(1));
    expect(api.runAccountingSetup.mock.calls[0]![0]).toEqual({
      templateId: 'CONSTRUCTION',
      vat: { charged: true, ratePercent: 5 },
      banks: [{ accountName: 'Main operating', bankName: 'Salaam Bank', accountNumber: '000123' }],
      fiscalYear: { year: new Date().getFullYear(), startMonth: 1 },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await screen.findByText('Accounting is set up')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You can now record invoices, bills and receipts. Next: enter opening balances.',
      ),
    ).toBeInTheDocument();
  });

  it('explains a 409 ACCOUNTING_ALREADY_SET_UP instead of echoing it', async () => {
    api.runAccountingSetup.mockRejectedValue(
      new ApiError(409, 'ACCOUNTING_ALREADY_SET_UP', 'ACCOUNTING_ALREADY_SET_UP'),
    );
    const user = userEvent.setup();
    const onDone = renderDialog();
    await reachConfirm(user);

    await user.click(screen.getByRole('button', { name: 'Set up accounting' }));

    expect(
      await screen.findByText(/Accounting is already set up for this organisation/),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
