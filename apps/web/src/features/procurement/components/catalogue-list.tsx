'use client';

/**
 * The setup lists (materials, material categories, spend categories, units of measure) share one
 * shape: a compact grid with a Status filter (Active by default), one primary "New …", and a
 * kebab per row holding only what the row's status and the viewer allow — Deactivate…
 * (Discontinue… for materials) on an active row, Reactivate on an inactive one — each confirmed.
 */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, type FilterValues, type ListFilterField } from '@erp/ui';
import { Plus } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';

import type { CatalogueStatusFilter } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
import { CreateDialogTitleProvider } from './setup-shell';

/** A status-changing command — the shape of the deactivate / reactivate mutations. */
export interface StatusCommand {
  mutate: (id: string, options: { onSuccess: () => void }) => void;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * The Status filter every setup list carries. Empty means the default, Active — so the
 * "no filter" option is labelled Active rather than the panel's generic "Any", which would sit
 * beside "All" and read as the same choice.
 */
export function useStatusFilterField(): ListFilterField {
  const t = useTranslations('procurement.setup');
  return {
    key: 'status',
    type: 'select',
    label: t('status'),
    anyLabel: t('statusOption.ACTIVE'),
    options: (['INACTIVE', 'ALL'] as const).map((value) => ({ value, label: t(`statusOption.${value}`) })),
  };
}

export function statusFrom(values: FilterValues): CatalogueStatusFilter {
  return (values.status as CatalogueStatusFilter | undefined) || 'ACTIVE';
}

interface RowCommand<T> {
  /** "Deactivate…", "Discontinue…", "Reactivate". */
  label: string;
  title: (row: T) => string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  command: StatusCommand;
}

export function CatalogueListScreen<T extends { id: string; code: string; status: string }>({
  label,
  rows,
  isPending,
  isError,
  onRetry,
  columns,
  rowKey = (row) => row.id,
  filterFields,
  filterValues,
  onFilterValuesChange,
  canManage,
  createLabel,
  createTitle,
  createForm,
  emptyTitle,
  emptyHint,
  searchPlaceholder,
  countLabel,
  retire,
  reactivate,
  tree = false,
}: {
  label: string;
  rows: T[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  columns: GridColumn<T>[];
  rowKey?: (row: T) => string;
  filterFields: ListFilterField[];
  filterValues: FilterValues;
  onFilterValuesChange: (next: FilterValues) => void;
  canManage: boolean;
  createLabel: string;
  createTitle: string;
  createForm: (close: () => void) => ReactNode;
  emptyTitle: string;
  emptyHint: string;
  searchPlaceholder: string;
  countLabel: (count: number) => string;
  retire: RowCommand<T>;
  reactivate: RowCommand<T>;
  /** A category tree: rows stay in parent → child order, so nothing sorts. */
  tree?: boolean;
}) {
  const t = useTranslations('procurement.setup');
  const tc = useTranslations('procurement.common');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ row: T; action: RowCommand<T> } | null>(null);

  const isFirstUse = !isPending && !isError && rows.length === 0 && !Object.values(filterValues).some(Boolean);

  const createAction = canManage ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden="true" />
      {createLabel}
    </Button>
  ) : undefined;

  const commandsFor = (row: T) => {
    if (!canManage) return [];
    const action = row.status === 'ACTIVE' ? retire : reactivate;
    return [{ key: row.status === 'ACTIVE' ? 'retire' : 'reactivate', label: action.label, onSelect: () => setPending({ row, action }) }];
  };

  return (
    <>
      <PlatformDataGrid
        columns={columns}
        data={rows}
        rowKey={rowKey}
        label={label}
        isLoading={isPending}
        isError={isError}
        errorMessage={tc('loadFailed')}
        onRetry={onRetry}
        searchPlaceholder={searchPlaceholder}
        resultLabel={countLabel}
        noMatchMessage={t('noMatches')}
        pagination={{ defaultPageSize: 25 }}
        sortControl={!tree}
        filters={filterFields}
        filterValues={filterValues}
        onFilterValuesChange={onFilterValuesChange}
        rowActions={
          canManage
            ? (row) => <ListRowMenu label={t('rowMenu', { code: row.code })} commands={commandsFor(row)} />
            : undefined
        }
        emptyState={isFirstUse ? <EmptyState title={emptyTitle} description={emptyHint} action={createAction} /> : undefined}
        toolbarActions={createAction}
      />

      {creating ? (
        <CreateDialogTitleProvider value={createTitle}>{createForm(() => setCreating(false))}</CreateDialogTitleProvider>
      ) : null}

      {pending ? (
        <ConfirmActionDialog
          title={pending.action.title(pending.row)}
          description={pending.action.body}
          confirmLabel={pending.action.confirmLabel}
          destructive={pending.action.destructive}
          isPending={pending.action.command.isPending}
          errorMessage={pending.action.command.error ? errorText(pending.action.command.error, tc('loadFailed')) : undefined}
          onConfirm={() => pending.action.command.mutate(pending.row.id, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            pending.action.command.reset();
            setPending(null);
          }}
        />
      ) : null}
    </>
  );
}
