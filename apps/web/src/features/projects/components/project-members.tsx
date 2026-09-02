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
import { Plus, UsersThree } from '@phosphor-icons/react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
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
  useSetProjectMemberRoles,
} from '../hooks/use-project-members';
import {
  ASSIGNABLE_PROJECT_ROLES,
  addableUsers,
  isAssignableRole,
  isLastProjectManager,
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
  const setRoles = useSetProjectMemberRoles(projectId);
  const { user } = useSession();

  const [pending, setPending] = useState<ProjectMember | null>(null);
  const [editing, setEditing] = useState<ProjectMember | null>(null);

  const rawRows = members.data ?? [];
  // Project managers appear first; all other members follow in their original order.
  const rows = [...rawRows].sort((a, b) => {
    const aIsPm = memberRoles(a).includes(ProjectRole.PROJECT_MANAGER);
    const bIsPm = memberRoles(b).includes(ProjectRole.PROJECT_MANAGER);
    if (aIsPm && !bIsPm) return -1;
    if (!aIsPm && bIsPm) return 1;
    return 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-panel)]">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary"><UsersThree size={18} weight="duotone" aria-hidden="true" /></span>
            {t('title')}
          </h2>
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
          <TableScroll aria-label={t('title')} className="rounded-xl border-border shadow-[var(--shadow-panel)]">
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
                          <div className="flex flex-wrap items-center gap-2">
                            {memberName(member)}
                            {memberRoles(member).includes(ProjectRole.PROJECT_MANAGER) ? (
                              <Badge tone="info">{t('role.PROJECT_MANAGER')}</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <bdi>{member.user.email}</bdi>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {memberRoles(member).length === 0 ? (
                            t('noRoles')
                          ) : (
                            <span className="inline-flex flex-wrap items-center">
                              {memberRoles(member).map((role, index) => (
                                <span key={role} className="inline-flex items-center">
                                  {index > 0 ? (
                                    <span className="mx-1.5 text-muted-foreground/40" aria-hidden="true">
                                      ·
                                    </span>
                                  ) : null}
                                  <span
                                    className={isAssignableRole(role) ? undefined : 'italic text-muted-foreground/70'}
                                    title={isAssignableRole(role) ? undefined : t('roleDeprecated')}
                                  >
                                    {t(`role.${role}`)}
                                  </span>
                                </span>
                              ))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-4">
                            <button
                              type="button"
                              onClick={() => setEditing(member)}
                              className="min-h-11 text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
                            >
                              {t('editRoles')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPending(member)}
                              disabled={blocked !== null}
                              title={blocked ? t(`removeBlocked.${blocked}`) : undefined}
                              className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                            >
                              {t('remove')}
                            </button>
                          </div>
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

      {editing ? (
        <EditRolesDialog
          member={editing}
          lastManager={isLastProjectManager(editing, rows)}
          isPending={setRoles.isPending}
          errorMessage={setRoles.error instanceof ApiError ? setRoles.error.message : undefined}
          onSave={(roles) =>
            setRoles.mutate(
              { userId: editing.userId, roles },
              { onSuccess: () => setEditing(null) },
            )
          }
          onDismiss={() => {
            if (!setRoles.isPending) setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Edit roles ────────────────────────────────────────────────────────────────────

/**
 * Corrects a member's roles without the remove/re-add churn (PATCH …/roles). Offers the
 * assignable roles pre-selected from what the member already holds; a legacy role they carry is
 * simply not re-offered, so saving replaces it with a current one.
 *
 * When the member is the project's only project manager, the Project Manager toggle is locked
 * on — the same rule the remove flow enforces, so an edit cannot leave a project no one can
 * administer.
 */
function EditRolesDialog({
  member,
  lastManager,
  isPending,
  errorMessage,
  onSave,
  onDismiss,
}: {
  member: ProjectMember;
  lastManager: boolean;
  isPending: boolean;
  errorMessage: string | undefined;
  onSave: (roles: ProjectRole[]) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('platform.projects.members');

  const [roles, setRolesState] = useState<ProjectRole[]>(() =>
    memberRoles(member).filter(isAssignableRole),
  );

  const preventWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

  function toggle(role: ProjectRole) {
    // The last manager cannot drop PROJECT_MANAGER.
    if (lastManager && role === ProjectRole.PROJECT_MANAGER) return;
    setRolesState((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  const effective =
    lastManager && !roles.includes(ProjectRole.PROJECT_MANAGER)
      ? [ProjectRole.PROJECT_MANAGER, ...roles]
      : roles;
  const canSave = effective.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isPending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventWhilePending}
        onPointerDownOutside={preventWhilePending}
        onInteractOutside={preventWhilePending}
      >
        <DialogTitle>{t('editRolesTitle', { name: memberName(member) })}</DialogTitle>
        <DialogDescription>{t('editRolesHint')}</DialogDescription>

        {errorMessage ? (
          <div className="mt-4">
            <Alert variant="error" messages={[errorMessage]} />
          </div>
        ) : null}

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">{t('colRoles')}</legend>
          <div className="flex flex-wrap gap-2">
            {ASSIGNABLE_PROJECT_ROLES.map((role) => {
              const selected = effective.includes(role);
              const locked = lastManager && role === ProjectRole.PROJECT_MANAGER;
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(role)}
                  disabled={locked}
                  title={locked ? t('lastManagerLocked') : undefined}
                  className={
                    selected
                      ? 'min-h-11 rounded-control border border-brand-primary bg-brand-primary px-3 text-sm font-medium text-white disabled:opacity-70'
                      : 'min-h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground'
                  }
                >
                  {t(`role.${role}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <DialogFooter>
          <Button onClick={() => onSave(effective)} disabled={!canSave || isPending}>
            {t('save')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={isPending}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-panel)]">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{t('addTitle')}</h3>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{t('addHint')}</p>
      </div>

      <div className="max-w-md space-y-1.5">
        <label htmlFor={ids.user} className="block text-xs font-medium text-muted-foreground">
          {t('colName')}
        </label>
        <Select
          id={ids.user}
          value={userId}
          onChange={(value) => setUserId(value)}
        >
          <option value="" disabled>
            —
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {userName(candidate)} · {candidate.email}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{t('colRoles')}</legend>
        <div className="flex flex-wrap gap-2">
          {ASSIGNABLE_PROJECT_ROLES.map((role) => {
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

      <Button type="button" className="gap-2" onClick={handleAdd} disabled={!complete || add.isPending}>
        <Plus size={16} aria-hidden="true" />
        {t('add')}
      </Button>
    </section>
  );
}
