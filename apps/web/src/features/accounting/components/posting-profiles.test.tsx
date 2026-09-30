import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { chooseOption, openSelect } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import { formatDate } from '@/lib/format';

import { shiftIsoDate, todayIso } from '../posting-profile-setup';
import type { Account, AccountClass, PostingProfile } from '../types';
import { PostingProfiles } from './posting-profiles';

/**
 * Posting profiles (ADR-040 §4): view:accounting reads, manage:accounting changes.
 */

const api = vi.hoisted(() => ({
  listPostingProfiles: vi.fn(),
  listAccounts: vi.fn(),
  createPostingProfile: vi.fn(),
  repointPostingProfile: vi.fn(),
  setPostingProfileActive: vi.fn(),
}));

vi.mock('../api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

function account(
  id: string,
  code: string,
  name: string,
  accountClass: AccountClass,
  extra: {
    isPostingAllowed?: boolean;
    isControlAccount?: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
  } = {},
): Account {
  return {
    id,
    organizationId: 'org-1',
    code,
    normalBalance: 'DEBIT',
    status: extra.status ?? 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u',
    versions: [
      {
        id: `${id}-v1`,
        accountId: id,
        versionNumber: 1,
        name,
        parentAccountId: null,
        accountClass,
        accountSubtype: 'X',
        isPostingAllowed: extra.isPostingAllowed ?? true,
        isControlAccount: extra.isControlAccount ?? false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  };
}

const CEMENT = account('a-cement', '51100', 'Cement and concrete', 'COST_OF_SALES');
const STEEL = account('a-steel', '51200', 'Steel and reinforcement', 'COST_OF_SALES');
const RENT = account('a-rent', '61100', 'Office rent', 'EXPENSE');
const REVENUE = account('a-rev', '40000', 'Contract revenue', 'INCOME');
const BANK = account('a-bank', '10100', 'Salaam Bank', 'ASSET');
const MATERIALS_HEADING = account('a-mat', '51000', 'Materials', 'COST_OF_SALES', {
  isPostingAllowed: false,
});
const OLD = account('a-old', '51900', 'Old materials', 'COST_OF_SALES', { status: 'INACTIVE' });
const ALL = [CEMENT, STEEL, RENT, REVENUE, BANK, MATERIALS_HEADING, OLD];

/** The server shape since ADR-040: every version labelled, plus the account in force today. */
function profile(
  id: string,
  code: string,
  name: string,
  accountId: string,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): PostingProfile {
  const account = ALL.find((a) => a.id === accountId)!;
  const version = account.versions[0]!;
  return {
    id,
    code,
    status,
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        description: null,
        accountId,
        accountCode: account.code,
        accountName: version.name,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ],
    currentAccount: {
      id: accountId,
      code: account.code,
      name: version.name,
      accountClass: version.accountClass,
    },
  };
}

const PROFILES: PostingProfile[] = [
  profile('p-1', 'COST_51100', 'Cement and concrete', 'a-cement'),
  profile('p-2', 'OFFICE_RENT', 'Office rent', 'a-rent', 'INACTIVE'),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.listPostingProfiles.mockResolvedValue(PROFILES);
  api.listAccounts.mockResolvedValue([CEMENT, STEEL, RENT, REVENUE, BANK, MATERIALS_HEADING, OLD]);
});

const VIEW = ['view:accounting'];

const MANAGE = ['view:accounting', 'manage:accounting'];

describe('PostingProfiles — reading', () => {
  it('lists each profile with the account it points to, its class and status', async () => {
    renderWithProviders(<PostingProfiles />, { permissions: VIEW });

    const row = (await screen.findByText('COST_51100')).closest('tr')!;
    await within(row).findByText('51100');
    expect(row).toHaveTextContent('51100 · Cement and concrete');
    expect(within(row).getByText('Cost of Sales')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();

    const inactive = screen.getByText('OFFICE_RENT').closest('tr')!;
    expect(within(inactive).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('2 posting profiles')).toBeInTheDocument();
  });

  it('offers no changes to someone who can only view', async () => {
    renderWithProviders(<PostingProfiles />, { permissions: VIEW });

    await screen.findByText('COST_51100');
    expect(screen.queryByRole('button', { name: 'New posting profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-point/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Only an administrator can change posting profiles.'),
    ).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    api.listPostingProfiles.mockResolvedValue([]);
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    expect(await screen.findByText('No posting profiles yet.')).toBeInTheDocument();
  });
});

describe('PostingProfiles — creating', () => {
  it('derives the code from the name, offers only eligible accounts, and sends the body', async () => {
    api.createPostingProfile.mockResolvedValue(
      profile('p-3', 'SITE_STEEL', 'Site steel', 'a-steel'),
    );
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE, withToast: true });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'New posting profile' }));

    const dialog = await screen.findByRole('dialog', { name: 'New posting profile' });
    await user.type(within(dialog).getByLabelText('Name'), 'Site steel');
    expect(within(dialog).getByLabelText('Code')).toHaveValue('SITE_STEEL');

    await openSelect(user, within(dialog).getByLabelText('Posts to account'));
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    // Active posting accounts in income, cost of sales and expenses only.
    expect(options.some((o) => o.includes('51200'))).toBe(true);
    expect(options.some((o) => o.includes('40000'))).toBe(true);
    expect(options.some((o) => o.includes('61100'))).toBe(true);
    expect(options.some((o) => o.includes('10100'))).toBe(false); // asset
    expect(options.some((o) => o.includes('51000'))).toBe(false); // heading
    expect(options.some((o) => o.includes('51900'))).toBe(false); // inactive
    await user.click(screen.getByRole('option', { name: /51200/ }));
    await act(async () => {});

    await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

    await waitFor(() => expect(api.createPostingProfile).toHaveBeenCalledTimes(1));
    expect(api.createPostingProfile.mock.calls[0]![0]).toEqual({
      code: 'SITE_STEEL',
      name: 'Site steel',
      accountCode: '51200',
    });
    expect(await screen.findByText('Posting profile SITE_STEEL created')).toBeInTheDocument();
  });

  it('narrows the account list with the search field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'New posting profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'New posting profile' });

    await user.type(within(dialog).getByLabelText('Search by code or name'), 'rent');
    await openSelect(user, within(dialog).getByLabelText('Posts to account'));
    const offered = screen
      .getAllByRole('option')
      .filter((o) => o.getAttribute('data-value') !== '')
      .map((o) => o.textContent);
    expect(offered.filter((text) => text !== 'Choose an account')).toEqual(['61100 · Office rent']);
  });

  it('refuses a code already in use before asking the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'New posting profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'New posting profile' });

    await user.type(within(dialog).getByLabelText('Name'), 'Cement');
    const code = within(dialog).getByLabelText('Code');
    await user.clear(code);
    await user.type(code, 'COST_51100');
    await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

    expect(
      within(dialog).getByText('A posting profile with this code already exists.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Choose the account the profile posts to.'),
    ).toBeInTheDocument();
    expect(api.createPostingProfile).not.toHaveBeenCalled();
  });

  it('explains a 409 POSTING_PROFILE_CODE_TAKEN from the server', async () => {
    api.createPostingProfile.mockRejectedValue(
      new ApiError(409, 'POSTING_PROFILE_CODE_TAKEN', 'POSTING_PROFILE_CODE_TAKEN'),
    );
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'New posting profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'New posting profile' });
    await user.type(within(dialog).getByLabelText('Name'), 'Office rent 2');
    await chooseOption(user, within(dialog).getByLabelText('Posts to account'), '61100');
    await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

    expect(
      await within(dialog).findByText('A posting profile with this code already exists.'),
    ).toBeInTheDocument();
  });
});

describe('PostingProfiles — re-pointing and status', () => {
  it('re-points to a new account from an effective date', async () => {
    api.repointPostingProfile.mockResolvedValue(PROFILES[0]);
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE, withToast: true });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'Re-point COST_51100' }));

    const dialog = await screen.findByRole('dialog', { name: 'Re-point COST_51100' });
    expect(within(dialog).getByText(/History is kept/)).toBeInTheDocument();
    expect(
      within(dialog).getByText('Currently posts to 51100 · Cement and concrete'),
    ).toBeInTheDocument();

    // Pointing at the same account is refused.
    await chooseOption(user, within(dialog).getByLabelText('New account'), '51100');
    await user.click(within(dialog).getByRole('button', { name: 'Re-point profile' }));
    expect(
      within(dialog).getByText('The profile already posts to this account.'),
    ).toBeInTheDocument();

    await chooseOption(user, within(dialog).getByLabelText('New account'), '51200');
    await user.click(within(dialog).getByRole('button', { name: 'Re-point profile' }));

    await waitFor(() => expect(api.repointPostingProfile).toHaveBeenCalledTimes(1));
    expect(api.repointPostingProfile).toHaveBeenCalledWith('p-1', {
      accountCode: '51200',
      effectiveFrom: todayIso(),
    });
    expect(await screen.findByText('Posting profile now posts to 51200')).toBeInTheDocument();
  });

  it('shows a re-point that has not taken effect yet beside today’s account', async () => {
    const future = '2099-03-01';
    const repointed: PostingProfile = {
      ...PROFILES[0]!,
      versions: [
        {
          id: 'p-1-v2',
          versionNumber: 2,
          name: 'Cement and concrete',
          description: null,
          accountId: 'a-steel',
          accountCode: '51200',
          accountName: 'Steel and reinforcement',
          effectiveFrom: `${future}T00:00:00.000Z`,
          effectiveTo: null,
        },
        { ...PROFILES[0]!.versions[0]!, effectiveTo: `${future}T00:00:00.000Z` },
      ],
    };
    api.listPostingProfiles.mockResolvedValue([repointed]);
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    const row = (await screen.findByText('COST_51100')).closest('tr')!;
    expect(row).toHaveTextContent('51100 · Cement and concrete');
    expect(row).toHaveTextContent(`From ${formatDate(future)}: 51200`);

    // A further re-point must start after the scheduled one.
    await user.click(within(row).getByRole('button', { name: 'Re-point COST_51100' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-point COST_51100' });
    expect(
      within(dialog).getByText(`The current account stays in force until ${formatDate(future)}.`),
    ).toBeInTheDocument();
  });

  it('says until when the current account holds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'Re-point COST_51100' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-point COST_51100' });

    await chooseOption(user, within(dialog).getByLabelText('New account'), '51200');
    const yesterday = formatDate(shiftIsoDate(todayIso(), -1));
    expect(
      within(dialog).getByText(`The current account stays in force until ${yesterday}.`),
    ).toBeInTheDocument();
  });

  it('deactivates an active profile after confirmation', async () => {
    api.setPostingProfileActive.mockResolvedValue({ ...PROFILES[0], status: 'INACTIVE' });
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE, withToast: true });

    await screen.findByText('COST_51100');
    await user.click(screen.getByRole('button', { name: 'Actions for COST_51100' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));

    const confirm = await screen.findByRole('dialog', { name: 'Deactivate COST_51100' });
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate profile' }));

    await waitFor(() => expect(api.setPostingProfileActive).toHaveBeenCalledWith('p-1', false));
    expect(await screen.findByText('Posting profile COST_51100 deactivated')).toBeInTheDocument();
  });

  it('reactivates an inactive profile, and offers no re-point on it', async () => {
    api.setPostingProfileActive.mockResolvedValue({ ...PROFILES[1], status: 'ACTIVE' });
    const user = userEvent.setup();
    renderWithProviders(<PostingProfiles />, { permissions: MANAGE });

    await screen.findByText('OFFICE_RENT');
    expect(screen.queryByRole('button', { name: 'Re-point OFFICE_RENT' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for OFFICE_RENT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reactivate OFFICE_RENT' });
    await user.click(within(confirm).getByRole('button', { name: 'Reactivate profile' }));

    await waitFor(() => expect(api.setPostingProfileActive).toHaveBeenCalledWith('p-2', true));
  });
});
