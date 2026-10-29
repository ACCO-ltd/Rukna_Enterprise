import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserWithRolesResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Administration → Users on the ADR-047 list page: title block with counts, views, selection
 * with bulk (de)activate, and the row menu that never offers deactivating yourself.
 */
const hooks = vi.hoisted(() => {
  const idle = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null });
  return {
    useUsers: vi.fn(),
    useDeactivateUser: vi.fn(idle),
    useReactivateUser: vi.fn(idle),
    useBulkUserStatus: vi.fn(idle),
  };
});
vi.mock('../hooks/use-users', async (original) => ({ ...(await original<object>()), ...hooks }));
vi.mock('@/features/auth/session/use-session', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('@/features/roles/hooks/use-roles', () => ({
  useRoles: () => ({ data: [], isPending: false, isError: false }),
}));

import { UsersList } from './users-list';

function user(id: string, overrides: Partial<UserWithRolesResponse> = {}): UserWithRolesResponse {
  return {
    id,
    email: `${id}@example.com`,
    firstName: id === 'me' ? 'Sami' : 'Omar',
    lastName: id,
    status: 'ACTIVE',
    membershipStatus: 'ACTIVE',
    roles: [],
    whatsappPhone: null,
    whatsappAlertsEnabled: false,
    ...overrides,
  } as UserWithRolesResponse;
}

const table = async () => within(await screen.findByRole('table'));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useUsers.mockReturnValue({
    data: [user('me'), user('u2'), user('u3', { status: 'INACTIVE' as UserWithRolesResponse['status'] })],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('UsersList', () => {
  it('counts users in the title block and narrows with the Inactive view', async () => {
    const userEv = userEvent.setup();
    renderWithProviders(<UsersList />, { permissions: ['manage:user'], withToast: true });

    expect(await screen.findByText('3 users · 2 active')).toBeInTheDocument();
    await userEv.click(screen.getByRole('tab', { name: /Inactive/ }));
    const grid = await table();
    expect(grid.getByText('Omar u3')).toBeInTheDocument();
    expect(grid.queryByText('Omar u2')).not.toBeInTheDocument();
  });

  it('selecting rows shows the bulk bar with its count', async () => {
    const userEv = userEvent.setup();
    renderWithProviders(<UsersList />, { permissions: ['manage:user'], withToast: true });

    await userEv.click((await table()).getByRole('checkbox', { name: /Omar u2/ }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate selected' })).toBeInTheDocument();
  });

  it('never offers Deactivate on your own row', async () => {
    const userEv = userEvent.setup();
    renderWithProviders(<UsersList />, { permissions: ['manage:user'], withToast: true });

    await userEv.click((await table()).getByRole('button', { name: 'Actions for Sami me' }));
    expect(await screen.findByRole('menuitem', { name: /Manage roles/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('hides selection and row commands from someone who may not manage users', async () => {
    renderWithProviders(<UsersList />, { permissions: [], withToast: true });
    const grid = await table();
    expect(grid.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(grid.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add user/ })).not.toBeInTheDocument();
  });
});
