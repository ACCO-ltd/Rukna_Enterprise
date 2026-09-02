'use client';

/**
 * The shared supplier select.
 *
 * Three create paths need one — purchase orders (Tier A), supplier bills (Tier B) and
 * supplier payments (Tier C) — and all three send the same `supplierId` to the same kind
 * of DTO, so the control lives here once.
 *
 * It is a native `<Select>` rather than a combobox, matching `MaterialPicker` and the
 * category selects on the setup screens. A supplier master is bounded in a way a material
 * catalogue is not, and a native select is what works at 375px and with a screen reader
 * without re-implementing either.
 *
 * **Empty is the normal first state.** No supplier is seeded in any environment
 * (`prisma/seeds/` creates accounts, posting profiles and bank accounts, but no supplier),
 * so on a fresh tenant this renders an explanation and a link to create one rather than an
 * empty dropdown that looks broken.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Alert, Select } from '@erp/ui';

import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useCreateSupplier, useSuppliers } from '../hooks/use-procurement';
import { CreateInPickerDialog } from './create-in-picker-dialog';
import type { Supplier } from '../types';

/** How a supplier reads in a list of options: `SUP-001 · Al-Rashid Trading`. */
export function supplierOptionLabel(supplier: Supplier): string {
  return `${supplier.code} · ${supplier.name}`;
}

interface SupplierPickerProps {
  id: string;
  value: string;
  onChange: (supplierId: string) => void;
  disabled?: boolean;
  /** Marks the underlying select required. The caller still guards its own submit. */
  required?: boolean;
}

export function SupplierPicker({
  id,
  value,
  onChange,
  disabled,
  required,
}: SupplierPickerProps) {
  const t = useTranslations('procurement.supplier');
  const tc = useTranslations('procurement.common');
  // `loading` lives in the shared `common` catalogue, not `procurement.common` —
  // the same split `SetupScreen` uses.
  const tCommon = useTranslations('common');

  const suppliers = useSuppliers();
  const { can } = usePermissions();
  const canManage = can(PROCUREMENT_PERMISSIONS.manageSuppliers);
  const create = useCreateSupplier();
  const [creating, setCreating] = useState(false);

  if (suppliers.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-11 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (suppliers.isError) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const rows = suppliers.data ?? [];

  // Selecting the new supplier is the confirmation. Creating one and leaving the picker empty
  // would make the buyer answer the same question twice, mid-order.
  const renderCreateDialog = () => (
    <CreateInPickerDialog
      title={t('createTitle')}
      fields={[
        { name: 'code', label: tc('code'), hint: t('codeHint'), uppercase: true, maxLength: 30, required: true, narrow: true },
        { name: 'name', label: tc('name'), required: true },
        { name: 'taxNumber', label: t('taxNumber'), hint: t('taxNumberHint') },
      ]}
      submitLabel={t('new')}
      isPending={create.isPending}
      error={create.error}
      onDismiss={() => {
        setCreating(false);
        create.reset();
      }}
      onSubmit={(values) =>
        create.mutate(
          {
            code: values.code ?? '',
            name: values.name ?? '',
            ...(values.taxNumber ? { taxNumber: values.taxNumber } : {}),
          },
          {
            onSuccess: (supplier) => {
              onChange(supplier.id);
              setCreating(false);
            },
          },
        )
      }
    />
  );

  if (rows.length === 0) {
    return (
      <>
        <Alert variant="info" title={t('noneYetTitle')} messages={[t('noneYetBody')]}>
          {canManage ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-sm font-medium underline underline-offset-2"
            >
              {t('new')}
            </button>
          ) : (
            <Link
              href="/procurement/suppliers"
              className="text-sm font-medium underline underline-offset-2"
            >
              {t('goToSuppliers')}
            </Link>
          )}
        </Alert>
        {creating ? renderCreateDialog() : null}
      </>
    );
  }

  return (
    <>
      {creating ? renderCreateDialog() : null}
      <Select
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(value) => onChange(value)}
        createAction={canManage ? { label: t('new'), onSelect: () => setCreating(true) } : undefined}
      >
        <option value="" disabled>
          —
        </option>
        {rows.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplierOptionLabel(supplier)}
          </option>
        ))}
      </Select>
    </>
  );
}
