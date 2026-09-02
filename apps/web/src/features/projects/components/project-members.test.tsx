import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectRole } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { ProjectMember } from '../types';

/**
 * The project team screen.
 *
 * Rendering against the real catalogues proves every key exists in both locales — this screen
 * introduces twenty, including six role labels.
 *
 * The behavioural assertions pin the two guards the server does not have. Both can leave a
 * project nobody is able to administer, because adding a member requires already being one.
 */

const mocks = vi.hoisted(() => ({
  useProjectMembers: vi.fn(),
  useAddProjectMember: vi.fn(),
  useRemoveProjectMember: vi.fn(),
  useSetProjectMemberRoles: vi.fn(),
}));

const usersMocks = vi.hoisted(() => ({ useUsers: vi.fn() }));
const sessionMocks = vi.hoisted(() => ({ useSession: vi.fn() }));

vi.mock('../hooks/use-project-members', () => mocks);
vi.mock('@/features/users/hooks/use-users', () => usersMocks);
vi.mock('@/features/auth/session/use-session', () => sessionMocks);

import { ProjectMembers } from './project-members';
import { openSelect } from '@/test/choose-option';

function member(id: string, userId: string, roles: ProjectRole[], first: string): ProjectMember {
  return {
    id,
    userId,
    joinedAt: '2026-08-01T00:00:00.000Z',
    joinedBy: 'u-1',
    removedAt: null,
    roles: roles.map((role, index) => ({
      id: `${id}-r${index}`,
      role,
      assignedAt: '2026-08-01T00:00:00.000Z',
      assignedBy: 'u-1',
      removedAt: null,
    })) as ProjectMember['roles'],
    user: { id: userId, firstName: first, lastName: 'Yusuf', email: `${userId}@acco.test` },
  };
}

const MANAGER = member('m-1', 'u-1', [ProjectRole.PROJECT_MANAGER], 'Amina');
const ENGINEER = member('m-2', 'u-2', [ProjectRole.SITE_ENGINEER], 'Bashir');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProjectMembers.mockReturnValue({
    data: [MANAGER, ENGINEER],
    isPending: false,
    isError: false,
  });
  mocks.useAddProjectMember.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useRemoveProjectMember.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSetProjectMemberRoles.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  usersMocks.useUsers.mockReturnValue({ data: [], isPending: false, isError: false });
  // A third party, so neither member is "self" unless a test says so.
  sessionMocks.useSession.mockReturnValue({ user: { id: 'u-9' }, accessToken: 't' });
});

describe('ProjectMembers', () => {
  it('lists each member with their name, email and translated roles', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument();
    expect(screen.getByText('u-2@acco.test')).toBeInTheDocument();
    expect(screen.getAllByText('Project manager')).toHaveLength(2);
    expect(screen.getByText('Site engineer')).toBeInTheDocument();
  });

  it('states that only a member can change the membership', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getByText(/Only someone already on the project/i)).toBeInTheDocument();
  });

  /** The server allows this and it is unrecoverable from the UI. */
  it('disables removing the last project manager, with the reason attached', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveAttribute('title', expect.stringMatching(/only project manager/i));
  });

  it('allows removing a member who is not the last manager', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getAllByRole('button', { name: 'Remove' })[1]).toBeEnabled();
  });

  it('disables removing yourself, because you could not add yourself back', () => {
    sessionMocks.useSession.mockReturnValue({ user: { id: 'u-2' }, accessToken: 't' });
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    expect(buttons[1]).toBeDisabled();
    expect(buttons[1]).toHaveAttribute('title', expect.stringMatching(/cannot remove yourself/i));
  });

  it('offers only users who are not already members', async () => {
    const user = userEvent.setup();
    usersMocks.useUsers.mockReturnValue({
      data: [
        { id: 'u-1', email: 'u-1@acco.test', firstName: 'Amina', lastName: 'Yusuf', status: 'ACTIVE', organizationId: 'org-1' },
        { id: 'u-3', email: 'u-3@acco.test', firstName: 'Caasho', lastName: 'Nur', status: 'ACTIVE', organizationId: 'org-1' },
      ],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    await openSelect(user, screen.getByLabelText('Name'));
    expect(screen.getByRole('option', { name: /Caasho Nur/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Amina Yusuf ·/ })).not.toBeInTheDocument();
  });

  it('says so when everyone in the organisation is already on the project', () => {
    usersMocks.useUsers.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getByText(/already on this project/i)).toBeInTheDocument();
  });

  /** `@ArrayMinSize(1)`, and there is no endpoint to add a role afterwards. */
  it('will not submit without a role selected', () => {
    usersMocks.useUsers.mockReturnValue({
      data: [{ id: 'u-3', email: 'u-3@acco.test', firstName: 'Caasho', lastName: 'Nur', status: 'ACTIVE', organizationId: 'org-1' }],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getByRole('button', { name: 'Add to project' })).toBeDisabled();
  });

  it('edit roles: offers only the assignable roles, not the deprecated ones', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    // ENGINEER (row 1) is not the last manager — open its role editor.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit roles' })[1]);

    expect(screen.getByRole('button', { name: 'Project manager' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Site engineer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viewer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quantity surveyor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commercial manager' })).not.toBeInTheDocument();
  });

  it("edit roles: locks the Project Manager toggle for the project's last manager", () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    // MANAGER (row 0) is the only project manager — its PM role cannot be dropped.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit roles' })[0]);

    expect(screen.getByRole('button', { name: 'Project manager' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Site engineer' })).toBeEnabled();
  });

  it('renders an empty team without error', () => {
    mocks.useProjectMembers.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<ProjectMembers projectId="p-1" />);

    expect(screen.getByText(/No members on this project/i)).toBeInTheDocument();
  });

});
