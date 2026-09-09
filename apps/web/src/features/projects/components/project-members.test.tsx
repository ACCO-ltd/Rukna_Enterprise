import { screen } from '@testing-library/react';
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
  sessionMocks.useSession.mockReturnValue({
    user: { id: 'u-1', permissions: ['manage:project-member'], roles: [] },
    accessToken: 't',
  });
});

describe('ProjectMembers', () => {
  it('lists each member with their name, email and translated roles', () => {
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument();
    expect(screen.getByText('u-2@acco.test')).toBeInTheDocument();
    expect(screen.getAllByText('Project manager')).toHaveLength(1);
    expect(screen.getByText('Site engineer')).toBeInTheDocument();
  });

  it('hides membership actions without manage permission', () => {
    sessionMocks.useSession.mockReturnValue({
      user: { id: 'u-9', permissions: ['manage:project-member'], roles: [] },
    });
    renderWithProviders(<ProjectMembers projectId="p-1" />, { permissions: [] });
    expect(screen.queryByRole('button', { name: 'Add a member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('protects the last project manager from removal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });
    await user.click(screen.getByRole('button', { name: 'Actions for Amina Yusuf' }));
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('allows removing another team member', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });
    await user.click(screen.getByRole('button', { name: 'Actions for Bashir Yusuf' }));
    expect(screen.getByRole('menuitem', { name: 'Remove' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('offers only users who are not already members', async () => {
    const user = userEvent.setup();
    usersMocks.useUsers.mockReturnValue({
      data: [
        {
          id: 'u-1',
          email: 'u-1@acco.test',
          firstName: 'Amina',
          lastName: 'Yusuf',
          status: 'ACTIVE',
          organizationId: 'org-1',
        },
        {
          id: 'u-3',
          email: 'u-3@acco.test',
          firstName: 'Caasho',
          lastName: 'Nur',
          status: 'ACTIVE',
          organizationId: 'org-1',
        },
      ],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await openSelect(user, screen.getByLabelText('Name'));
    expect(screen.getByRole('option', { name: /Caasho Nur/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Amina Yusuf ·/ })).not.toBeInTheDocument();
  });

  it('says so when everyone in the organisation is already on the project', async () => {
    const user = userEvent.setup();
    usersMocks.useUsers.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    expect(screen.getByText(/already on this project/i)).toBeInTheDocument();
  });

  /** `@ArrayMinSize(1)`, and there is no endpoint to add a role afterwards. */
  it('will not submit without a role selected', async () => {
    const user = userEvent.setup();
    usersMocks.useUsers.mockReturnValue({
      data: [
        {
          id: 'u-3',
          email: 'u-3@acco.test',
          firstName: 'Caasho',
          lastName: 'Nur',
          status: 'ACTIVE',
          organizationId: 'org-1',
        },
      ],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    expect(screen.getByRole('button', { name: 'Add to project' })).toBeDisabled();
  });

  it('edit roles: offers only the assignable roles, not the deprecated ones', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    // ENGINEER (row 1) is not the last manager — open its role editor.
    await user.click(screen.getByRole('button', { name: 'Actions for Bashir Yusuf' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit roles' }));

    expect(screen.getByRole('button', { name: 'Project manager' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Site engineer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viewer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quantity surveyor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commercial manager' })).not.toBeInTheDocument();
  });

  it("edit roles: locks the Project Manager toggle for the project's last manager", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    // MANAGER (row 0) is the only project manager — its PM role cannot be dropped.
    await user.click(screen.getByRole('button', { name: 'Actions for Amina Yusuf' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit roles' }));

    expect(screen.getByRole('button', { name: 'Project manager' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Site engineer' })).toBeEnabled();
  });

  it('renders an empty team without error', () => {
    mocks.useProjectMembers.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<ProjectMembers projectId="p-1" />, {
      permissions: ['manage:project-member'],
    });

    expect(screen.getByText(/No members on this project/i)).toBeInTheDocument();
  });
});
