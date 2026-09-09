'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProjectRole } from '@erp/types';
import { DotsThree, Plus } from '@phosphor-icons/react';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { usePermissions } from '@/features/auth/permissions/can';
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
  const { can } = usePermissions();
  const [adding, setAdding] = useState(false);

  const [pending, setPending] = useState<ProjectMember | null>(null);
  const [editing, setEditing] = useState<ProjectMember | null>(null);

  const rawRows = members.data ?? [];
  const canManage =
    can('manage:project-member') && Boolean(members.data) && !members.isError;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" />
            {t('addTitle')}
          </Button>
        ) : null}
      </div>

      {members.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-48 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : members.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <>
          <TableScroll aria-label={t('title')} className="rounded-panel border-border">
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
                                    <span
                                      className="mx-1.5 text-muted-foreground/40"
                                      aria-hidden="true"
                                    >
                                      ·
                                    </span>
                                  ) : null}
                                  <span
                                    className={
                                      isAssignableRole(role)
                                        ? undefined
                                        : 'italic text-muted-foreground/70'
                                    }
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
                          {canManage ? (
                            <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t('memberActions', { name: memberName(member) })}
                                  >
                                    <DotsThree size={20} aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => setEditing(member)}>
                                    {t('editRoles')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    destructive
                                    disabled={blocked !== null}
                                    title={blocked ? t(`removeBlocked.${blocked}`) : undefined}
                                    onSelect={() => setPending(member)}
                                  >
                                    {t('remove')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableScroll>

          {adding && canManage ? (
            <AddMemberForm
              projectId={projectId}
              members={rows}
              onDismiss={() => setAdding(false)}
            />
          ) : null}
        </>
      )}

      {pending ? (
        <ConfirmActionDialog
          title={t('removeTitle', { name: memberName(pending) })}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          isPending={remove.isPending}
          errorMessage={remove.error instanceof ApiError ? remove.error.message : undefined}
          onConfirm={() => remove.mutate(pending.userId, { onSuccess: () => setPending(null) })}
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
                  disabled={locked || isPending}
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
  onDismiss,
}: {
  projectId: string;
  members: readonly ProjectMember[];
  onDismiss: () => void;
}) {
  const t = useTranslations('platform.projects.members');

  const users = useUsers();
  const add = useAddProjectMember(projectId);

  const [userId, setUserId] = useState('');
  const [roles, setRoles] = useState<ProjectRole[]>([]);

  const ids = { user: useId() };

  const candidates = useMemo(() => addableUsers(users.data ?? [], members), [users.data, members]);

  const serverError = add.error instanceof ApiError ? add.error.message : null;
  // `@ArrayMinSize(1)` — a member cannot be added without a role, and there is no endpoint
  // to give them one afterwards.
  const complete = Boolean(userId) && roles.length > 0;

  function toggle(role: ProjectRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function handleAdd() {
    if (!complete || add.isPending) return;
    add.mutate(
      { userId, roles },
      {
        onSuccess: () => {
          setUserId('');
          setRoles([]);
          onDismiss();
        },
      },
    );
  }

  const preventPending = (event: Event) => {
    if (add.isPending) event.preventDefault();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !add.isPending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventPending}
        onPointerDownOutside={preventPending}
        onInteractOutside={preventPending}
      >
        <DialogTitle>{t('addTitle')}</DialogTitle>
        <DialogDescription>{t('addHint')}</DialogDescription>
        {users.isError ? <Alert variant="error" messages={[t('usersLoadFailed')]} /> : null}
        {!users.isPending && !users.isError && candidates.length === 0 ? (
          <Alert variant="info" messages={[t('everyoneAdded')]} />
        ) : null}
        <div className="mt-4 space-y-4">
          <div className="max-w-md space-y-1.5">
            <label htmlFor={ids.user} className="block text-xs font-medium text-muted-foreground">
              {t('colName')}
            </label>
            <Select
              disabled={users.isPending || users.isError || add.isPending}
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
                    disabled={add.isPending}
                    aria-pressed={selected}
                    onClick={() => toggle(role)}
                    className={
                      selected
                        ? 'min-h-11 rounded-control border border-brand-primary bg-brand-primary px-3 text-sm font-medium text-white'
                        : 'min-h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground'
                    }
                  >
                    {t(`role.${role}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss} disabled={add.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            className="gap-2"
            onClick={handleAdd}
            disabled={!complete || add.isPending || users.isError || users.isPending}
          >
            <Plus size={16} aria-hidden="true" />
            {t('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
