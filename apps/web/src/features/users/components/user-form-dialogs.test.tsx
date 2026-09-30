import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserWithRolesResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * The Administration user forms run on the shared FormDialog shell (ADR-039): a pinned footer with
 * one primary, busy blocking every way out, and unsaved edits asked about before they are thrown
 * away. The requests are unchanged.
 */
const mocks = vi.hoisted(() => ({
  provision: vi.fn(),
  update: vi.fn(),
  pending: false,
}));

const mutation = (mutate: ReturnType<typeof vi.fn>) => () => ({
  mutate,
  reset: vi.fn(),
  isPending: mocks.pending,
  error: null,
  data: undefined,
});

vi.mock('../hooks/use-users', () => ({
  useProvisionTemporaryUser: () => mutation(mocks.provision)(),
  useUpdateUser: () => mutation(mocks.update)(),
  useRegenerateTemporaryPassword: () => mutation(vi.fn())(),
  useSetUserPassword: () => mutation(vi.fn())(),
  useSetUserRoles: () => mutation(vi.fn())(),
}));
vi.mock('@/features/roles/hooks/use-roles', () => ({
  useRoles: () => ({
    data: [{ id: 'r1', name: 'Finance Manager', kind: 'SYSTEM', description: null }],
    isPending: false,
    isError: false,
  }),
}));

import { CreateUserDialog, EMAIL_SHAPE, EditUserDialog } from './user-form-dialogs';

const USER = {
  id: 'u1',
  email: 'amina@acco.com',
  firstName: 'Amina',
  lastName: 'Ali',
  roles: [],
} as unknown as UserWithRolesResponse;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = false;
});

/**
 * The shape check once shipped with its backslashes stripped — `[^s@]` refused every address
 * containing an "s". These pin the escapes.
 */
describe('EMAIL_SHAPE', () => {
  it.each(['sam@acco.com', 'abdulsalam.test@gmail.com', 'admin@acco.com'])('accepts %s', (email) => {
    expect(EMAIL_SHAPE.test(email)).toBe(true);
  });

  it.each(['a b@x.y', 'a@b', 'no-at-sign.com', 'a@b@c.d'])('rejects %s', (email) => {
    expect(EMAIL_SHAPE.test(email)).toBe(false);
  });

  it('keeps its escapes: whitespace and a literal dot', () => {
    expect(EMAIL_SHAPE.source).toBe('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
  });
});

describe('CreateUserDialog', () => {
  it('creates a user whose email contains an "s"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateUserDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/Email/), 'abdulsalam.test@gmail.com');
    await user.type(screen.getByLabelText(/First name/), 'Abdulsalam');
    await user.type(screen.getByLabelText(/Last name/), 'Test');
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    expect(screen.queryByText('Enter an email address like name@company.com.')).not.toBeInTheDocument();
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'abdulsalam.test@gmail.com' }),
      expect.any(Object),
    );
  });

  it('creates the user with the same request, from a pinned footer with one primary', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateUserDialog open onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    await user.type(within(dialog).getByLabelText(/Email/), 'omar@acco.com');
    await user.type(within(dialog).getByLabelText(/First name/), 'Omar');
    await user.type(within(dialog).getByLabelText(/Last name/), 'Nur');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(mocks.provision).toHaveBeenCalledWith(
      { email: 'omar@acco.com', firstName: 'Omar', lastName: 'Nur', roleIds: [] },
      expect.any(Object),
    );
  });

  it('refuses a malformed email before any request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateUserDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/Email/), 'omar-at-acco');
    await user.type(screen.getByLabelText(/First name/), 'Omar');
    await user.type(screen.getByLabelText(/Last name/), 'Nur');
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    expect(screen.getByText('Enter an email address like name@company.com.')).toBeInTheDocument();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('asks before discarding a half-filled form', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<CreateUserDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText(/First name/), 'Omar');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks every way out while the request is in flight', () => {
    mocks.pending = true;
    renderWithProviders(<CreateUserDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });
});

describe('EditUserDialog', () => {
  it('opens seeded from the user and closes at once when nothing changed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<EditUserDialog user={USER} onOpenChange={onOpenChange} />);

    expect(screen.getByLabelText(/First name/)).toHaveValue('Amina');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves the new name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditUserDialog user={USER} onOpenChange={vi.fn()} />);

    await user.clear(screen.getByLabelText(/Last name/));
    await user.type(screen.getByLabelText(/Last name/), 'Hassan');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.update).toHaveBeenCalledWith(
      { id: 'u1', payload: { firstName: 'Amina', lastName: 'Hassan' } },
      expect.any(Object),
    );
  });
});
