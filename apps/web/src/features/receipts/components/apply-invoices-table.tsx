'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, cn, MoneyInput } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { applyOldestFirst, fromMinorUnits, toMinorUnits, type InvoiceOption } from '../allocation';

/**
 * How a payment is split over a client's open invoices: oldest due first (or all to one invoice,
 * from that invoice's Record payment) until the reader edits a line or ticks one; then the split
 * is theirs. Minor units throughout.
 */
export function useApplySplit(options: readonly InvoiceOption[], amountMinor: number, focusId: string | null = null) {
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const focus = focusId ? options.find((o) => o.invoice.id === focusId) : undefined;
  const suggested = focus
    ? new Map([[focus.invoice.id, Math.min(amountMinor, focus.outstandingMinor)]])
    : applyOldestFirst(amountMinor, options);

  const appliedFor = (id: string) => (manual ? toMinorUnits(manual[id] || '0') : (suggested.get(id) ?? 0));
  const appliedMinor = options.reduce((sum, o) => sum + appliedFor(o.invoice.id), 0);
  const overInvoice = options.find((o) => appliedFor(o.invoice.id) > o.outstandingMinor) ?? null;

  const edit = (id: string, value: string) =>
    setManual((current) => ({
      ...Object.fromEntries(options.map((o) => [o.invoice.id, fromMinorUnits(suggested.get(o.invoice.id) ?? 0)])),
      ...current,
      [id]: value,
    }));

  return {
    manual: manual !== null,
    appliedMinor,
    overInvoice,
    appliedFor,
    lineValue: (id: string) => (manual ? (manual[id] ?? '') : fromMinorUnits(suggested.get(id) ?? 0)),
    edit,
    /** Ticks a line paid in full (or clears it); returns the applied total after the change. */
    toggleFull: (option: InvoiceOption, on: boolean) => {
      edit(option.invoice.id, on ? fromMinorUnits(option.outstandingMinor) : '');
      return appliedMinor - appliedFor(option.invoice.id) + (on ? option.outstandingMinor : 0);
    },
    reset: () => setManual(null),
    allocations: () =>
      options
        .map((o) => ({ clientInvoiceId: o.invoice.id, amount: Number(fromMinorUnits(appliedFor(o.invoice.id))) }))
        .filter((a) => a.amount > 0),
  };
}

export type ApplySplit = ReturnType<typeof useApplySplit>;

/**
 * The client's open invoices with what this payment pays on each — the Receive payment form, the
 * Post dialog and Apply on-account money share it.
 */
export function ApplyInvoicesTable({
  options,
  split,
  amountMinor,
  amountLabel,
  onToggled,
}: {
  options: readonly InvoiceOption[];
  split: ApplySplit;
  /** What is being applied: the payment, or the money held on account. */
  amountMinor: number;
  amountLabel: string;
  /** After a line is ticked or cleared, with the new applied total (the form raises the amount). */
  onToggled?: (appliedMinor: number) => void;
}) {
  const t = useTranslations('platform.receipts.apply');
  const money = (minor: number) => formatMoney(fromMinorUnits(minor), 'USD') ?? fromMinorUnits(minor);
  const leftMinor = amountMinor - split.appliedMinor;
  const over = leftMinor < 0;

  // Oldest due first, the order the split fills them in.
  const byDue = [...options].sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));

  if (options.length === 0) {
    return <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-body-sm text-muted-foreground">{t('none')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-panel border border-border bg-surface">
        <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)_7rem_7rem_9rem] gap-3 border-b border-border bg-muted px-4 py-2 text-caption font-medium text-muted-foreground sm:grid">
          <span aria-hidden="true" />
          <span>{t('invoice')}</span>
          <span className="text-end">{t('due')}</span>
          <span className="text-end">{t('owed')}</span>
          <span className="text-end">{t('payment')}</span>
        </div>
        <ul className="divide-y divide-border">
          {byDue.map((o) => {
            const id = o.invoice.id;
            const ref = o.invoice.invoiceNumber ?? t('unnumbered');
            const applied = split.appliedFor(id);
            const full = applied > 0 && applied === o.outstandingMinor;
            return (
              <li
                key={id}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_8rem] items-center gap-3 px-4 py-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_7rem_7rem_9rem]"
              >
                <Checkbox
                  aria-label={t('payInFullOf', { ref })}
                  checked={full}
                  onChange={(e) => {
                    const appliedMinor = split.toggleFull(o, e.currentTarget.checked);
                    onToggled?.(appliedMinor);
                  }}
                />
                <label htmlFor={`apply-${id}`} className="min-w-0">
                  <span className="block truncate font-mono text-body-sm font-medium text-foreground">{ref}</span>
                  <span className="block text-caption text-muted-foreground sm:hidden">
                    {t('lineMobile', { due: formatDate(o.invoice.dueDate) ?? '—', owed: money(o.outstandingMinor) })}
                  </span>
                </label>
                <span className="hidden text-end text-body-sm tabular-nums text-muted-foreground sm:block">
                  {formatDate(o.invoice.dueDate) ?? '—'}
                </span>
                <span className="hidden text-end text-body-sm tabular-nums sm:block">{money(o.outstandingMinor)}</span>
                <MoneyInput
                  id={`apply-${id}`}
                  aria-label={t('paymentOn', { ref })}
                  aria-invalid={applied > o.outstandingMinor}
                  className="text-end"
                  value={split.lineValue(id)}
                  onValueChange={(value) => split.edit(id, value)}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {split.manual ? (
            <Button type="button" variant="link" className="h-auto px-0" onClick={split.reset}>
              {t('oldestFirst')}
            </Button>
          ) : null}
        </div>
        <dl className="w-full space-y-1.5 text-body-sm sm:max-w-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{amountLabel}</dt>
            <dd className="tabular-nums">{money(amountMinor)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('applied')}</dt>
            <dd className="tabular-nums">{money(split.appliedMinor)}</dd>
          </div>
          <div className={cn('flex justify-between border-t border-border pt-2 font-semibold', over && 'text-danger')}>
            <dt>{t('onAccount')}</dt>
            <dd className="tabular-nums">{money(leftMinor)}</dd>
          </div>
        </dl>
      </div>

      {split.overInvoice || over ? (
        <p role="alert" className="text-body-sm font-medium text-danger">
          {split.overInvoice
            ? t('overInvoice', { ref: split.overInvoice.invoice.invoiceNumber ?? t('unnumbered') })
            : t('overApplied', { applied: money(split.appliedMinor), amount: money(amountMinor) })}
        </p>
      ) : null}
    </div>
  );
}
