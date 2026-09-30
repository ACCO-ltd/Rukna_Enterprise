import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserWithRolesResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * Success feedback for the user commands, through the real hooks and the app's QueryProvider:
 * the toast comes from each mutation's `meta` (`lib/mutation-feedback.ts`), not from the
 * component, so these run the hooks unmocked and stub only the HTTP layer.
 */
vi.mock('../api/users-api', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
  provisionTemporaryUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  setUserPassword: vi.fn(),
  setUserRoles: vi.fn(),
  createUser: vi.fn(),
  regenerateTemporaryPassword: vi.fn(),
}));
vi.mock('@/features/roles/hooks/use-roles', () => ({
  useRoles: () => ({ data: [], isPending: false, isError: false }),
}));

import { provisionTemporaryUser, updateUser } from '../api/users-api';
import { CreateUserDialog, EditUserDialog } from './user-form-dialogs';

const OMAR = {
  id: 'u2',
  email: 'omar@acco.com',
  firstName: 'Omar',
  lastName: 'Nur',
  status: 'ACTIVE',
  membershipStatus: 'ACTIVE',
  roles: [],
} as unknown as UserWithRolesResponse;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('user commands — success feedback', () => {
  it('confirms a created user with a toast naming them, beside the credentials', async () => {
    vi.mocked(provisionTemporaryUser).mockResolvedValue({
      user: OMAR,
      temporaryPassword: 'Temp-1234',
      expiresAt: '2026-10-07T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderWithProviders(<CreateUserDialog open onOpenChange={vi.fn()} />, { withToast: true });

    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    await user.type(within(dialog).getByLabelText(/Email/), 'omar@acco.com');
    await user.type(within(dialog).getByLabelText(/First name/), 'Omar');
    await user.type(within(dialog).getByLabelText(/Last name/), 'Nur');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('User Omar Nur created')).toBeInTheDocument();
  });

  it('confirms an edit with a toast naming the saved user', async () => {
    vi.mocked(updateUser).mockResolvedValue({ ...OMAR, firstName: 'Omar', lastName: 'Nuur' });
    const user = userEvent.setup();
    renderWithProviders(<EditUserDialog user={OMAR} onOpenChange={vi.fn()} />, { withToast: true });

    const lastName = screen.getByLabelText(/Last name/);
    await user.clear(lastName);
    await user.type(lastName, 'Nuur');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('User Omar Nuur updated')).toBeInTheDocument();
  });
});
