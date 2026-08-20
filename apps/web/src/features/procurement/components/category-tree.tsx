'use client';

/**
 * Material categories and spend categories (§12.4).
 *
 * One component for both. They are structurally identical — a two-level tree, the same
 * create body, the same deactivate action — and the API returns them in the same shape.
 *
 * They are *not* the same thing, and the UI must never suggest they are: a material
 * category is the operational hierarchy of the catalogue (Steel → Rebar), while a spend
 * category drives approval routing, tolerance policy and commitment attribution. §12.4 is
 * explicit that the label is always "Spend Category" — never "Cost Category", never
 * "Material Category". That is why the copy is passed in per screen rather than derived
 * from a shared string.
 */

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  FormField,
  Input,
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
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import type { CreateCategoryPayload, MaterialCategory, SpendCategory } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm, SetupScreen } from './setup-shell';

/** Both category types share this shape; the tree does not care which it is showing. */
type Category = MaterialCategory | SpendCategory;

interface CategoryTreeProps {
  /** `procurement.materialCategory` or `procurement.spendCategory`. */
  namespace: 'materialCategory' | 'spendCategory';
  data: Category[] | undefined;
  isPending: boolean;
  isError: boolean;
  onCreate: (
    payload: CreateCategoryPayload,
    options: { onSuccess: () => void },
  ) => void;
  isCreating: boolean;
  createError: unknown;
  onDeactivate: (id: string, options: { onSuccess: () => void }) => void;
  isDeactivating: boolean;
  deactivateError: boolean;
}

export function CategoryTree({
  namespace,
  data,
  isPending,
  isError,
  onCreate,
  isCreating,
  createError,
  onDeactivate,
  isDeactivating,
  deactivateError,
}: CategoryTreeProps) {
  const t = useTranslations(`procurement.${namespace}`);
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const [pending, setPending] = useState<Category | null>(null);
  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);

  const roots = data ?? [];

  return (
    <>
      <SetupScreen
        title={t('title')}
        subtitle={t('subtitle')}
        createLabel={t('new')}
        createTitle={t('createTitle')}
        canCreate={canManage}
        createForm={(close) => (
          <CategoryCreateForm
            namespace={namespace}
            roots={roots}
            onCreate={onCreate}
            isCreating={isCreating}
            createError={createError}
            onDone={close}
          />
        )}
        isPending={isPending}
        isError={isError}
      >
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('code')}</TableHead>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{tc('status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roots.length === 0 ? (
                <TableEmpty colSpan={4}>{t('empty')}</TableEmpty>
              ) : (
                roots.flatMap((root) => [
                  <CategoryRow
                    key={root.id}
                    category={root}
                    depth={0}
                    canManage={canManage}
                    onDeactivate={setPending}
                  />,
                  ...(root.children ?? []).map((child) => (
                    <CategoryRow
                      key={child.id}
                      category={child}
                      depth={1}
                      canManage={canManage}
                      onDeactivate={setPending}
                    />
                  )),
                ])
              )}
            </TableBody>
          </Table>
        </TableScroll>
      </SetupScreen>

      {pending ? (
        <ConfirmActionDialog
          title={t('deactivateTitle', { code: pending.code })}
          description={t('deactivateBody')}
          confirmLabel={tc('confirm')}
          isPending={isDeactivating}
          errorMessage={deactivateError ? tc('loadFailed') : undefined}
          onConfirm={() => onDeactivate(pending.id, { onSuccess: () => setPending(null) })}
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Depth is rendered as indentation on the code cell rather than as a nested table.
 *
 * A real tree table would need its own expand/collapse state for two levels, and the API
 * only ever returns two. Indentation reads the same and stays a flat, sortable table.
 */
function CategoryRow({
  category,
  depth,
  canManage,
  onDeactivate,
}: {
  category: Category;
  depth: number;
  canManage: boolean;
  onDeactivate: (c: Category) => void;
}) {
  const tc = useTranslations('procurement.common');

  return (
    <TableRow>
      <TableCell>
        <span
          className="font-mono text-xs"
          style={{ paddingInlineStart: `${depth * 1.25}rem` }}
        >
          {depth > 0 ? (
            <span aria-hidden="true" className="me-1 text-muted-foreground">
              ↳
            </span>
          ) : null}
          {category.code}
        </span>
      </TableCell>
      <TableCell>
        <span className="text-sm text-foreground">{category.name}</span>
      </TableCell>
      <TableCell>
        <ProcurementStatusBadge status={category.status} />
      </TableCell>
      <TableCell>
        {canManage && category.status === 'ACTIVE' ? (
          <button
            type="button"
            onClick={() => onDeactivate(category)}
            className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline"
          >
            {tc('deactivate')}
            <span className="sr-only"> — {category.code}</span>
          </button>
        ) : null}
      </TableCell>
    </TableRow>
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
        <select
          id={ids.parent}
          name="parentCode"
          defaultValue=""
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t('noParent')}</option>
          {roots.map((root) => (
            <option key={root.id} value={root.code}>
              {root.code} · {root.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('parentHint')}</p>
      </FormField>
    </CreateForm>
  );
}
