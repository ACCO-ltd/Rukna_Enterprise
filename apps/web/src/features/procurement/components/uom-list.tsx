'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FormField, Input, type FilterValues } from '@erp/ui';

import { type GridColumn } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useCreateUom, useDeactivateUom, useReactivateUom, useUoms } from '../hooks/use-procurement';
import type { UnitOfMeasure } from '../types';
import { CatalogueListScreen, statusFrom, useStatusFilterField } from './catalogue-list';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm } from './setup-shell';

/**
 * Units of measure (§12.4) — the shared setup list: Status filter (Active by default),
 * New unit, and Deactivate… / Reactivate per row.
 */
export function UomList() {
  const t = useTranslations('procurement.uom');
  const tSetup = useTranslations('procurement.setup');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();
  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);

  const [filters, setFilters] = useState<FilterValues>({});
  const uoms = useUoms(statusFrom(filters));
  const deactivate = useDeactivateUom();
  const reactivate = useReactivateUom();
  const statusField = useStatusFilterField();

  const columns: GridColumn<UnitOfMeasure>[] = [
    {
      key: 'code',
      card: 'subtitle',
      header: tc('code'),
      sticky: true,
      sortable: true,
      plainValue: (uom) => uom.code,
      render: (uom) => <span className="font-mono text-caption">{uom.code}</span>,
    },
    { key: 'name', card: 'title', header: tc('name'), sortable: true, plainValue: (uom) => uom.name, render: (uom) => uom.name },
    {
      key: 'symbol',
      card: 'meta',
      header: t('symbol'),
      plainValue: (uom) => uom.symbol,
      render: (uom) => <bdi>{uom.symbol}</bdi>,
    },
    {
      key: 'status',
      card: 'status',
      header: tc('status'),
      render: (uom) => <ProcurementStatusBadge vocabulary="masterData" status={uom.status} />,
    },
  ];

  return (
    <CatalogueListScreen<UnitOfMeasure>
      label={t('title')}
      rows={uoms.data ?? []}
      isPending={uoms.isPending}
      isError={uoms.isError}
      onRetry={() => void uoms.refetch()}
      columns={columns}
      filterFields={[statusField]}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      canManage={canManage}
      createLabel={t('new')}
      createTitle={t('createTitle')}
      createForm={(close) => <UomCreateForm onDone={close} />}
      emptyTitle={t('emptyTitle')}
      emptyHint={t('emptyHint')}
      searchPlaceholder={t('searchPlaceholder')}
      countLabel={(count) => t('countLabel', { count })}
      retire={{
        label: tSetup('deactivateMenu'),
        title: (uom) => t('deactivateTitle', { code: uom.code }),
        body: t('deactivateBody'),
        confirmLabel: tSetup('deactivate'),
        destructive: true,
        command: deactivate,
      }}
      reactivate={{
        label: tSetup('reactivate'),
        title: (uom) => tSetup('reactivateTitle', { code: uom.code }),
        body: tSetup('reactivateBody'),
        confirmLabel: tSetup('reactivate'),
        command: reactivate,
      }}
    />
  );
}

function UomCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.uom');
  const tc = useTranslations('procurement.common');
  const ids = { code: useId(), name: useId(), symbol: useId() };

  const create = useCreateUom();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const symbol = String(form.get('symbol') ?? '').trim();

    if (!code || !name || !symbol) return;

    create.mutate(
      { code, name, symbol },
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
        <Input id={ids.code} name="code" required maxLength={20} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.symbol} label={t('symbol')}>
        <Input id={ids.symbol} name="symbol" required maxLength={10} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('symbolHint')}</p>
      </FormField>
    </CreateForm>
  );
}
