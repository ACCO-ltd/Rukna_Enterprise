'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  OverflowGlyph,
  RowActions,
  useToast,
} from '@erp/ui';
import { Plus, Users } from 'lucide-react';

import type { SavedViewState, UserWithRolesResponse } from '@erp/types';
import { PERMISSIONS, UserStatus } from '@erp/types';
import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ListPageHeader } from '@/components/layout/list-page-header';
import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { ApiError } from '@/lib/api-client';

import {
  useBulkUserStatus,
  useDeactivateUser,
  useReactivateUser,
  useUsers,
} from '../hooks/use-users';
import { bulkTargets } from '../filter-users';
import { UserStatusBadge } from './user-status-badge';
import { UserRolesCell } from './user-roles-cell';
import {
  CreateUserDialog,
  EditUserDialog,
  ManageRolesDialog,
  RegenerateTemporaryDialog,
  SetPasswordDialog,
} from './user-form-dialogs';

type ActiveDialog = 'edit' | 'password' | 'roles' | 'regenerate';

const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };
const fullName = (user: UserWithRolesResponse) => `${user.firstName} ${user.lastName}`;

/** Whether a user passes the list's filters. */
export function userMatchesFilters(user: UserWithRolesResponse, filters: FilterValues): boolean {
  if (filters.status && user.status !== filters.status) return false;
  if (filters.role && !user.roles.some((role) => role.id === filters.role)) return false;
  return true;
}

/**
 * Administration → Users (ADR-047 list page): title block, views, the shared Filter panel,
 * selection with bulk (de)activate, and export. The whole list is fetched (a few hundred rows
 * at most), so search and filters run in the browser.
 */
export function UsersList() {
  const t = useTranslations('platform.users');
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can(PERMISSIONS.usersManage);
  const currentUserId = useSession().user?.id ?? null;

  const { data, isPending, isError, refetch } = useUsers();

  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<UserWithRolesResponse | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);

  const view = useListViewState(DEFAULT_SORT);
  const { filters } = view;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkIntent, setBulkIntent] = useState<'deactivate' | 'reactivate' | null>(null);

  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const statusPending = deactivate.isPending || reactivate.isPending;
  const bulk = useBulkUserStatus();

  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => all.filter((user) => userMatchesFilters(user, filters)),
    [all, filters],
  );

  // Selection is kept by id and reconciled against the current rows, so a filtered-out or
  // deleted row never lingers as a phantom selection driving the bulk bar.
  const selectedRows = useMemo(
    () => rows.filter((user) => selectedIds.has(user.id)),
    [rows, selectedIds],
  );

  function openDialog(next: ActiveDialog, user: UserWithRolesResponse) {
    setTarget(user);
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    setTarget(null);
  }

  function toggleStatus(user: UserWithRolesResponse) {
    const isActive = user.status === 'ACTIVE';
    const mutation = isActive ? deactivate : reactivate;
    // Success is confirmed by the mutation's own feedback (`use-users.ts`).
    mutation.mutate(user.id, {
      onError: (error) => {
        toast({
          tone: 'error',
          title: t('toast.statusFailed'),
          description: error instanceof ApiError ? error.message : undefined,
        });
      },
    });
  }

  const bulkIds = bulkIntent ? bulkTargets(selectedRows, bulkIntent, currentUserId) : [];

  // Open the confirm only when the selection yields work. A selection of already-inactive
  // users (or only your own row for deactivate) has no eligible target — say so and stop,
  // rather than opening a dialog whose confirm does nothing.
  function requestBulk(intent: 'deactivate' | 'reactivate') {
    const ids = bulkTargets(selectedRows, intent, currentUserId);
    if (ids.length === 0) {
      toast({
        tone: 'error',
        title: t('select.noneEligible', {
          action: intent === 'deactivate' ? t('actions.deactivate') : t('actions.reactivate'),
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

  const columns: GridColumn<UserWithRolesResponse>[] = [
    {
      key: 'name',
      header: t('colName'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (user) => `${fullName(user)} ${user.email}`,
      exportValue: (user) => fullName(user),
      render: (user) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={fullName(user)} size="sm" />
          <span className="min-w-0">
            <span className="block max-w-[16rem] truncate font-medium text-foreground">
              {fullName(user)}
              {user.id === currentUserId ? (
                <span className="ms-2 text-caption font-normal text-muted-foreground">
                  {t('you')}
                </span>
              ) : null}
            </span>
            <span className="block max-w-[16rem] truncate text-caption text-muted-foreground">
              {user.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'email',
      header: t('colEmail'),
      sortable: true,
      defaultVisible: false,
      plainValue: (user) => user.email,
      render: (user) => <span className="text-muted-foreground">{user.email}</span>,
    },
    {
      key: 'roles',
      header: t('colRoles'),
      card: 'subtitle',
      plainValue: (user) => user.roles.map((role) => role.name).join(', '),
      render: (user) => <UserRolesCell roles={user.roles} />,
    },
    {
      key: 'status',
      header: t('colStatus'),
      card: 'status',
      plainValue: (user) => t(`status.${user.status}`),
      render: (user) => <UserStatusBadge status={user.status} />,
    },
  ];

  // Role options are the roles someone holds — never an option that can only empty the list.
  const roleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const user of all)
      for (const role of user.roles) if (!seen.has(role.id)) seen.set(role.id, role.name);
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [all]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterStatus'),
      options: [UserStatus.ACTIVE, UserStatus.INACTIVE].map((value) => ({
        value,
        label: t(`status.${value}`),
      })),
    },
    { key: 'role', type: 'select', label: t('colRoles'), options: roleOptions },
  ];

  const countFor = (state: SavedViewState): number =>
    searchRows(
      all.filter((user) => userMatchesFilters(user, state.filters ?? {})),
      state.search ?? '',
      columns,
    ).length;
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'active',
      label: t('views.active'),
      state: { filters: { status: UserStatus.ACTIVE }, sort: DEFAULT_SORT },
    },
    {
      id: 'inactive',
      label: t('views.inactive'),
      state: { filters: { status: UserStatus.INACTIVE }, sort: DEFAULT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const activeCount = all.filter((user) => user.status === UserStatus.ACTIVE).length;
  const headerSummary =
    all.length === 0 ? undefined : t('headerSummary', { count: all.length, active: activeCount });

  const createAction = canManage ? (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden="true" />
      {t('addUser')}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={headerSummary ?? t('subtitle')}
        actions={createAction}
      />
      <PlatformDataGrid
        columns={columns}
        data={rows}
        rowKey={(user) => user.id}
        label={t('title')}
        isLoading={isPending}
        isError={isError}
        onRetry={() => void refetch()}
        errorMessage={t('loadFailed')}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        columnVisibility
        listState={view.listState}
        savedViews={
          <ListViewsBar
            listKey="users"
            builtIns={builtIns}
            current={view.current}
            onApply={view.applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        groupOptions={[
          {
            key: 'status',
            label: t('colStatus'),
            groupOf: (user) => ({ id: user.status, label: t(`status.${user.status}`) }),
          },
        ]}
        exportAs={{ fileName: 'users', sheetName: t('title') }}
        shortcuts={{ onNew: canManage ? () => setCreateOpen(true) : undefined }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
        emptyState={
          all.length === 0 ? (
            <EmptyState
              icon={<Users size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction}
            />
          ) : undefined
        }
        selectionRowLabel={fullName}
        selection={
          canManage
            ? {
                selected: new Set(selectedRows.map((user) => user.id)),
                onSelect: (id, checked) =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  }),
                onSelectAll: (checked) =>
                  setSelectedIds(checked ? new Set(rows.map((user) => user.id)) : new Set()),
                actions: (
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
                ),
              }
            : undefined
        }
        rowActions={
          canManage
            ? (user) => {
                const isSelf = user.id === currentUserId;
                const isActive = user.status === 'ACTIVE';
                return (
                  <RowActions
                    overflow={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('rowMenuLabel', { name: fullName(user) })}
                          >
                            <OverflowGlyph />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openDialog('edit', user)}>
                            {t('actions.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openDialog('password', user)}>
                            {t('actions.setPassword')}
                          </DropdownMenuItem>
                          {isActive ? (
                            <DropdownMenuItem onSelect={() => openDialog('regenerate', user)}>
                              {t('actions.regenerateTemporary')}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => openDialog('roles', user)}>
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
                );
              }
            : undefined
        }
      />

      {canManage ? (
        <>
          <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
          <EditUserDialog
            user={dialog === 'edit' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          />
          <SetPasswordDialog
            user={dialog === 'password' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          />
          <RegenerateTemporaryDialog
            user={dialog === 'regenerate' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          />
          <ManageRolesDialog
            user={dialog === 'roles' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
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
              errorMessage={bulk.error instanceof ApiError ? bulk.error.message : undefined}
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
