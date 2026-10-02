import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingGuideResponse, GuideStep } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { GuideHub } from './guide-hub';

/**
 * The Get started hub shows setup in proportion to what is left: the one-step setup card alone
 * before setup (ADR-040), a single "set up" line after it, and the full checklist only for a
 * partial or manual setup.
 */

const finance = vi.hoisted(() => ({ getAccountingGuide: vi.fn() }));
const accounting = vi.hoisted(() => ({ getAccountingSetupStatus: vi.fn() }));

vi.mock('@/features/finance/api/finance-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...finance,
}));
vi.mock('../api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...accounting,
}));

const step = (key: string, label: string, status: GuideStep['status'], href: string | null): GuideStep => ({
  key,
  label,
  detail: `${label} detail.`,
  status,
  href,
});

function guide(setupSteps: GuideStep[], ready = false): AccountingGuideResponse {
  return {
    ready,
    currentPeriod: null,
    fiscalYear: null,
    checkedAt: '2026-09-30T00:00:00.000Z',
    cycles: [
      { key: 'setup', title: 'First-time setup', summary: '', status: 'IN_PROGRESS', steps: setupSteps },
      {
        key: 'daily',
        title: 'Daily posting',
        summary: '',
        status: ready ? 'IN_PROGRESS' : 'LOCKED',
        steps: [step('post-bills', 'Post supplier bills', ready ? 'TODO' : 'BLOCKED', '/finance/accounting/bills')],
      },
    ],
  };
}

/** A fresh organisation: nothing set up. */
const FRESH = guide([
  step('chart-of-accounts', 'Chart of accounts', 'NEXT', '/finance/accounting/chart-of-accounts?setup=template'),
  step('fiscal-year', 'Fiscal year & periods', 'TODO', '/finance/accounting/periods'),
  step('posting-profiles', 'Expense posting profiles', 'TODO', '/finance/accounting/posting-profiles'),
  step('opening-balances', 'Opening balances', 'TODO', '/finance/accounting/opening-balance'),
]);

/** After the one-step setup: only the optional opening balances remain. */
const SET_UP = guide(
  [
    step('chart-of-accounts', 'Chart of accounts', 'DONE', '/finance/accounting/chart-of-accounts'),
    step('fiscal-year', 'Fiscal year & periods', 'DONE', '/finance/accounting/periods'),
    step('posting-profiles', 'Expense posting profiles', 'DONE', '/finance/accounting/posting-profiles'),
    step('opening-balances', 'Opening balances', 'TODO', '/finance/accounting/opening-balance'),
  ],
  true,
);

/** A manual or partial setup: required steps still open after some are done. */
const PARTWAY = guide([
  step('chart-of-accounts', 'Chart of accounts', 'DONE', '/finance/accounting/chart-of-accounts'),
  step('fiscal-year', 'Fiscal year & periods', 'NEXT', '/finance/accounting/periods'),
  step('posting-profiles', 'Expense posting profiles', 'TODO', '/finance/accounting/posting-profiles'),
]);

const MANAGE = ['view:accounting', 'manage:accounting'];
const status = (over: object = {}) => ({
  canInstall: true,
  reason: 'READY',
  accountCount: 0,
  hasFiscalYear: false,
  hasPolicies: false,
  existingRecords: [],
  defaultSalesTax: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  finance.getAccountingGuide.mockResolvedValue(FRESH);
  accounting.getAccountingSetupStatus.mockResolvedValue(status());
});

describe('GuideHub — setup in proportion to what is left', () => {
  it('before setup, the one-step setup card is the page: no checklist, locked cycles in one line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const card = await screen.findByRole('region', { name: 'Set up accounting' });
    expect(within(card).getByText('Construction chart of accounts and posting profiles')).toBeInTheDocument();
    expect(within(card).getByText('Sales tax')).toBeInTheDocument();
    // What it installs is not repeated as a checklist.
    expect(screen.queryByRole('region', { name: /First-time setup/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Fiscal year & periods')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Daily posting/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Daily posting, month-end and year-end open once accounting is set up.'),
    ).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Set up accounting' }));
    expect(await screen.findByRole('dialog', { name: 'Set up accounting' })).toBeInTheDocument();
  });

  it('tells someone who cannot run setup who does, without the checklist', async () => {
    // As the API sends it to a user without manage:accounting: every step RESTRICTED, no link.
    finance.getAccountingGuide.mockResolvedValue(
      guide([
        step('chart-of-accounts', 'Chart of accounts', 'RESTRICTED', null),
        step('fiscal-year', 'Fiscal year & periods', 'RESTRICTED', null),
        step('bank-accounts', 'Bank accounts', 'RESTRICTED', null),
      ]),
    );
    renderWithProviders(<GuideHub />, { permissions: ['view:accounting'] });

    expect(await screen.findByText('Accounting isn’t set up yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
    expect(screen.queryByText('Fiscal year & periods')).not.toBeInTheDocument();
    expect(accounting.getAccountingSetupStatus).not.toHaveBeenCalled();
  });

  it('after setup, shows one "set up" line with only the optional opening balances', async () => {
    finance.getAccountingGuide.mockResolvedValue(SET_UP);
    accounting.getAccountingSetupStatus.mockResolvedValue(
      status({ canInstall: false, reason: 'CHART_NOT_EMPTY', accountCount: 78 }),
    );
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const done = await screen.findByRole('region', { name: 'Accounting is set up' });
    const opening = within(done).getByRole('link', { name: /Opening balances — Open/ });
    expect(opening).toHaveAttribute('href', '/finance/accounting/opening-balance');
    expect(within(done).getByText('Optional')).toBeInTheDocument();
    expect(screen.queryByText('Fiscal year & periods')).not.toBeInTheDocument();
    // The everyday cycles are the page now.
    expect(screen.getByRole('region', { name: /Daily posting/ })).toBeInTheDocument();
  });

  it('falls back to the checklist when setup left a required step open (no banks entered)', async () => {
    finance.getAccountingGuide.mockResolvedValue(
      guide([
        step('chart-of-accounts', 'Chart of accounts', 'DONE', '/finance/accounting/chart-of-accounts'),
        step('bank-accounts', 'Bank accounts', 'NEXT', '/finance/accounting/bank-accounts'),
        step('opening-balances', 'Opening balances', 'TODO', '/finance/accounting/opening-balance'),
      ]),
    );
    accounting.getAccountingSetupStatus.mockResolvedValue(
      status({ canInstall: false, reason: 'CHART_NOT_EMPTY', accountCount: 78 }),
    );
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const setup = await screen.findByRole('region', { name: /First-time setup/ });
    expect(within(setup).getByRole('link', { name: /Bank accounts — Open/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Accounting is set up' })).not.toBeInTheDocument();
  });

  it('keeps the step-by-step checklist for a manual or partial setup', async () => {
    finance.getAccountingGuide.mockResolvedValue(PARTWAY);
    accounting.getAccountingSetupStatus.mockResolvedValue(
      status({ canInstall: false, reason: 'CHART_NOT_EMPTY', accountCount: 12 }),
    );
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const setup = await screen.findByRole('region', { name: /First-time setup/ });
    expect(within(setup).getByRole('link', { name: /Fiscal year & periods — Open/ })).toHaveAttribute(
      'href',
      '/finance/accounting/periods',
    );
    expect(within(setup).getByRole('link', { name: /Expense posting profiles — Open/ })).toHaveAttribute(
      'href',
      '/finance/accounting/posting-profiles',
    );
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
  });

  it('explains a partial setup alongside the checklist instead of offering the install', async () => {
    finance.getAccountingGuide.mockResolvedValue(PARTWAY);
    accounting.getAccountingSetupStatus.mockResolvedValue(
      status({ canInstall: false, reason: 'PARTIAL_SETUP', hasPolicies: true, existingRecords: ['BANK_ACCOUNTS'] }),
    );
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    expect(await screen.findByRole('region', { name: /First-time setup/ })).toBeInTheDocument();
    expect(screen.getByText(/can’t be set up automatically/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
  });
});
