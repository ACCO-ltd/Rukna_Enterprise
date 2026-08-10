'use client';

/**
 * The supplier master (Tier A).
 *
 * Not one of §12.4's four setup screens — suppliers had no endpoint when that section was
 * written — but the same shape, so it reuses `SetupScreen` and `CreateForm` rather than
 * inventing a fifth layout.
 *
 * Two things make it different from its four neighbours, and both come from the API:
 *
 *  - **There is no edit and no deactivate** (A15). `supplier.controller.ts` exposes GET,
 *    GET/:id and POST, and nothing else. Every other master-data screen has a `deactivate`
 *    column; this one has no actions column at all, because there is no action to put in it.
 *  - **The list is not filtered to ACTIVE.** `status` is a real query parameter here rather
 *    than a hard-coded `'ACTIVE'` (P2), so an inactive supplier would be visible if one
 *    could exist. None can, which is why the column is rendered but no filter is offered.
 */

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
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

import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useCreateSupplier, useSuppliers } from '../hooks/use-procurement';
import type { Supplier } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm, SetupScreen } from './setup-shell';

/** Case-insensitive match across the three fields a user would search by. */
export function filterSuppliers(suppliers: Supplier[], query: string): Supplier[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return suppliers;
  return suppliers.filter((s) =>
    [s.code, s.name, s.nameAr ?? '']
      .some((field) => field.toLocaleLowerCase().includes(q)),
  );
}

export function SupplierList() {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const [query, setQuery] = useState('');
  const suppliers = useSuppliers();
  const searchId = useId();

  const canManage = can(PROCUREMENT_PERMISSIONS.manageSuppliers);

  // Filtered in the browser: `GET /suppliers` takes no `search` parameter, the same gap
  // materials have (P1). A supplier master is small and bounded, so one fetch beats one
  // request per keystroke.
  const rows = useMemo(
    () => filterSuppliers(suppliers.data ?? [], query),
    [suppliers.data, query],
  );

  return (
    <SetupScreen
      title={t('title')}
      subtitle={t('subtitle')}
      notice={t('writeOnceNotice')}
      createLabel={t('new')}
      createTitle={t('createTitle')}
      canCreate={canManage}
      createForm={(close) => <SupplierCreateForm onDone={close} />}
      isPending={suppliers.isPending}
      isError={suppliers.isError}
    >
      <div className="max-w-sm">
        <label
          htmlFor={searchId}
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {tc('search')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
        />
      </div>

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('code')}</TableHead>
              <TableHead>{tc('name')}</TableHead>
              <TableHead>{t('taxNumber')}</TableHead>
              <TableHead>{t('defaultCurrency')}</TableHead>
              <TableHead>{t('paymentTerms')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={6}>
                {query ? tc('noResults') : t('empty')}
              </TableEmpty>
            ) : (
              rows.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-mono text-xs">{supplier.code}</TableCell>
                  <TableCell>
                    <span className="text-sm text-foreground">{supplier.name}</span>
                    {supplier.nameAr ? (
                      <bdi className="mt-0.5 block text-xs text-muted-foreground" lang="ar">
                        {supplier.nameAr}
                      </bdi>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {supplier.taxNumber ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {supplier.defaultCurrency ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {supplier.paymentTermsDays === null
                      ? tc('notAvailable')
                      : t('paymentTermsDays', { days: supplier.paymentTermsDays })}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={supplier.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </SetupScreen>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────────

function SupplierCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');

  const ids = {
    code: useId(),
    name: useId(),
    nameAr: useId(),
    taxNumber: useId(),
    currency: useId(),
    terms: useId(),
  };

  const create = useCreateSupplier();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const nameAr = String(form.get('nameAr') ?? '').trim();
    const taxNumber = String(form.get('taxNumber') ?? '').trim();
    const defaultCurrency = String(form.get('defaultCurrency') ?? '').trim().toUpperCase();
    const terms = String(form.get('paymentTermsDays') ?? '').trim();

    if (!code || !name) return;

    // `paymentTermsDays` is @IsInt() @Min(0). An empty field must be omitted rather than
    // sent as 0 — "pay immediately" and "not recorded" are different facts about a supplier.
    const paymentTermsDays = terms === '' ? undefined : Number(terms);
    if (paymentTermsDays !== undefined && !Number.isInteger(paymentTermsDays)) return;

    create.mutate(
      {
        code,
        name,
        ...(nameAr ? { nameAr } : {}),
        ...(taxNumber ? { taxNumber } : {}),
        ...(defaultCurrency ? { defaultCurrency } : {}),
        ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
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
      {/* The API has no PATCH (A15), so this is the only chance to get it right. Said
          before the fields rather than after, where it would be an epitaph. */}
      <Alert variant="warning" messages={[t('noEditWarning')]} />

      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required maxLength={50} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required maxLength={255} autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.nameAr} label={`${tc('nameAr')} (${tc('optional')})`}>
        <Input id={ids.nameAr} name="nameAr" dir="rtl" lang="ar" autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.taxNumber} label={`${t('taxNumber')} (${tc('optional')})`}>
        <Input id={ids.taxNumber} name="taxNumber" maxLength={50} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t('taxNumberHint')}</p>
      </FormField>

      <FormField
        htmlFor={ids.currency}
        label={`${t('defaultCurrency')} (${tc('optional')})`}
      >
        <Input
          id={ids.currency}
          name="defaultCurrency"
          maxLength={3}
          className="uppercase"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('currencyHint')}</p>
      </FormField>

      <FormField htmlFor={ids.terms} label={`${t('paymentTerms')} (${tc('optional')})`}>
        <Input
          id={ids.terms}
          name="paymentTermsDays"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('paymentTermsHint')}</p>
      </FormField>
    </CreateForm>
  );
}
