'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
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
} from '@erp/ui';
import { Plus, ShieldCheck } from 'lucide-react';

import type { RoleSummary, SavedViewState } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { usePermissions } from '@/features/auth/permissions/can';
import { useUsers } from '@/features/users/hooks/use-users';
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

import { useDeleteRole, useRoles } from '../hooks/use-roles';
import { CreateRoleDialog, EditRoleDialog, ManagePermissionsDialog } from './role-form-dialogs';
import { RoleGovernanceDialog } from './role-governance-dialog';

type ActiveDialog = 'edit' | 'permissions' | 'governance';

const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };

/** Whether a role passes the list's filters. */
export function roleMatchesFilters(role: RoleSummary, filters: FilterValues): boolean {
  if (filters.kind && role.kind !== filters.kind) return false;
  if (filters.members === 'none' && role.memberCount > 0) return false;
  return true;
}

/**
 * Administration → Roles (ADR-047 list page). There is deliberately no bulk selection on roles:
 * deletion is a single, consequence-heavy act. SYSTEM roles are protected — review only.
 */
export function RolesList() {
  const t = useTranslations('platform.roles');
  const { can } = usePermissions();
  const canManage = can(PERMISSIONS.rolesManage);

  const { data, isPending, isError, refetch } = useRoles();
  const users = useUsers();

  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<RoleSummary | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  const view = useListViewState(DEFAULT_SORT);
  const { filters } = view;
  const remove = useDeleteRole();

  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => all.filter((role) => roleMatchesFilters(role, filters)),
    [all, filters],
  );
  const ownerEmail = (role: RoleSummary) =>
    users.data?.find((u) => u.id === role.ownerUserId)?.email ?? t('unassigned');
  // The template is named, never shown as an id.
  const templateName = (role: RoleSummary) =>
    role.templateRoleId ? (all.find((r) => r.id === role.templateRoleId)?.name ?? null) : null;

  function openDialog(next: ActiveDialog, role: RoleSummary) {
    setTarget(role);
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    setTarget(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget, {
      onSuccess: () => {
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

  const columns: GridColumn<RoleSummary>[] = [
    {
      key: 'name',
      header: t('colName'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (role) => `${role.name} ${role.purpose ?? role.description ?? ''}`,
      exportValue: (role) => role.name,
      render: (role) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{role.name}</span>
          <Badge tone="neutral">{role.kind === 'SYSTEM' ? t('systemRole') : t('customRole')}</Badge>
        </span>
      ),
    },
    {
      key: 'governance',
      header: t('colGovernance'),
      card: 'subtitle',
      plainValue: (role) => role.purpose ?? role.description ?? '',
      exportValue: (role) => [role.purpose ?? role.description ?? '', ownerEmail(role)].join(' · '),
      render: (role) => (
        <span className="block text-muted-foreground">
          <span className="block max-w-[28rem]">
            {role.purpose ?? role.description ?? t('noDescription')}
          </span>
          <span className="mt-1 block text-caption">
            {t('ownerLabel')}: {ownerEmail(role)}
          </span>
          {templateName(role) ? (
            <span className="block text-caption">
              {t('templateLabel')}: {templateName(role)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'permissions',
      header: t('colPermissions'),
      numeric: true,
      sortable: true,
      plainValue: (role) => role.permissionCount,
      render: (role) => (
        <span className="tabular-nums text-muted-foreground">{role.permissionCount}</span>
      ),
    },
    {
      key: 'members',
      header: t('colMembers'),
      numeric: true,
      sortable: true,
      card: 'meta',
      plainValue: (role) => role.memberCount,
      render: (role) => (
        <span className="tabular-nums text-muted-foreground">{role.memberCount}</span>
      ),
    },
  ];

  const filterFields: ListFilterField[] = [
    {
      key: 'kind',
      type: 'select',
      label: t('filterKind'),
      options: [
        { value: 'SYSTEM', label: t('filterSystem') },
        { value: 'CUSTOM', label: t('filterCustom') },
      ],
    },
    {
      key: 'members',
      type: 'select',
      label: t('colMembers'),
      options: [{ value: 'none', label: t('filterNoMembers') }],
    },
  ];

  const countFor = (state: SavedViewState): number =>
    searchRows(
      all.filter((role) => roleMatchesFilters(role, state.filters ?? {})),
      state.search ?? '',
      columns,
    ).length;
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'custom',
      label: t('views.custom'),
      state: { filters: { kind: 'CUSTOM' }, sort: DEFAULT_SORT },
    },
    {
      id: 'system',
      label: t('views.system'),
      state: { filters: { kind: 'SYSTEM' }, sort: DEFAULT_SORT },
    },
    {
      id: 'unused',
      label: t('views.unused'),
      state: { filters: { members: 'none' }, sort: DEFAULT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const customCount = all.filter((role) => role.kind === 'CUSTOM').length;
  const headerSummary =
    all.length === 0 ? undefined : t('headerSummary', { count: all.length, custom: customCount });

  const createAction = canManage ? (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden="true" />
      {t('addRole')}
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
        rowKey={(role) => role.id}
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
            listKey="roles"
            builtIns={builtIns}
            current={view.current}
            onApply={view.applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        exportAs={{ fileName: 'roles', sheetName: t('title') }}
        shortcuts={{ onNew: canManage ? () => setCreateOpen(true) : undefined }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
        emptyState={
          all.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction}
            />
          ) : undefined
        }
        rowActions={
          canManage
            ? (role) =>
                role.kind === 'CUSTOM' ? (
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
                          <DropdownMenuItem onSelect={() => openDialog('governance', role)}>
                            {t('actions.viewImpact')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openDialog('edit', role)}>
                            {t('actions.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openDialog('permissions', role)}>
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
                ) : (
                  // SYSTEM roles are protected: review only, no edit/delete.
                  <Button variant="ghost" size="sm" onClick={() => openDialog('governance', role)}>
                    {t('protected')}
                  </Button>
                )
            : undefined
        }
      />

      {canManage ? (
        <>
          <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
          <EditRoleDialog
            role={dialog === 'edit' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          />
          <ManagePermissionsDialog
            role={dialog === 'permissions' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          />
          <RoleGovernanceDialog
            role={dialog === 'governance' ? target : null}
            onOpenChange={(open) => {
              if (!open) closeDialog();
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
