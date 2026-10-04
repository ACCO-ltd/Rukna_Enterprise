'use client';

/**
 * The materials catalogue on the shared setup list: Status (Active by default — Inactive also
 * covers discontinued), material category and spend category in the one Filter panel, New
 * material, and Discontinue… / Reactivate per row.
 */

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, FormField, Input, Select, Textarea, type FilterValues } from '@erp/ui';

import { type GridColumn } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import {
  useCreateMaterial,
  useDiscontinueMaterial,
  useMaterialCategories,
  useMaterials,
  useReactivateMaterial,
  useSpendCategories,
  useUoms,
} from '../hooks/use-procurement';
import type { Material, MaterialCategory, SpendCategory } from '../types';
import { CatalogueListScreen, statusFrom, useStatusFilterField } from './catalogue-list';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm } from './setup-shell';

function flatten<T extends { id: string; code: string; name: string; children?: T[] }>(
  roots: T[] | undefined,
): { id: string; code: string; label: string }[] {
  return (roots ?? []).flatMap((root) => [
    { id: root.id, code: root.code, label: `${root.code} · ${root.name}` },
    ...(root.children ?? []).map((child) => ({
      id: child.id,
      code: child.code,
      label: `  ↳ ${child.code} · ${child.name}`,
    })),
  ]);
}

export function MaterialsList() {
  const t = useTranslations('procurement.material');
  const tSetup = useTranslations('procurement.setup');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();
  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);

  const [filters, setFilters] = useState<FilterValues>({});
  const materials = useMaterials({
    status: statusFrom(filters),
    ...(filters.category ? { materialCategoryId: filters.category } : {}),
    ...(filters.spend ? { spendCategoryId: filters.spend } : {}),
  });
  const categories = useMaterialCategories();
  const spendCategories = useSpendCategories();
  const discontinue = useDiscontinueMaterial();
  const reactivate = useReactivateMaterial();
  const statusField = useStatusFilterField();

  const columns: GridColumn<Material>[] = [
    {
      key: 'code',
      header: tc('code'),
      sticky: true,
      sortable: true,
      plainValue: (material) => material.code,
      render: (material) => <span className="font-mono text-caption">{material.code}</span>,
    },
    {
      key: 'name',
      header: tc('name'),
      sortable: true,
      plainValue: (material) => material.name,
      render: (material) => material.name,
    },
    {
      key: 'baseUom',
      header: t('baseUom'),
      plainValue: (material) => material.baseUom?.symbol ?? material.baseUom?.code ?? '',
      render: (material) => <bdi>{material.baseUom?.symbol ?? material.baseUom?.code ?? tc('notAvailable')}</bdi>,
    },
    {
      key: 'materialCategory',
      header: t('materialCategory'),
      sortable: true,
      plainValue: (material) => material.materialCategory?.name ?? '',
      render: (material) => (
        <span className="text-muted-foreground">{material.materialCategory?.name ?? tc('notAvailable')}</span>
      ),
    },
    {
      key: 'defaultSpendCategory',
      header: t('defaultSpendCategory'),
      sortable: true,
      plainValue: (material) => material.defaultSpendCategory?.name ?? '',
      render: (material) => (
        <span className="text-muted-foreground">{material.defaultSpendCategory?.name ?? tc('notAvailable')}</span>
      ),
    },
    {
      key: 'status',
      header: tc('status'),
      render: (material) => <ProcurementStatusBadge vocabulary="masterData" status={material.status} />,
    },
  ];

  return (
    <CatalogueListScreen<Material>
      label={t('title')}
      rows={materials.data ?? []}
      isPending={materials.isPending}
      isError={materials.isError}
      onRetry={() => void materials.refetch()}
      columns={columns}
      filterFields={[
        statusField,
        {
          key: 'category',
          type: 'select',
          label: t('filterByCategory'),
          options: flatten<MaterialCategory>(categories.data).map((c) => ({ value: c.id, label: c.label.trim() })),
        },
        {
          key: 'spend',
          type: 'select',
          label: t('filterBySpendCategory'),
          options: flatten<SpendCategory>(spendCategories.data).map((c) => ({ value: c.id, label: c.label.trim() })),
        },
      ]}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      canManage={canManage}
      createLabel={t('new')}
      createTitle={t('createTitle')}
      createForm={(close) => <MaterialCreateForm onDone={close} />}
      emptyTitle={t('emptyTitle')}
      emptyHint={t('emptyHint')}
      searchPlaceholder={tSetup('searchPlaceholder')}
      countLabel={(count) => t('countLabel', { count })}
      retire={{
        label: t('discontinueMenu'),
        title: (material) => t('discontinueTitle', { code: material.code }),
        body: t('discontinueBody'),
        confirmLabel: t('discontinue'),
        destructive: true,
        command: discontinue,
      }}
      reactivate={{
        label: tSetup('reactivate'),
        title: (material) => tSetup('reactivateTitle', { code: material.code }),
        body: tSetup('reactivateBody'),
        confirmLabel: tSetup('reactivate'),
        command: reactivate,
      }}
    />
  );
}

function MaterialCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.material');
  const tc = useTranslations('procurement.common');
  const ids = {
    code: useId(),
    name: useId(),
    description: useId(),
    category: useId(),
    spend: useId(),
    uom: useId(),
  };

  const create = useCreateMaterial();
  const categories = useMaterialCategories();
  const spendCategories = useSpendCategories();
  const uoms = useUoms();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const materialCategoryCode = String(form.get('materialCategoryCode') ?? '').trim();
    const baseUomCode = String(form.get('baseUomCode') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const defaultSpendCategoryCode = String(form.get('defaultSpendCategoryCode') ?? '').trim();

    if (!code || !name || !materialCategoryCode || !baseUomCode) return;

    create.mutate(
      {
        code,
        name,
        materialCategoryCode,
        baseUomCode,
        ...(description ? { description } : {}),
        ...(defaultSpendCategoryCode ? { defaultSpendCategoryCode } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <CreateForm
      onSubmit={handleSubmit}
      isPending={create.isPending}
      error={create.error}
      onCancel={onDone}
    >
      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required maxLength={50} autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.description} label={`${tc('description')} (${tc('optional')})`}>
        <Textarea id={ids.description} name="description" rows={2} />
      </FormField>

      <FormField htmlFor={ids.category} label={t('materialCategory')}>
        <Select
          id={ids.category}
          name="materialCategoryCode"
          required
          defaultValue=""
        >
          <option value="" disabled>
            —
          </option>
          {flatten<MaterialCategory>(categories.data).map((c) => (
            <option key={c.id} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        htmlFor={ids.spend}
        label={`${t('defaultSpendCategory')} (${tc('optional')})`}
      >
        <Select
          id={ids.spend}
          name="defaultSpendCategoryCode"
          defaultValue=""
        >
          <option value="">—</option>
          {flatten<SpendCategory>(spendCategories.data).map((c) => (
            <option key={c.id} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField htmlFor={ids.uom} label={t('baseUom')}>
        <Select
          id={ids.uom}
          name="baseUomCode"
          required
          defaultValue=""
        >
          <option value="" disabled>
            —
          </option>
          {(uoms.data ?? []).map((u) => (
            <option key={u.id} value={u.code}>
              {u.code} · {u.name}
            </option>
          ))}
        </Select>
        {/* §12.4 asks for this to be said out loud on the field. It is the only decision on
            this form that cannot be undone — there is no edit endpoint, and every future
            order and receipt for the material inherits it. */}
        <Alert variant="warning" messages={[t('baseUomWarning')]} />
      </FormField>
    </CreateForm>
  );
}
