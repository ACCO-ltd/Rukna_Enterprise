import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';

import type { Account } from '../types';

/**
 * Opening a fiscal year (tenant bootstrap, tier 2).
 *
 * The pure helpers carry most of the meaning here — the retained-earnings narrowing and the
 * duplicate-year refusal — so they are tested directly as well as through the form.
 */

const mocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useFiscalYears: vi.fn(),
  useCreateFiscalYear: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => mocks);

import {
  CreateFiscalYearForm,
  fiscalYearProblem,
  openedYears,
  retainedEarningsCandidates,
} from './create-fiscal-year-form';

function account(
  id: string,
  code: string,
  name: string,
  accountClass: string,
  accountSubtype: string,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): Account {
  return {
    id,
    code,
    status,
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        accountClass,
        accountSubtype,
        normalBalance: 'CREDIT',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        parentAccountId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  } as unknown as Account;
}

const RETAINED = account('a-re', '31000', 'Retained Earnings', 'EQUITY', 'RETAINED_EARNINGS');
const CAPITAL = account('a-cap', '30000', 'Share Capital', 'EQUITY', 'SHARE_CAPITAL');
const BANK = account('a-bank', '10100', 'Salaam Bank', 'ASSET', 'CASH_AND_BANK');

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAccounts.mockReturnValue({
    data: [RETAINED, CAPITAL, BANK],
    isPending: false,
    isError: false,
  });
  mocks.useFiscalYears.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useCreateFiscalYear.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('retainedEarningsCandidates', () => {
  /** Offering the whole chart invites closing a year into a bank account. */
  it('narrows to accounts marked as retained earnings', () => {
    expect(retainedEarningsCandidates([RETAINED, CAPITAL, BANK]).map((a) => a.code)).toEqual([
      '31000',
    ]);
  });

  it('falls back to every equity account when none is marked', () => {
    expect(retainedEarningsCandidates([CAPITAL, BANK]).map((a) => a.code)).toEqual(['30000']);
  });

  it('never offers a non-equity account, even as a fallback', () => {
    expect(retainedEarningsCandidates([BANK])).toEqual([]);
  });

  it('excludes inactive accounts', () => {
    const retired = account('a-old', '31999', 'Old RE', 'EQUITY', 'RETAINED_EARNINGS', 'INACTIVE');

    expect(retainedEarningsCandidates([retired])).toEqual([]);
  });
});

describe('openedYears', () => {
  it('reads the year out of the FY name the server generates', () => {
    expect(openedYears([{ name: 'FY2025' }, { name: 'FY2026' }])).toEqual(new Set([2025, 2026]));
  });

  it('ignores a name with no year rather than throwing', () => {
    expect(openedYears([{ name: 'Legacy' }])).toEqual(new Set());
  });
});

describe('fiscalYearProblem', () => {
  it('accepts a valid, unused year with an account chosen', () => {
    expect(fiscalYearProblem(2026, '31000', new Set())).toBeNull();
  });

  /** `@IsInt() @Min(2000) @Max(2100)`. */
  it('enforces the DTO’s year bounds', () => {
    expect(fiscalYearProblem(1999, '31000', new Set())).toBe('year-range');
    expect(fiscalYearProblem(2101, '31000', new Set())).toBe('year-range');
    expect(fiscalYearProblem(null, '31000', new Set())).toBe('year-range');
  });

  /** The server answers 409; refusing first says which year rather than "already exists". */
  it('refuses a year that is already open', () => {
    expect(fiscalYearProblem(2025, '31000', new Set([2025]))).toBe('year-exists');
  });

  it('requires a retained earnings account', () => {
    expect(fiscalYearProblem(2026, '', new Set())).toBe('retained-earnings');
  });
});

describe('CreateFiscalYearForm', () => {
  /**
   * The start month comes from a FiscalCalendarPolicy no endpoint exposes, so the form cannot
   * know it. §6.14 promises Jan–Dec; this deliberately does not.
   */
  it('does not promise January, since the start month is not knowable here', () => {
    renderWithProviders(<CreateFiscalYearForm onDone={vi.fn()} />);

    expect(screen.getByText(/fiscal year start month/i)).toBeInTheDocument();
    expect(screen.queryByText(/January/i)).not.toBeInTheDocument();
  });

  it('offers the retained earnings account by code and name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFiscalYearForm onDone={vi.fn()} />);

    await openSelect(user, screen.getByLabelText('Retained earnings account'));
    expect(
      screen.getByRole('option', { name: '31000 · Retained Earnings' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Salaam Bank/ })).not.toBeInTheDocument();
  });

  it('refuses a duplicate year before the server has to', async () => {
    const user = userEvent.setup();
    mocks.useFiscalYears.mockReturnValue({
      data: [{ name: 'FY2026' }],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<CreateFiscalYearForm onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Year'), '2026');
    await chooseOption(user, screen.getByLabelText('Retained earnings account'), '31000');
    await user.click(screen.getByRole('button', { name: 'Open fiscal year' }));

    expect(screen.getByText('That fiscal year is already open.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('sends the year as a number and the account as a code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFiscalYearForm onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Year'), '2027');
    await chooseOption(user, screen.getByLabelText('Retained earnings account'), '31000');
    await user.click(screen.getByRole('button', { name: 'Open fiscal year' }));

    expect(mutate).toHaveBeenCalledWith(
      { year: 2027, retainedEarningsAccountCode: '31000' },
      expect.anything(),
    );
  });

  it('explains when the chart has no equity account to close into', () => {
    mocks.useAccounts.mockReturnValue({ data: [BANK], isPending: false, isError: false });
    renderWithProviders(<CreateFiscalYearForm onDone={vi.fn()} />);

    expect(screen.getByText('No equity account is available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open fiscal year' })).not.toBeInTheDocument();
  });

});
