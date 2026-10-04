'use client';

/**
 * Material and spend categories — a two-level tree on the shared setup list. Rows stay in
 * parent → child order with the child indented, so the grid does not sort. Status filter
 * (Active by default), New category, and Deactivate… / Reactivate per row.
 */

import { useId, useMemo, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FormField, Input, Select, type FilterValues } from '@erp/ui';

import { type GridColumn } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import type { CreateCategoryPayload, MaterialCategory, SpendCategory } from '../types';
import { CatalogueListScreen, useStatusFilterField, type StatusCommand } from './catalogue-list';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm } from './setup-shell';

type Category = MaterialCategory | SpendCategory;
type CategoryRow = Category & { depth: number };

interface CategoryTreeProps {
  namespace: 'materialCategory' | 'spendCategory';
  data: Category[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  filterValues: FilterValues;
  onFilterValuesChange: (next: FilterValues) => void;
  /** Active roots — the parents a new category can sit under. */
  parentOptions: Category[];
  onCreate: (payload: CreateCategoryPayload, options: { onSuccess: () => void }) => void;
  isCreating: boolean;
  createError: unknown;
  deactivate: StatusCommand;
  reactivate: StatusCommand;
}

/** Roots and their children in tree order, each with its depth. */
export function flattenCategoryTree(roots: readonly Category[]): CategoryRow[] {
  return roots.flatMap((root) => [
    { ...root, depth: 0 },
    ...(root.children ?? []).map((child) => ({ ...child, depth: 1 })),
  ]);
}

export function CategoryTree({
  namespace,
  data,
  isPending,
  isError,
  onRetry,
  filterValues,
  onFilterValuesChange,
  parentOptions,
  onCreate,
  isCreating,
  createError,
  deactivate,
  reactivate,
}: CategoryTreeProps) {
  const t = useTranslations(`procurement.${namespace}`);
  const tSetup = useTranslations('procurement.setup');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();
  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);
  const statusField = useStatusFilterField();

  const rows = useMemo(() => flattenCategoryTree(data ?? []), [data]);

  const columns: GridColumn<CategoryRow>[] = [
    {
      key: 'code',
      header: tc('code'),
      sticky: true,
      plainValue: (category) => category.code,
      render: (category) => (
        <span className="font-mono text-caption" style={{ paddingInlineStart: `${category.depth * 1.25}rem` }}>
          {category.depth > 0 ? (
            <span aria-hidden="true" className="me-1 text-muted-foreground">
              ↳
            </span>
          ) : null}
          {category.code}
        </span>
      ),
    },
    { key: 'name', header: tc('name'), plainValue: (category) => category.name, render: (category) => category.name },
    {
      key: 'status',
      header: tc('status'),
      render: (category) => <ProcurementStatusBadge vocabulary="masterData" status={category.status} />,
    },
  ];

  return (
    <CatalogueListScreen<CategoryRow>
      label={t('title')}
      rows={rows}
      isPending={isPending}
      isError={isError}
      onRetry={onRetry}
      columns={columns}
      filterFields={[statusField]}
      filterValues={filterValues}
      onFilterValuesChange={onFilterValuesChange}
      canManage={canManage}
      createLabel={t('new')}
      createTitle={t('createTitle')}
      createForm={(close) => (
        <CategoryCreateForm
          namespace={namespace}
          roots={parentOptions}
          onCreate={onCreate}
          isCreating={isCreating}
          createError={createError}
          onDone={close}
        />
      )}
      emptyTitle={t('emptyTitle')}
      emptyHint={t('emptyHint')}
      searchPlaceholder={tSetup('searchPlaceholder')}
      countLabel={(count) => tSetup('categoryCount', { count })}
      tree
      retire={{
        label: tSetup('deactivateMenu'),
        title: (category) => t('deactivateTitle', { code: category.code }),
        body: t('deactivateBody'),
        confirmLabel: tSetup('deactivate'),
        destructive: true,
        command: deactivate,
      }}
      reactivate={{
        label: tSetup('reactivate'),
        title: (category) => tSetup('reactivateTitle', { code: category.code }),
        body: tSetup('reactivateBody'),
        confirmLabel: tSetup('reactivate'),
        command: reactivate,
      }}
    />
  );
}

function CategoryCreateForm({
  namespace,
  roots,
  onCreate,
  isCreating,
  createError,
  onDone,
}: {
  namespace: 'materialCategory' | 'spendCategory';
  roots: Category[];
  onCreate: CategoryTreeProps['onCreate'];
  isCreating: boolean;
  createError: unknown;
  onDone: () => void;
}) {
  const t = useTranslations(`procurement.${namespace}`);
  const tc = useTranslations('procurement.common');
  const ids = { code: useId(), name: useId(), parent: useId() };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const parentCode = String(form.get('parentCode') ?? '').trim();

    if (!code || !name) return;

    onCreate(
      {
        code,
        name,
        ...(parentCode ? { parentCode } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <CreateForm
      onSubmit={handleSubmit}
      isPending={isCreating}
      error={createError}
      onCancel={onDone}
    >
      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required autoComplete="off" />
      </FormField>

      {/* Only root categories are offered as parents — the API returns two levels, so a
          third would be created and then never displayed. */}
      <FormField htmlFor={ids.parent} label={t('parent')}>
        <Select
          id={ids.parent}
          name="parentCode"
          defaultValue=""
        >
          <option value="">{t('noParent')}</option>
          {roots.map((root) => (
            <option key={root.id} value={root.code}>
              {root.code} · {root.name}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('parentHint')}</p>
      </FormField>
    </CreateForm>
  );
}
