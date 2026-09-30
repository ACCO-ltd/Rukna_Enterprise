import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingGuideResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { GuideHub } from './guide-hub';

/**
 * The Get started hub opens the one-step setup (ADR-040) from its first setup step while the
 * chart is still empty, and links the posting-profiles step to its new screen.
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

const GUIDE: AccountingGuideResponse = {
  ready: false,
  currentPeriod: null,
  fiscalYear: null,
  checkedAt: '2026-09-30T00:00:00.000Z',
  cycles: [
    {
      key: 'setup',
      title: 'Setup',
      summary: '0 of 6 done',
      status: 'IN_PROGRESS',
      steps: [
        {
          key: 'chart-of-accounts',
          label: 'Chart of accounts',
          detail: 'Create the accounts the ledger posts to.',
          status: 'NEXT',
          href: '/finance/accounting/chart-of-accounts',
        },
        {
          key: 'posting-profiles',
          label: 'Posting profiles',
          detail: 'Map bill lines to accounts.',
          status: 'TODO',
          href: '/finance/accounting/posting-profiles',
        },
      ],
    },
  ],
};

const MANAGE = ['view:accounting', 'manage:accounting'];

beforeEach(() => {
  vi.clearAllMocks();
  finance.getAccountingGuide.mockResolvedValue(GUIDE);
  accounting.getAccountingSetupStatus.mockResolvedValue({
    canInstall: true,
    reason: 'READY',
    accountCount: 0,
    hasFiscalYear: false,
    hasPolicies: false,
    existingRecords: [],
  });
});

describe('GuideHub — accounting setup', () => {
  it('offers the one-step setup and opens it from the first setup step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    expect(await screen.findByText('Set up accounting in one step')).toBeInTheDocument();

    const step = screen.getByRole('button', { name: /Chart of accounts — Open/ });
    await user.click(step);
    expect(await screen.findByRole('dialog', { name: 'Set up accounting' })).toBeInTheDocument();
  });

  it('explains a partial setup instead of offering the install', async () => {
    accounting.getAccountingSetupStatus.mockResolvedValue({
      canInstall: false,
      reason: 'PARTIAL_SETUP',
      accountCount: 0,
      hasFiscalYear: false,
      hasPolicies: true,
      existingRecords: ['TAX_CODES', 'BANK_ACCOUNTS'],
    });
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    expect(
      await screen.findByText(
        'Accounting can’t be set up automatically: this organisation already has tax codes and bank accounts but no chart of accounts. Remove them or add the chart manually.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Set up accounting in one step')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chart of accounts — Open/ })).toBeInTheDocument();
  });

  it('links the posting-profiles step to its screen', async () => {
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const link = await screen.findByRole('link', { name: /Posting profiles — Open/ });
    expect(link).toHaveAttribute('href', '/finance/accounting/posting-profiles');
  });

  it('keeps the plain link once the chart has accounts', async () => {
    accounting.getAccountingSetupStatus.mockResolvedValue({
      canInstall: false,
      reason: 'CHART_NOT_EMPTY',
      accountCount: 62,
      hasFiscalYear: true,
      hasPolicies: true,
      existingRecords: [],
    });
    renderWithProviders(<GuideHub />, { permissions: MANAGE });

    const link = await screen.findByRole('link', { name: /Chart of accounts — Open/ });
    expect(link).toHaveAttribute('href', '/finance/accounting/chart-of-accounts');
    expect(screen.queryByText('Set up accounting in one step')).not.toBeInTheDocument();
  });

  it('does not ask for the setup status, or offer setup, without manage:accounting', async () => {
    renderWithProviders(<GuideHub />, { permissions: ['view:accounting'] });

    const setup = await screen.findByRole('region', { name: /Setup/ });
    expect(
      within(setup).getByRole('link', { name: /Chart of accounts — Open/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Set up accounting in one step')).not.toBeInTheDocument();
    expect(accounting.getAccountingSetupStatus).not.toHaveBeenCalled();
  });
});
