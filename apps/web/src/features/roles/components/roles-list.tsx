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
} from '@erp/ui';

import type { RoleSummary } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { usePermissions } from '@/features/auth/permissions/can';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';

import { useDeleteRole, useRoles } from '../hooks/use-roles';
import {
  CreateRoleSheet,
  EditRoleSheet,
  ManagePermissionsSheet,
} from './role-form-sheets';

type ActiveSheet = 'edit' | 'permissions';

export function RolesList() {
  const t = useTranslations('platform.roles');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can(PERMISSIONS.rolesManage);

  const { data, isPending, isError, refetch, isFetching } = useRoles();

  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<RoleSummary | null>(null);
  const [sheet, setSheet] = useState<ActiveSheet | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  const remove = useDeleteRole();

  function openSheet(next: ActiveSheet, role: RoleSummary) {
    setTarget(role);
    setSheet(next);
  }

  function closeSheet() {
    setSheet(null);
    setTarget(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ tone: 'success', title: t('toast.deleted', { name: deleteTarget.name }) });
        setDeleteTarget(null);
        remove.reset();
      },
      // Error stays on the dialog (409 in-use / ADMIN) via deleteError below.
    });
  }

  const deleteError =
    remove.error instanceof ApiError
      ? remove.error.message
      : remove.error
        ? t('deleteFailed')
        : undefined;

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
            {t('addRole')}
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
                <TableHead>{t('colDescription')}</TableHead>
                <TableHead className="text-end">{t('colPermissions')}</TableHead>
                <TableHead className="text-end">{t('colMembers')}</TableHead>
                {canManage ? (
                  <TableHead className="text-end">{t('colActions')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {role.description ?? (
                      <span className="text-muted-foreground/60">{t('noDescription')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {role.permissionCount}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {role.memberCount}
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
                                aria-label={t('rowMenuLabel', { name: role.name })}
                              >
                                <OverflowGlyph />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openSheet('edit', role)}>
                                {t('actions.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => openSheet('permissions', role)}>
                                {t('actions.managePermissions')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                destructive
                                onSelect={() => {
                                  remove.reset();
                                  setDeleteTarget(role);
                                }}
                              >
                                {t('actions.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {canManage ? (
        <>
          <CreateRoleSheet open={createOpen} onOpenChange={setCreateOpen} />
          <EditRoleSheet
            role={sheet === 'edit' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
          <ManagePermissionsSheet
            role={sheet === 'permissions' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
          {deleteTarget ? (
            <ConfirmActionDialog
              title={t('deleteTitle', { name: deleteTarget.name })}
              description={t('deleteBody')}
              confirmLabel={t('actions.delete')}
              isPending={remove.isPending}
              errorMessage={deleteError}
              onConfirm={confirmDelete}
              onDismiss={() => {
                setDeleteTarget(null);
                remove.reset();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
