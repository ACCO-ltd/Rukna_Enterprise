import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupImportCheck } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
import { pickDate } from '@/test/pick-date';
import { parseSpreadsheet } from '@/lib/spreadsheet';

import { checkSetupImport, runSetupImport } from './api';
import { SetupImportWizard } from './import-wizard';

vi.mock('./api', () => ({ checkSetupImport: vi.fn(), runSetupImport: vi.fn() }));
vi.mock('@/lib/spreadsheet', () => ({ parseSpreadsheet: vi.fn() }));
vi.mock('@/features/auth/permissions/can', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/permissions/can')>()),
  usePermissions: () => ({ can: () => true }),
}));

const check = (over: Partial<SetupImportCheck> = {}): SetupImportCheck => ({
  kind: 'suppliers',
  openingBalancesOpen: true,
  rows: [
    { index: 0, status: 'READY', action: 'CREATE', problems: [], duplicateOf: null, openingBalance: '1200.00' },
    {
      index: 1, status: 'ERROR', action: 'CREATE', duplicateOf: null, openingBalance: null,
      problems: [{ field: 'phone', code: 'PHONE_INVALID', severity: 'ERROR', message: '"99" is not a valid phone number' }],
    },
    {
      index: 2, status: 'WARNING', action: 'CREATE', openingBalance: '300.00',
      duplicateOf: { id: 's-1', code: 'SUP-001', name: 'Horn Steel' },
      problems: [{ field: null, code: 'LIKELY_DUPLICATE', severity: 'WARNING', message: 'Looks like Horn Steel (SUP-001)' }],
    },
  ],
  summary: { total: 3, toCreate: 2, toMerge: 0, skipped: 0, withErrors: 1, withWarnings: 1, openingBalanceTotal: '1500.00', openingItems: 2 },
  ...over,
});

beforeEach(() => {
  vi.mocked(parseSpreadsheet).mockResolvedValue({
    columns: ['Vendor Name', 'Phone', 'Balance Due'],
    rows: [['Blue Nile Timber', '+254712000111', '1,200.00'], ['Bad Phone Co', '99', ''], ['Horn Steel Ltd', '', '300']],
  });
  vi.mocked(checkSetupImport).mockReset().mockResolvedValue(check());
  vi.mocked(runSetupImport).mockReset().mockResolvedValue({
    kind: 'suppliers', created: 1, merged: 1, skipped: 1, openingItems: 2, openingBalanceTotal: '1500.00', batchReference: 'IMPORT-SUP-1',
  });
});

describe('SetupImportWizard (Step 5)', () => {
  it('uploads, matches, checks problems first, merges a duplicate, skips errors and imports', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupImportWizard kind="suppliers" />);

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'vendors.xlsx'));
    expect(await screen.findByText('3 rows and 3 columns read.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Columns were matched by their usual names; a balance column asks for the opening date.
    expect(screen.getByText('e.g. Blue Nile Timber')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check rows' }));
    expect(screen.getByText('Choose the date the balances are as of.')).toBeInTheDocument();
    expect(checkSetupImport).not.toHaveBeenCalled();
    await pickDate(user, screen.getByLabelText(/Opening balances are as of/), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Check rows' }));

    await waitFor(() => expect(checkSetupImport).toHaveBeenCalledWith('suppliers', expect.objectContaining({
      openingDate: '2026-01-01',
      rows: [
        { name: 'Blue Nile Timber', phone: '+254712000111', openingBalance: '1,200.00' },
        { name: 'Bad Phone Co', phone: '99' },
        { name: 'Horn Steel Ltd', openingBalance: '300' },
      ],
    })));

    // Problems come first, by sheet line; the outcome is spelt out before anything is saved.
    const problems = await screen.findByRole('list', { name: 'Rows to review' });
    const items = within(problems).getAllByRole('listitem').filter((li) => li.parentElement === problems);
    expect(items[0]).toHaveTextContent('Line 3');
    expect(items[0]).toHaveTextContent('Phone: "99" is not a valid phone number');
    expect(items[1]).toHaveTextContent('Line 4');
    expect(screen.getByText(/2 suppliers created; opening payables of \$1,500\.00 recorded as 2 open bills\./)).toBeInTheDocument();

    // Next is held while errors remain and are not skipped.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('button', { name: /Import \d+ supplier/ })).toBeNull();

    // Merge the likely duplicate: the check is now stale until checked again.
    await chooseOption(user, within(items[1]).getByRole('combobox'), 'MERGE');
    expect(screen.getByText('You changed some rows')).toBeInTheDocument();
    vi.mocked(checkSetupImport).mockResolvedValueOnce(check({
      summary: { total: 3, toCreate: 1, toMerge: 1, skipped: 0, withErrors: 1, withWarnings: 0, openingBalanceTotal: '1500.00', openingItems: 2 },
    }));
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(vi.mocked(checkSetupImport).mock.calls.at(-1)![1].rows[2]).toMatchObject({ action: 'MERGE', mergeIntoId: 's-1' });

    await user.click(await screen.findByLabelText('Skip the row with errors'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Import 2 suppliers' }));

    expect(runSetupImport).toHaveBeenCalledWith('suppliers', expect.objectContaining({ skipRowsWithErrors: true }));
    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText(/enter \$1,500\.00 for Accounts payable/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open suppliers' })).toHaveAttribute('href', '/procurement/suppliers');
  });

  it('asks for a column for the name when none was recognised', async () => {
    vi.mocked(parseSpreadsheet).mockResolvedValue({ columns: ['Party', 'Mobile'], rows: [['A', '1']] });
    const user = userEvent.setup();
    renderWithProviders(<SetupImportWizard kind="clients" />);
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'c.csv'));
    await screen.findByText('1 row and 2 columns read.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Check rows' }));
    expect(screen.getByText('Choose a column for: Name')).toBeInTheDocument();
    expect(checkSetupImport).not.toHaveBeenCalled();
  });
});
