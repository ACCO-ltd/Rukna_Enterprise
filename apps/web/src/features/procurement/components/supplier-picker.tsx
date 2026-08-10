'use client';

/**
 * The shared supplier select.
 *
 * Three create paths need one — purchase orders (Tier A), supplier bills (Tier B) and
 * supplier payments (Tier C) — and all three send the same `supplierId` to the same kind
 * of DTO, so the control lives here once.
 *
 * It is a native `<select>` rather than a combobox, matching `MaterialPicker` and the
 * category selects on the setup screens. A supplier master is bounded in a way a material
 * catalogue is not, and a native select is what works at 375px and with a screen reader
 * without re-implementing either.
 *
 * **Empty is the normal first state.** No supplier is seeded in any environment
 * (`prisma/seeds/` creates accounts, posting profiles and bank accounts, but no supplier),
 * so on a fresh tenant this renders an explanation and a link to create one rather than an
 * empty dropdown that looks broken.
 */

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Alert } from '@erp/ui';

import { useSuppliers } from '../hooks/use-procurement';
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

  if (rows.length === 0) {
    return (
      <Alert variant="info" title={t('noneYetTitle')} messages={[t('noneYetBody')]}>
        <Link
          href="/procurement/suppliers"
          className="text-sm font-medium underline underline-offset-2"
        >
          {t('goToSuppliers')}
        </Link>
      </Alert>
    );
  }

  return (
    <select
      id={id}
      value={value}
      required={required}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50"
    >
      <option value="" disabled>
        —
      </option>
      {rows.map((supplier) => (
        <option key={supplier.id} value={supplier.id}>
          {supplierOptionLabel(supplier)}
        </option>
      ))}
    </select>
  );
}
