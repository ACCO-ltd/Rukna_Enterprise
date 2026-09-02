'use client';

/**
 * The purchase-order select for a PO-backed supplier bill (Slice ④, D6).
 *
 * A bill is raised against a purchase order, so this offers the POs a bill can legitimately
 * be matched against: OPEN orders with an ACTIVE revision. A CLOSED or CANCELLED order, or a
 * PO whose only revision is still a DRAFT, has no committed exposure to bill against — the
 * server would resolve no ACTIVE revision and reject the create — so it is not offered.
 *
 * It is a native `<Select>`, matching `SupplierPicker` and `MaterialPicker`: a PO master is
 * bounded, and a native select is what works at 375px and with a screen reader.
 *
 * **Empty is a normal first state.** A fresh tenant, or one whose POs are all still draft,
 * has nothing to offer — this renders an explanation and a link to purchase orders rather
 * than an empty dropdown that reads as broken.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Select } from '@erp/ui';

import { usePurchaseOrders } from '../hooks/use-procurement';
import type { PurchaseOrder } from '../types';

/** How a PO reads in a list of options: `PO-0042 · Al-Rashid Trading`. */
export function purchaseOrderOptionLabel(po: PurchaseOrder): string {
  return po.supplier ? `${po.poNumber} · ${po.supplier.name}` : po.poNumber;
}

/**
 * A PO is billable when it is OPEN and its embedded revision is ACTIVE. The list response
 * embeds exactly one revision — the highest-numbered (P14) — so a PO mid-revision shows its
 * DRAFT here and is correctly excluded; the create form re-resolves against the detail
 * response before showing the "System finds" summary.
 */
export function billablePurchaseOrders(pos: readonly PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter(
    (po) => po.status === 'OPEN' && po.revisions.some((r) => r.status === 'ACTIVE'),
  );
}

interface PurchaseOrderPickerProps {
  id: string;
  value: string;
  onChange: (purchaseOrderId: string) => void;
  /** Narrows the list to one supplier's POs — a bill names a supplier before its PO. */
  supplierId?: string;
  disabled?: boolean;
  required?: boolean;
}

export function PurchaseOrderPicker({
  id,
  value,
  onChange,
  supplierId,
  disabled,
  required,
}: PurchaseOrderPickerProps) {
  const t = useTranslations('procurement.bills.po');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');

  const orders = usePurchaseOrders(supplierId ? { supplierId } : undefined);

  const rows = useMemo(() => billablePurchaseOrders(orders.data ?? []), [orders.data]);

  if (orders.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-11 animate-pulse rounded-control bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (orders.isError) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  if (rows.length === 0) {
    return (
      <Alert variant="info" title={t('noneTitle')} messages={[t('noneBody')]}>
        <Link
          href="/procurement/purchase-orders"
          className="text-sm font-medium underline underline-offset-2"
        >
          {t('goToOrders')}
        </Link>
      </Alert>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      required={required}
      disabled={disabled}
      onChange={(value) => onChange(value)}
    >
      <option value="" disabled>
        —
      </option>
      {rows.map((po) => (
        <option key={po.id} value={po.id}>
          {purchaseOrderOptionLabel(po)}
        </option>
      ))}
    </Select>
  );
}
