'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  MoneyInput,
  Select,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { formatDate, formatMoney } from '@/lib/format';
import { toDecimalString } from '@/features/contracts/contract-form-payload';

import {
  allocationProblem,
  fromMinorUnits,
  invoicesForClient,
  toMinorUnits,
  unallocatedMinor,
} from '../allocation';
import { useAllocateToInvoice, useReverseAllocation } from '../hooks/use-receipts';
import type { ReceiptDetail, ReceiptAllocation } from '../types';

const INVOICE_HREF = (id: string) => `/finance/accounting/invoices/${id}`;

export function ReceiptAllocationsPanel({ receipt }: { receipt: ReceiptDetail }) {
  const t = useTranslations('platform.receipts.allocations');
  const locale = useLocale() as 'en' | 'ar';
  const [isAllocating, setIsAllocating] = useState(false);
  const [pendingReversal, setPendingReversal] = useState<ReceiptAllocation | null>(null);

  const reverse = useReverseAllocation(receipt.id);
  const remainingMinor = unallocatedMinor(receipt);

  // Invoice references for the rows — an allocation carries only `clientInvoiceId`, so the
  // client's invoices (already fetched for the picker; TanStack shares the cache) label them.
  const invoices = useInvoices(receipt.clientId);
  const invoiceById = useMemo(
    () =>
      new Map(
        (invoices.data ?? []).map((inv) => [
          inv.id,
          inv.invoiceNumber ?? `#${inv.id.slice(-8)}`,
        ]),
      ),
    [invoices.data],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {remainingMinor > 0 ? (
          <Button size="sm" onClick={() => setIsAllocating(true)}>
            {t('add')}
          </Button>
        ) : null}
      </div>

      {receipt.allocations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {receipt.allocations.map((allocation) => {
            const reversed = allocation.postingStatus === 'REVERSED';
            return (
              <li
                key={allocation.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    <Link
                      href={INVOICE_HREF(allocation.clientInvoiceId)}
                      className="underline-offset-4 hover:underline"
                    >
                      {invoiceById.get(allocation.clientInvoiceId) ??
                        allocation.clientInvoiceId.slice(-8)}
                    </Link>
                    {reversed ? (
                      <Badge tone="warning" className="ms-2">
                        {t('reversed')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(allocation.allocationDate, locale)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  <bdi>{formatMoney(allocation.allocatedAmount, receipt.currencyCode, locale)}</bdi>
                </p>
                {!reversed ? (
                  <Button variant="ghost" size="sm" onClick={() => setPendingReversal(allocation)}>
                    {t('reverse')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAllocating ? (
        <AllocateDialog receipt={receipt} onClose={() => setIsAllocating(false)} />
      ) : null}

      {pendingReversal ? (
        <ConfirmActionDialog
          title={t('reverseTitle')}
          description={t('reverseBody')}
          confirmLabel={t('reverse')}
          isPending={reverse.isPending}
          errorMessage={reverse.isError ? t('reverseFailed') : undefined}
          onConfirm={() => {
            reverse.mutate(pendingReversal.id, {
              onSuccess: () => setPendingReversal(null),
            });
          }}
          onDismiss={() => {
            reverse.reset();
            setPendingReversal(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface AllocateFormValues {
  clientInvoiceId: string;
  amount: string;
}

function AllocateDialog({ receipt, onClose }: { receipt: ReceiptDetail; onClose: () => void }) {
  const t = useTranslations('platform.receipts.allocations');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const allocate = useAllocateToInvoice(receipt.id);
  const invoices = useInvoices(receipt.clientId);
  const isLoading = invoices.isPending;

  const options = useMemo(
    () => invoicesForClient(invoices.data ?? [], receipt.clientId),
    [invoices.data, receipt.clientId],
  );

  const remainingMinor = unallocatedMinor(receipt);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AllocateFormValues>({
    defaultValues: { clientInvoiceId: '', amount: '' },
  });

  const selectedId = useWatch({ control, name: 'clientInvoiceId' });
  const selected = options.find((o) => o.invoice.id === selectedId) ?? null;

  // Cap the "allocate the full balance" shortcut at whichever is smaller: the receipt's
  // unallocated balance or the invoice's outstanding.
  const capMinor = selected ? Math.min(remainingMinor, selected.outstandingMinor) : remainingMinor;

  const onSubmit = (values: AllocateFormValues) => {
    allocate.mutate(
      {
        clientInvoiceId: values.clientInvoiceId,
        amount: Number(toDecimalString(values.amount)),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (!next && !allocate.isPending ? onClose() : undefined)}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (allocate.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (allocate.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('add')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {allocate.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}
          {!isLoading && options.length === 0 ? (
            <Alert variant="info" messages={[t('noInvoices')]} />
          ) : null}

          <FormField
            htmlFor="allocation-invoice"
            label={t('invoice')}
            error={errors.clientInvoiceId?.message}
          >
            <Select
              id="allocation-invoice"
              disabled={isLoading || options.length === 0}
              aria-invalid={Boolean(errors.clientInvoiceId)}
              {...register('clientInvoiceId', { required: t('invoiceRequired') })}
            >
              <option value="">
                {isLoading ? tCommon('loading') : t('invoicePlaceholder')}
              </option>
              {options.map(({ invoice, outstandingMinor }) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber ?? invoice.id.slice(-8)} —{' '}
                  {formatMoney(fromMinorUnits(outstandingMinor), receipt.currencyCode, locale)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField htmlFor="allocation-amount" label={t('amount')} error={errors.amount?.message}>
            <Controller
              name="amount"
              control={control}
              rules={{
                validate: (v) => {
                  const problem = allocationProblem(v, remainingMinor, selected?.outstandingMinor);
                  return problem === null || t(problem);
                },
              }}
              render={({ field }) => (
                <MoneyInput
                  id="allocation-amount"
                  aria-describedby="allocation-remaining"
                  aria-invalid={Boolean(errors.amount)}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
              )}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="allocation-remaining" className="text-xs text-muted-foreground">
                <bdi>
                  {t('remaining', {
                    amount:
                      formatMoney(fromMinorUnits(remainingMinor), receipt.currencyCode, locale) ?? '',
                  })}
                </bdi>
                {selected ? (
                  <>
                    {' · '}
                    <bdi>
                      {t('outstanding', {
                        amount:
                          formatMoney(
                            fromMinorUnits(selected.outstandingMinor),
                            receipt.currencyCode,
                            locale,
                          ) ?? '',
                      })}
                    </bdi>
                  </>
                ) : null}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!selected}
                onClick={() => {
                  setValue('amount', fromMinorUnits(capMinor), { shouldValidate: true });
                }}
              >
                {t('allocateAll')}
              </Button>
            </div>
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={allocate.isPending || options.length === 0}>
              {allocate.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={allocate.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Exported for the detail header, which shows the same figures above the panel. */
export function receiptTotals(receipt: ReceiptDetail) {
  return {
    total: toMinorUnits(receipt.totalAmount),
    allocated: toMinorUnits(receipt.allocatedAmount),
    remaining: toMinorUnits(receipt.unallocatedAmount),
  };
}
