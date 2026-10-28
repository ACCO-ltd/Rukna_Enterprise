import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RoleMatrixRole } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { getRoleMatrix, setRolePermissions } from '../api/roles-api';
import { listPermissions } from '@/features/permissions/api/permissions-api';

import { matrixChanges, RolesMatrix } from './roles-matrix';

vi.mock('../api/roles-api', () => ({ getRoleMatrix: vi.fn(), setRolePermissions: vi.fn() }));
vi.mock('@/features/permissions/api/permissions-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/permissions/api/permissions-api')>()),
  listPermissions: vi.fn(),
}));

const role = (patch: Partial<RoleMatrixRole>): RoleMatrixRole => ({
  id: 'r1', name: 'Site clerk', description: null, kind: 'CUSTOM', purpose: 'x', ownerUserId: null, templateRoleId: null,
  permissionCount: 1, memberCount: 2, permissionIds: ['p-view'], ...patch,
});
const catalogue = [
  { id: 'p-view', action: 'view', resource: 'journal', description: 'See journals', domain: 'Finance', riskClass: 'LOW' as const },
  { id: 'p-manage', action: 'manage', resource: 'journal', description: 'Create and post journals', domain: 'Finance', riskClass: 'CRITICAL' as const },
];

describe('matrixChanges', () => {
  it('sends only the roles whose set changed, whole', () => {
    const roles = [role({}), role({ id: 'r2', permissionIds: ['p-manage'] })];
    const draft = new Map([
      ['r1', new Set(['p-view', 'p-manage'])],
      ['r2', new Set(['p-manage'])],
    ]);
    expect(matrixChanges(roles, draft)).toEqual([{ roleId: 'r1', permissionIds: ['p-manage', 'p-view'] }]);
  });
});

describe('RolesMatrix (Step 3)', () => {
  it('shows every role against every permission, locks system roles, and saves a custom role whole', async () => {
    const user = userEvent.setup();
    vi.mocked(getRoleMatrix).mockResolvedValue({
      roles: [role({}), role({ id: 'sys', name: 'CFO', kind: 'SYSTEM', permissionIds: ['p-view', 'p-manage'] })],
    });
    vi.mocked(listPermissions).mockResolvedValue(catalogue);
    vi.mocked(setRolePermissions).mockResolvedValue({} as never);
    renderWithProviders(<RolesMatrix />, { permissions: ['view:role', 'manage:role'], withToast: true });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Critical')).toBeInTheDocument();
    // The system role is read only: a mark, not a checkbox.
    expect(within(table).getByLabelText('CFO has manage:journal').tagName).not.toBe('INPUT');

    await user.click(within(table).getByRole('checkbox', { name: 'Site clerk does not have manage:journal' }));
    expect(screen.getByText('Unsaved changes to 1 role')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(setRolePermissions).toHaveBeenCalledWith('r1', { permissionIds: ['p-manage', 'p-view'] }));
    expect(setRolePermissions).toHaveBeenCalledTimes(1);
  });

  it('is read only without manage:role', async () => {
    vi.mocked(getRoleMatrix).mockResolvedValue({ roles: [role({})] });
    vi.mocked(listPermissions).mockResolvedValue(catalogue);
    renderWithProviders(<RolesMatrix />, { permissions: ['view:role'] });
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/Read only/)).toBeInTheDocument();
  });
});
