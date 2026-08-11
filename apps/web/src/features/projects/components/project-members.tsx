'use client';

/**
 * The project team (`/projects/:id/members`).
 *
 * This page was a dashed "not available yet" placeholder from Sprint 2 until now, on the
 * strength of B1 and B2 — no project could be given a first member, and no endpoint listed
 * users. Both were fixed in `e85bab9`, and the placeholder outlived them by a week because
 * the register still said they were open. It was the 2026-08-11 sweep that noticed.
 *
 * Three endpoints back it, and all three carry constraints worth knowing before reading the
 * markup:
 *
 *  - **Only a member can change the membership.** `assertMember` guards add and remove, so an
 *    organisation administrator who is not on the project gets a 403. B1's fix auto-enrols the
 *    creator as PROJECT_MANAGER, which is what stops that being a deadlock.
 *  - **Roles are set once.** There is no endpoint that changes a member's roles; correcting
 *    one means removing the member and adding them back.
 *  - **Removal is unguarded.** Nothing stops the last project manager being removed, and
 *    because adding requires membership, that can leave a project nobody can administer.
 *    `removeBlockReason` refuses it here.
 */

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProjectRole } from '@erp/types';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useSession } from '@/features/auth/session/use-session';
import { useUsers } from '@/features/users/hooks/use-users';
import { ApiError } from '@/lib/api-client';

import {
  useAddProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
} from '../hooks/use-project-members';
import {
  PROJECT_ROLE_ORDER,
  addableUsers,
  memberName,
  memberRoles,
  removeBlockReason,
  userName,
} from '../members';
import type { ProjectMember } from '../types';

export function ProjectMembers({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.projects.members');
  const tCommon = useTranslations('common');

  const members = useProjectMembers(projectId);
  const remove = useRemoveProjectMember(projectId);
  const { user } = useSession();

  const [pending, setPending] = useState<ProjectMember | null>(null);

  const rows = members.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Alert variant="info" messages={[t('membershipNotice')]} />

      {members.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-48 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : members.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <>
          <TableScroll aria-label={t('title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colEmail')}</TableHead>
                  <TableHead>{t('colRoles')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('colActions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={4}>{t('empty')}</TableEmpty>
                ) : (
                  rows.map((member) => {
                    const blocked = removeBlockReason(member, rows, user?.id ?? null);
                    return (
                      <TableRow key={member.id}>
                        <TableCell className="text-sm text-foreground">
                          {memberName(member)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <bdi>{member.user.email}</bdi>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {memberRoles(member)
                            .map((role) => t(`role.${role}`))
                            .join(' · ') || t('noRoles')}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setPending(member)}
                            disabled={blocked !== null}
                            title={blocked ? t(`removeBlocked.${blocked}`) : undefined}
                            className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                          >
                            {t('remove')}
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableScroll>

          <AddMemberForm projectId={projectId} members={rows} />
        </>
      )}

      {pending ? (
        <ConfirmActionDialog
          title={t('removeTitle', { name: memberName(pending) })}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          isPending={remove.isPending}
          errorMessage={
            remove.error instanceof ApiError ? remove.error.message : undefined
          }
          onConfirm={() =>
            remove.mutate(pending.userId, { onSuccess: () => setPending(null) })
          }
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Add ─────────────────────────────────────────────────────────────────────────

function AddMemberForm({
  projectId,
  members,
}: {
  projectId: string;
  members: readonly ProjectMember[];
}) {
  const t = useTranslations('platform.projects.members');

  const users = useUsers();
  const add = useAddProjectMember(projectId);

  const [userId, setUserId] = useState('');
  const [roles, setRoles] = useState<ProjectRole[]>([]);

  const ids = { user: useId() };

  const candidates = useMemo(
    () => addableUsers(users.data ?? [], members),
    [users.data, members],
  );

  const serverError = add.error instanceof ApiError ? add.error.message : null;
  // `@ArrayMinSize(1)` — a member cannot be added without a role, and there is no endpoint
  // to give them one afterwards.
  const complete = Boolean(userId) && roles.length > 0;

  function toggle(role: ProjectRole) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function handleAdd() {
    if (!complete) return;
    add.mutate(
      { userId, roles },
      {
        onSuccess: () => {
          setUserId('');
          setRoles([]);
        },
      },
    );
  }

  if (users.isError) {
    return <Alert variant="error" messages={[t('usersLoadFailed')]} />;
  }

  if (!users.isPending && candidates.length === 0) {
    return <Alert variant="info" messages={[t('everyoneAdded')]} />;
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{t('addTitle')}</h3>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{t('addHint')}</p>
      </div>

      <div className="max-w-md space-y-1.5">
        <label htmlFor={ids.user} className="block text-xs font-medium text-muted-foreground">
          {t('colName')}
        </label>
        <select
          id={ids.user}
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="" disabled>
            —
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {userName(candidate)} · {candidate.email}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{t('colRoles')}</legend>
        <div className="flex flex-wrap gap-2">
          {PROJECT_ROLE_ORDER.map((role) => {
            const selected = roles.includes(role);
            return (
              <button
                key={role}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(role)}
                className={
                  selected
                    ? 'min-h-11 rounded-md border border-brand-primary bg-brand-primary px-3 text-sm font-medium text-white'
                    : 'min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-foreground'
                }
              >
                {t(`role.${role}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <Button type="button" onClick={handleAdd} disabled={!complete || add.isPending}>
        {t('add')}
      </Button>
    </section>
  );
}
