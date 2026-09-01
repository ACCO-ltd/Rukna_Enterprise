'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowGlyph,
  RowActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useToast,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@erp/ui';

import type { UserWithRolesResponse } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';

import { useDeactivateUser, useReactivateUser, useRegenerateTemporaryPassword, useUsers } from '../hooks/use-users';
import { UserStatusBadge } from './user-status-badge';
import { UserRolesCell } from './user-roles-cell';
import {
  CreateUserSheet,
  EditUserSheet,
  ManageRolesSheet,
  SetPasswordSheet,
} from './user-form-sheets';

type ActiveSheet = 'edit' | 'password' | 'roles';

export function UsersList() {
  const t = useTranslations('platform.users');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can(PERMISSIONS.usersManage);
  const currentUserId = useSession().user?.id ?? null;

  const { data, isPending, isError, refetch, isFetching } = useUsers();

  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<UserWithRolesResponse | null>(null);
  const [sheet, setSheet] = useState<ActiveSheet | null>(null);
  const [credentialTarget, setCredentialTarget] = useState<UserWithRolesResponse | null>(null);

  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const statusPending = deactivate.isPending || reactivate.isPending;
  const regenerate = useRegenerateTemporaryPassword();

  function openSheet(next: ActiveSheet, user: UserWithRolesResponse) {
    setTarget(user);
    setSheet(next);
  }

  function closeSheet() {
    setSheet(null);
    setTarget(null);
  }

  function toggleStatus(user: UserWithRolesResponse) {
    const isActive = user.status === 'ACTIVE';
    const mutation = isActive ? deactivate : reactivate;
    mutation.mutate(user.id, {
      onSuccess: () => {
        toast({
          tone: 'success',
          title: isActive
            ? t('toast.deactivated', { name: `${user.firstName} ${user.lastName}` })
            : t('toast.reactivated', { name: `${user.firstName} ${user.lastName}` }),
        });
      },
      onError: (error) => {
        toast({
          tone: 'error',
          title: t('toast.statusFailed'),
          description: error instanceof ApiError ? error.message : undefined,
        });
      },
    });
  }

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('addUser')}
          </Button>
        </div>
      ) : null}

      {data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colEmail')}</TableHead>
                <TableHead>{t('colRoles')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                {canManage ? (
                  <TableHead className="text-end">{t('colActions')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((user) => {
                const isSelf = user.id === currentUserId;
                const isActive = user.status === 'ACTIVE';
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.firstName} {user.lastName}
                      {isSelf ? (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          {t('you')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <UserRolesCell roles={user.roles} />
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={user.status} />
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-end">
                        <RowActions
                          overflow={
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t('rowMenuLabel', {
                                    name: `${user.firstName} ${user.lastName}`,
                                  })}
                                >
                                  <OverflowGlyph />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => openSheet('edit', user)}>
                                  {t('actions.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => openSheet('password', user)}>
                                  {t('actions.setPassword')}
                                </DropdownMenuItem>
                                {isActive ? <DropdownMenuItem onSelect={() => { regenerate.reset(); setCredentialTarget(user); }}>
                                  {t('actions.regenerateTemporary')}
                                </DropdownMenuItem> : null}
                                <DropdownMenuItem onSelect={() => openSheet('roles', user)}>
                                  {t('actions.manageRoles')}
                                </DropdownMenuItem>
                                {isActive ? (
                                  // The backend rejects self-deactivation (400); the action is
                                  // withheld from the own row rather than offered and refused.
                                  isSelf ? null : (
                                    <DropdownMenuItem
                                      destructive
                                      disabled={statusPending}
                                      onSelect={() => toggleStatus(user)}
                                    >
                                      {t('actions.deactivate')}
                                    </DropdownMenuItem>
                                  )
                                ) : (
                                  <DropdownMenuItem
                                    disabled={statusPending}
                                    onSelect={() => toggleStatus(user)}
                                  >
                                    {t('actions.reactivate')}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          }
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {canManage ? (
        <>
          <CreateUserSheet open={createOpen} onOpenChange={setCreateOpen} />
          <EditUserSheet
            user={sheet === 'edit' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
          <SetPasswordSheet
            user={sheet === 'password' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
            onSuccess={() => {
              toast({ tone: 'success', title: t('toast.passwordSet') });
            }}
          />
          <Sheet open={Boolean(credentialTarget)} onOpenChange={(open) => { if (!open) { setCredentialTarget(null); regenerate.reset(); } }}>
            <SheetContent className="p-6"><SheetTitle>{t('form.regenerateTitle')}</SheetTitle><SheetDescription className="mt-1">{t('form.regenerateHint')}</SheetDescription>
              {regenerate.data ? <div className="mt-5 space-y-3 rounded-panel border border-border bg-surface p-4"><p className="font-mono text-sm break-all">{regenerate.data.temporaryPassword}</p><p className="text-sm text-muted-foreground">{t('form.expiresAt')}: {new Date(regenerate.data.expiresAt).toLocaleString()}</p></div> : <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setCredentialTarget(null)}>{tCommon('cancel')}</Button><Button disabled={regenerate.isPending} onClick={() => credentialTarget && regenerate.mutate(credentialTarget.id)}>{regenerate.isPending ? t('form.regenerating') : t('actions.regenerateTemporary')}</Button></div>}
            </SheetContent>
          </Sheet>
          <ManageRolesSheet
            user={sheet === 'roles' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
