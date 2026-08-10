'use client';

/**
 * Purchase order creation (§12.6).
 *
 * Live since Tier A. This form was written during Sprint 5 and shipped behind a disabled
 * entry point, because `POST /procurement/purchase-orders` requires a `supplierId` and no
 * endpoint listed suppliers (A3 / #26). Turning it on cost a `SupplierPicker` and the
 * deletion of a flag, exactly as the note here predicted — which is the argument for
 * building the screen rather than deferring it, and against leaving the flag in place a
 * day longer than the blocker it described.
 *
 * The supplier list is empty on a fresh tenant — nothing in `prisma/seeds/` creates one —
 * so `SupplierPicker` renders a link to the Suppliers screen rather than an empty select.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import {
  useCreatePurchaseOrder,
  useMaterialRequests,
  useSpendCategories,
} from '../hooks/use-procurement';
import { moneyToApi, quantityToApi } from '../quantities';
import type { CreatePoLinePayload } from '../types';
import { PoLineEditor, emptyPoLine, poLineError, type PoLineDraft } from './po-line-editor';
import { SupplierPicker } from './supplier-picker';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PoForm() {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [supplierId, setSupplierId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('SAR');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [lines, setLines] = useState<PoLineDraft[]>([emptyPoLine('line-1')]);
  const [showErrors, setShowErrors] = useState(false);

  const ids = {
    supplier: useId(),
    currency: useId(),
    effective: useId(),
    address: useId(),
    expected: useId(),
  };

  const create = useCreatePurchaseOrder();
  const spendCategories = useSpendCategories();
  // Only APPROVED requests can be allocated against — earlier statuses have no approved
  // quantity, and later ones are already fully ordered.
  const approvedRequests = useMaterialRequests({ status: 'APPROVED' });

  const hasLineError = lines.some((l) => poLineError(l) !== null);

  function handleSubmit() {
    setShowErrors(true);
    if (hasLineError || !supplierId) return;

    create.mutate(
      {
        supplierId,
        currencyCode,
        effectiveFrom,
        ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
        ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
        lines: lines.map((line): CreatePoLinePayload => {
          const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0;
          const price = parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0;
          return {
            lineType: line.lineType,
            description: line.description.trim(),
            uomCode: line.material?.baseUom?.code ?? line.uomCode,
            orderedQuantity: quantityToApi(qty),
            unitPrice: moneyToApi(price),
            ...(line.material ? { materialCode: line.material.code } : {}),
            ...(line.spendCategoryId ? { spendCategoryId: line.spendCategoryId } : {}),
            ...(line.allocations.length ? { mrLineAllocations: line.allocations } : {}),
          };
        }),
      },
      { onSuccess: (po) => router.push(`/procurement/orders/${po.id}`) },
    );
  }

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <ol className="mt-3 flex gap-4 text-sm">
          <li aria-current={step === 1 ? 'step' : undefined}>
            <span className={step === 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
              1. {tc('description')}
            </span>
          </li>
          <li aria-current={step === 2 ? 'step' : undefined}>
            <span className={step === 2 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
              2. {tc('lines')}
            </span>
          </li>
        </ol>
      </div>

      {step === 1 ? (
        <div className="max-w-xl space-y-4">
          <FormField htmlFor={ids.supplier} label={tc('supplier')}>
            <SupplierPicker
              id={ids.supplier}
              value={supplierId}
              onChange={setSupplierId}
              required
            />
          </FormField>

          <FormField htmlFor={ids.currency} label={tc('currency')}>
            <Input
              id={ids.currency}
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </FormField>

          <FormField htmlFor={ids.effective} label={t('effectiveFrom')}>
            <Input
              id={ids.effective}
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </FormField>

          <FormField
            htmlFor={ids.address}
            label={`${t('deliveryAddress')} (${tc('optional')})`}
          >
            <Input
              id={ids.address}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
            />
          </FormField>

          <FormField
            htmlFor={ids.expected}
            label={`${t('expectedDelivery')} (${tc('optional')})`}
          >
            <Input
              id={ids.expected}
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={() => setStep(2)}>
              {tc('next')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <PoLineEditor
            lines={lines}
            onChange={setLines}
            spendCategories={spendCategories.data ?? []}
            approvedRequests={approvedRequests.data ?? []}
            currencyCode={currencyCode}
            showErrors={showErrors}
          />

          {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {tc('back')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={create.isPending}>
              {tc('create')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
