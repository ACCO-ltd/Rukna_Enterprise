'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, cn, FormField, Input, Select } from '@erp/ui';
import { Hash } from 'lucide-react';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { LoadError } from '@/components/load-error';
import { ApiError } from '@/lib/api-client';

import { useInvoiceNumbering, useUpdateInvoiceNumbering } from '../hooks/use-accounting';
import { previewInvoiceNumber, RESET_POLICIES, SUGGESTED_DIGITS } from '../invoice-number-format';
import { todayWireDate } from '../invoice-overdue';
import type { InvoiceNumbering, NumberResetPolicy } from '../types';

const DIGITS = [3, 4, 5, 6, 7, 8];

/**
 * CI-8 — Invoice settings → Invoice numbering: the format (a running number, or the invoice date's
 * year, month or day with a count that restarts), the prefix, the digits and the next number. The
 * server refuses a next number at or below one already issued in that format.
 */
export function InvoiceNumberingSettings() {
  const t = useTranslations('accounting.invoiceNumbering');
  const numbering = useInvoiceNumbering();
  if (numbering.isError) return <LoadError message={t('loadFailed')} onRetry={() => void numbering.refetch()} />;
  if (!numbering.data) return null;
  return <NumberingForm key={numbering.data.updatedAt ?? 'default'} saved={numbering.data} />;
}

function NumberingForm({ saved }: { saved: InvoiceNumbering }) {
  const t = useTranslations('accounting.invoiceNumbering');
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);
  const save = useUpdateInvoiceNumbering();
  const baseId = useId();
  const today = todayWireDate();

  const [policy, setPolicy] = useState<NumberResetPolicy>(saved.resetPolicy);
  const [prefix, setPrefix] = useState(saved.prefix);
  const [digits, setDigits] = useState(saved.paddingLength);
  const [next, setNext] = useState(String(saved.nextNumber));

  const nextNumber = Number(next);
  const validNext = /^\d+$/.test(next) && nextNumber >= 1;
  const format = { prefix: prefix.trim(), resetPolicy: policy, paddingLength: digits };
  const dirty =
    format.prefix !== saved.prefix || policy !== saved.resetPolicy || digits !== saved.paddingLength || nextNumber !== saved.nextNumber;
  const disabled = !mayManage || save.isPending;

  const choose = (value: NumberResetPolicy) => {
    setPolicy(value);
    setDigits(value === saved.resetPolicy ? saved.paddingLength : SUGGESTED_DIGITS[value]);
    // A new format starts its own count; the saved one keeps where it is.
    setNext(String(value === saved.resetPolicy ? saved.nextNumber : 1));
  };

  const error = save.isError ? (save.error instanceof ApiError ? save.error.message : t('saveFailed')) : null;

  return (
    <form
      className="space-y-4 rounded-panel border border-border bg-surface p-4"
      aria-labelledby={`${baseId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!validNext) return;
        save.mutate({ ...format, nextNumber });
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand-subtle text-brand-ink [&>svg]:size-4"
          >
            <Hash />
          </span>
          <div>
            <h3 id={`${baseId}-title`} className="text-sm font-semibold text-foreground">
              {t('title')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('next')}{' '}
              <span className="font-mono font-semibold text-foreground">
                {validNext ? previewInvoiceNumber(format, today, nextNumber) : '—'}
              </span>
            </p>
          </div>
        </div>
        {mayManage ? (
          <Button type="submit" size="sm" disabled={!dirty || !validNext || save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        ) : null}
      </div>

      <div role="radiogroup" aria-label={t('format')} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {RESET_POLICIES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={policy === value}
            disabled={disabled}
            onClick={() => choose(value)}
            className={cn(
              'min-h-11 rounded-control border px-3 py-2 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed',
              policy === value ? 'border-brand-primary bg-brand-accent' : 'border-border-strong hover:bg-surface-hover',
            )}
          >
            <span className={cn('block text-body-sm font-semibold', policy === value ? 'text-brand-primary' : 'text-foreground')}>
              {t(`policy.${value}`)}
            </span>
            <span className="block font-mono text-caption text-muted-foreground">
              {previewInvoiceNumber({ prefix: format.prefix, resetPolicy: value, paddingLength: SUGGESTED_DIGITS[value] }, today, 1)}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField htmlFor={`${baseId}-prefix`} label={t('prefix')}>
          <Input
            id={`${baseId}-prefix`}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            maxLength={10}
            disabled={disabled}
            autoComplete="off"
            className="font-mono"
          />
        </FormField>
        <FormField htmlFor={`${baseId}-digits`} label={t('digits')}>
          <Select id={`${baseId}-digits`} value={String(digits)} onChange={(v) => setDigits(Number(v))} disabled={disabled}>
            {DIGITS.map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          htmlFor={`${baseId}-next`}
          label={policy === 'NEVER' ? t('nextNumber') : t(`nextNumberIn.${policy}`)}
          error={next !== '' && !validNext ? t('nextInvalid') : undefined}
        >
          <Input
            id={`${baseId}-next`}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            disabled={disabled}
            autoComplete="off"
            className="tabular-nums"
          />
        </FormField>
      </div>

      {policy !== 'NEVER' ? <p className="text-caption text-muted-foreground">{t('dateNote')}</p> : null}
      {error ? <Alert variant="error" messages={[error]} /> : null}
    </form>
  );
}
