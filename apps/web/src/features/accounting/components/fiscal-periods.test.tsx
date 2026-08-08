import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listFiscalYears } from '@/features/accounting/api/accounting-api';
import type { AccountingPeriod, FiscalYear, PeriodStatus } from '@/features/accounting/types';

import { FiscalPeriods } from './fiscal-periods';

vi.mock('@/features/accounting/api/accounting-api', () => ({ listFiscalYears: vi.fn() }));

function period(number: number, status: PeriodStatus, name: string): AccountingPeriod {
  const month = String(number).padStart(2, '0');
  return {
    id: `per-${number}`,
    fiscalYearId: 'fy-1',
    organizationId: 'org-1',
    periodNumber: number,
    name,
    startDate: `2026-${month}-01`,
    endDate: `2026-${month}-28`,
    periodType: 'OPERATING',
    status,
    reopenReason: null,
    reopenedBy: null,
    reopenedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function fiscalYear(overrides: Partial<FiscalYear> = {}): FiscalYear {
  return {
    id: 'fy-1',
    organizationId: 'org-1',
    name: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    retainedEarningsAccountId: 'acc-re',
    status: 'OPEN',
    closedAt: null,
    closedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    periods: [
      period(1, 'CLOSED', 'January 2026'),
      period(2, 'LOCKED', 'February 2026'),
      period(3, 'OPEN', 'March 2026'),
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listFiscalYears).mockReset();
  vi.mocked(listFiscalYears).mockResolvedValue([fiscalYear()]);
});

describe('FiscalPeriods', () => {
  it('groups periods under their fiscal year', async () => {
    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText('FY2026')).toBeInTheDocument();
    expect(screen.getByText('January 2026')).toBeInTheDocument();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });

  it('counts the periods and how many still accept postings', async () => {
    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText(/3 periods/)).toBeInTheDocument();
    expect(screen.getByText(/1 open/)).toBeInTheDocument();
  });

  it('counts a reopened period as open, because it accepts postings again', async () => {
    vi.mocked(listFiscalYears).mockResolvedValue([
      fiscalYear({ periods: [period(1, 'OPEN', 'January 2026'), period(2, 'REOPENED', 'February 2026')] }),
    ]);

    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText(/2 open/)).toBeInTheDocument();
  });

  /**
   * The status alone leaves the reader to remember which of four words accepts a journal.
   * What it means for posting is the thing they came to find out.
   */
  it('says what each status means for posting', async () => {
    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText('Accepts postings.')).toBeInTheDocument();
    expect(screen.getByText('Accepts closing adjustments only.')).toBeInTheDocument();
    expect(screen.getByText(/Rejects all postings/)).toBeInTheDocument();
  });

  it('shows why a period was reopened', async () => {
    vi.mocked(listFiscalYears).mockResolvedValue([
      fiscalYear({
        periods: [
          {
            ...period(1, 'REOPENED', 'January 2026'),
            reopenReason: 'Audit adjustment requested by the CFO',
          },
        ],
      }),
    ]);

    renderWithProviders(<FiscalPeriods />);

    expect(
      await screen.findByText('Audit adjustment requested by the CFO'),
    ).toBeInTheDocument();
  });

  /**
   * The period lifecycle endpoints exist but carry no authorization — any signed-in user
   * could close a fiscal year (#25). Saying so beats a screen that names period management
   * and silently offers none of it.
   */
  it('explains why locking and closing are absent', async () => {
    renderWithProviders(<FiscalPeriods />);

    expect(
      await screen.findByText(/Locking, closing and reopening periods are not available/),
    ).toBeInTheDocument();
    expect(screen.getByText(/issue #25/)).toBeInTheDocument();
  });

  it('handles a fiscal year in DRAFT, which the reference does not document', async () => {
    // §6.14 lists only OPEN and CLOSED, but the column defaults to DRAFT — so it is the
    // first status a newly created year has.
    vi.mocked(listFiscalYears).mockResolvedValue([fiscalYear({ status: 'DRAFT' })]);

    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText('FY2026')).toBeInTheDocument();
  });

  it('distinguishes no fiscal year from a failed load', async () => {
    vi.mocked(listFiscalYears).mockResolvedValue([]);
    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText('No fiscal year has been created.')).toBeInTheDocument();
  });

  it('reports a failure to load', async () => {
    vi.mocked(listFiscalYears).mockRejectedValue(new Error('network'));
    renderWithProviders(<FiscalPeriods />);

    expect(await screen.findByText('Could not load fiscal years.')).toBeInTheDocument();
  });

  it('renders in Arabic', async () => {
    renderWithProviders(<FiscalPeriods />, { locale: 'ar' });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('الفترات المالية');
    expect(screen.getByText('تقبل الترحيل.')).toBeInTheDocument();
  });
});
