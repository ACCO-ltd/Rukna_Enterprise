'use client';

import { useId, useMemo, useState } from 'react';
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
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useToast,
} from '@erp/ui';

import type { UserWithRolesResponse } from '@erp/types';
import { PERMISSIONS, UserStatus } from '@erp/types';
import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { FilterSelect, TableToolbar } from '@/features/admin/components/table-toolbar';

import {
  useBulkUserStatus,
  useDeactivateUser,
  useReactivateUser,
  useUsers,
} from '../hooks/use-users';
import { bulkTargets, filterUsers, type UserStatusFilter } from '../filter-users';
import { UserStatusBadge } from './user-status-badge';
import { UserRolesCell } from './user-roles-cell';
import {
  CreateUserSheet,
  EditUserSheet,
  ManageRolesSheet,
  RegenerateTemporarySheet,
  SetPasswordSheet,
} from './user-form-sheets';

type ActiveSheet = 'edit' | 'password' | 'roles' | 'regenerate';

export function UsersList() {
  const t = useTranslations('platform.users');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can(PERMISSIONS.usersManage);
  const currentUserId = useSession().user?.id ?? null;
  const searchId = useId();

  const { data, isPending, isError, refetch, isFetching } = useUsers();

  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<UserWithRolesResponse | null>(null);
  const [sheet, setSheet] = useState<ActiveSheet | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkIntent, setBulkIntent] = useState<'deactivate' | 'reactivate' | null>(null);

  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const statusPending = deactivate.isPending || reactivate.isPending;
  const bulk = useBulkUserStatus();

  const rows = useMemo(
    () => filterUsers(data ?? [], query, statusFilter),
    [data, query, statusFilter],
  );

  // Selection is kept by id and reconciled against the current rows, so a filtered-out or
  // deleted row never lingers as a phantom selection driving the bulk bar.
  const selectedRows = useMemo(
    () => rows.filter((user) => selectedIds.has(user.id)),
    [rows, selectedIds],
  );
  const selectedCount = selectedRows.length;

  function openSheet(next: ActiveSheet, user: UserWithRolesResponse) {
    setTarget(user);
    setSheet(next);
  }

  function closeSheet() {
    setSheet(null);
    setTarget(null);
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const allSelected = rows.every((user) => prev.has(user.id));
      if (allSelected) return new Set();
      return new Set(rows.map((user) => user.id));
    });
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

  const bulkIds = bulkIntent
    ? bulkTargets(selectedRows, bulkIntent, currentUserId)
    : [];

  // Open the confirm only when the selection yields work. A selection of already-inactive
  // users (or only your own row for deactivate) has no eligible target — say so and stop,
  // rather than opening a dialog whose confirm does nothing.
  function requestBulk(intent: 'deactivate' | 'reactivate') {
    const ids = bulkTargets(selectedRows, intent, currentUserId);
    if (ids.length === 0) {
      toast({
        tone: 'error',
        title: t('select.noneEligible', {
          action:
            intent === 'deactivate' ? t('actions.deactivate') : t('actions.reactivate'),
        }),
      });
      return;
    }
    setBulkIntent(intent);
  }

  function runBulk() {
    if (!bulkIntent || bulkIds.length === 0) return;
    bulk.mutate(
      { ids: bulkIds, intent: bulkIntent },
      {
        onSuccess: (result) => {
          if (result.failed > 0) {
            toast({ tone: 'error', title: t('select.bulkFailed') });
          } else {
            toast({ tone: 'success', title: t('select.bulkDone', { count: result.succeeded }) });
          }
          setSelectedIds(new Set());
          setBulkIntent(null);
        },
      },
    );
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

  const allSelected = rows.length > 0 && rows.every((user) => selectedIds.has(user.id));
  const someSelected = selectedCount > 0 && !allSelected;
  const columnCount = 4 + (canManage ? 2 : 0);

  return (
    <div className="space-y-6">
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
        <>
          <TableToolbar
            searchId={searchId}
            searchValue={query}
            onSearchChange={setQuery}
            searchLabel={t('searchLabel')}
            searchPlaceholder={t('searchPlaceholder')}
          >
            <FilterSelect
              label={t('filterStatus')}
              value={statusFilter}
              onChange={(next) => setStatusFilter(next as UserStatusFilter)}
              options={[
                { value: 'ALL', label: t('filterAll') },
                { value: UserStatus.ACTIVE, label: t('status.ACTIVE') },
                { value: UserStatus.INACTIVE, label: t('status.INACTIVE') },
              ]}
            />
          </TableToolbar>

          {canManage && selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-panel border border-brand-primary/20 bg-brand-accent/50 px-4 py-2.5">
              <span className="text-sm font-medium tabular-nums text-foreground">
                {t('select.selectedCount', { count: selectedCount })}
              </span>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => requestBulk('reactivate')}
                >
                  {t('select.reactivate')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => requestBulk('deactivate')}
                >
                  {t('select.deactivate')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  {t('select.clear')}
                </Button>
              </div>
            </div>
          ) : null}

          <TableScroll aria-label={t('title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage ? (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label={t('select.allLabel')}
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-border-strong text-brand-primary focus-visible:shadow-ring"
                      />
                    </TableHead>
                  ) : null}
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
                {rows.length === 0 ? (
                  <TableEmpty colSpan={columnCount}>{t('noMatches')}</TableEmpty>
                ) : (
                  rows.map((user) => {
                    const isSelf = user.id === currentUserId;
                    const isActive = user.status === 'ACTIVE';
                    const checked = selectedIds.has(user.id);
                    return (
                      <TableRow key={user.id} className={checked ? 'bg-brand-accent/30' : undefined}>
                        {canManage ? (
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={t('select.rowLabel', {
                                name: `${user.firstName} ${user.lastName}`,
                              })}
                              checked={checked}
                              onChange={() => toggleRow(user.id)}
                              className="h-4 w-4 rounded border-border-strong text-brand-primary focus-visible:shadow-ring"
                            />
                          </TableCell>
                        ) : null}
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
                                    {isActive ? (
                                      <DropdownMenuItem onSelect={() => openSheet('regenerate', user)}>
                                        {t('actions.regenerateTemporary')}
                                      </DropdownMenuItem>
                                    ) : null}
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
                  })
                )}
              </TableBody>
            </Table>
          </TableScroll>
        </>
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
          <RegenerateTemporarySheet
            user={sheet === 'regenerate' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
          <ManageRolesSheet
            user={sheet === 'roles' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
          />
          {bulkIntent ? (
            <ConfirmActionDialog
              title={
                bulkIntent === 'deactivate'
                  ? t('select.deactivateTitle', { count: bulkIds.length })
                  : t('select.reactivateTitle', { count: bulkIds.length })
              }
              description={
                bulkIntent === 'deactivate'
                  ? t('select.deactivateBody')
                  : t('select.reactivateBody')
              }
              confirmLabel={
                bulkIntent === 'deactivate'
                  ? t('select.confirmDeactivate')
                  : t('select.confirmReactivate')
              }
              isPending={bulk.isPending}
              errorMessage={
                bulk.error instanceof ApiError ? bulk.error.message : undefined
              }
              onConfirm={runBulk}
              onDismiss={() => {
                setBulkIntent(null);
                bulk.reset();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
