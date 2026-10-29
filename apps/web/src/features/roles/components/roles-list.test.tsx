import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleSummary } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Administration → Roles on the ADR-047 list page: views by kind, the template named (never an
 * id), and SYSTEM roles offered for review only.
 */
const hooks = vi.hoisted(() => ({
  useRoles: vi.fn(),
  useDeleteRole: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));
vi.mock('../hooks/use-roles', async (original) => ({ ...(await original<object>()), ...hooks }));
vi.mock('@/features/users/hooks/use-users', () => ({
  useUsers: () => ({ data: [{ id: 'u1', email: 'owner@example.com' }] }),
}));

import { RolesList } from './roles-list';

function role(overrides: Partial<RoleSummary> & { id: string; name: string }): RoleSummary {
  return {
    description: null,
    kind: 'CUSTOM',
    purpose: null,
    ownerUserId: null,
    templateRoleId: null,
    permissionCount: 3,
    memberCount: 1,
    ...overrides,
  };
}

const table = async () => within(await screen.findByRole('table'));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useRoles.mockReturnValue({
    data: [
      role({ id: 'r1', name: 'Admin', kind: 'SYSTEM' }),
      role({ id: 'r2', name: 'Site buyer', templateRoleId: 'r1', ownerUserId: 'u1', memberCount: 0 }),
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('RolesList', () => {
  it('names the template and the owner, and counts custom roles in the title block', async () => {
    renderWithProviders(<RolesList />, { permissions: ['manage:role'], withToast: true });

    expect(await screen.findByText('2 roles · 1 custom')).toBeInTheDocument();
    const grid = await table();
    expect(grid.getByText(/Template: Admin/)).toBeInTheDocument();
    expect(grid.queryByText(/Template: r1/)).not.toBeInTheDocument();
    expect(grid.getByText(/owner@example.com/)).toBeInTheDocument();
  });

  it('the Unused view keeps roles nobody holds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesList />, { permissions: ['manage:role'], withToast: true });

    await user.click(await screen.findByRole('tab', { name: /Unused/ }));
    const grid = await table();
    expect(grid.getByText('Site buyer')).toBeInTheDocument();
    expect(grid.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('offers a SYSTEM role for review only, and a CUSTOM role its commands', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesList />, { permissions: ['manage:role'], withToast: true });

    const grid = await table();
    expect(grid.getByRole('button', { name: 'Protected' })).toBeInTheDocument();
    await user.click(grid.getByRole('button', { name: 'Actions for Site buyer' }));
    expect(await screen.findByRole('menuitem', { name: /Delete/ })).toBeInTheDocument();
  });
});
