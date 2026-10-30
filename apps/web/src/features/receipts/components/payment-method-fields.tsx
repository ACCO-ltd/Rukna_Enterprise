'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CreditCard, Landmark, Paperclip, ScrollText, Smartphone, X } from 'lucide-react';
import { Button, cn, DatePicker, FormField, Input, Select } from '@erp/ui';

import type { ReceiptPaymentMethod } from '@/lib/api-types';

import {
  CARD_TYPES,
  MOBILE_MONEY_PROVIDERS,
  PROOF_FIELDS,
  RECEIPT_PAYMENT_METHODS,
  type ProofField,
  type ProofProblem,
  type ProofValues,
} from '../payment-methods';

const ICONS: Record<ReceiptPaymentMethod, typeof Landmark> = {
  BANK_TRANSFER: Landmark,
  CHEQUE: ScrollText,
  CASH: Banknote,
  MOBILE_MONEY: Smartphone,
  CARD: CreditCard,
};

/** The method as five tiles: one choice, required. */
export function PaymentMethodPicker({
  value,
  onChange,
  error,
}: {
  value: ReceiptPaymentMethod | '';
  onChange: (method: ReceiptPaymentMethod) => void;
  error?: string;
}) {
  const t = useTranslations('platform.receipts.method');
  const tCreate = useTranslations('platform.receipts.create');
  return (
    <div className="space-y-1.5">
      <p id="receipt-method-label" className="text-body-sm font-medium text-foreground">
        {tCreate('method')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="receipt-method-label"
        aria-invalid={Boolean(error)}
        className="grid grid-cols-2 gap-2 sm:grid-cols-5"
      >
        {RECEIPT_PAYMENT_METHODS.map((method) => {
          const Icon = ICONS[method];
          const on = value === method;
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(method)}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-1 rounded-control border text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-primary',
                on
                  ? 'border-brand-primary bg-brand-accent text-brand-primary'
                  : 'border-border bg-surface text-foreground hover:border-border-interactive',
              )}
            >
              <Icon size={18} aria-hidden="true" />
              {t(method)}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The proof the chosen method asks for (PM-1). */
export function PaymentProofFields({
  method,
  values,
  onChange,
  problems,
}: {
  method: ReceiptPaymentMethod;
  values: ProofValues;
  onChange: (field: ProofField, value: string) => void;
  /** Shown once the reader has tried to save. */
  problems: Partial<Record<ProofField, ProofProblem>>;
}) {
  const t = useTranslations('platform.receipts.proof');
  const tProvider = useTranslations('platform.receipts.provider');
  const tCard = useTranslations('platform.receipts.cardType');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PROOF_FIELDS[method].map(({ field, input, required }) => {
        const id = `proof-${field}`;
        const label = t(`${method}.${field}`);
        const problem = problems[field];
        const value = values[field] ?? '';
        return (
          <FormField
            key={field}
            htmlFor={id}
            label={required ? label : t('optional', { label })}
            error={problem ? t(`problem.${problem}`) : undefined}
          >
            {input === 'date' ? (
              <DatePicker id={id} value={value} onChange={(v) => onChange(field, v)} />
            ) : input === 'provider' || input === 'card' ? (
              <Select id={id} value={value} onChange={(v) => onChange(field, v)}>
                <option value="">{t('choose')}</option>
                {(input === 'provider' ? MOBILE_MONEY_PROVIDERS : CARD_TYPES).map((option) => (
                  <option key={option} value={option}>
                    {input === 'provider' ? tProvider(option) : tCard(option)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                value={value}
                aria-invalid={Boolean(problem)}
                inputMode={input === 'last4' || input === 'phone' ? 'numeric' : undefined}
                maxLength={input === 'last4' ? 4 : field === 'payerName' ? 150 : 60}
                placeholder={input === 'phone' ? '61 555 5555' : undefined}
                className={cn(field === 'instrumentNumber' && 'font-mono')}
                onChange={(e) => onChange(field, e.target.value)}
              />
            )}
          </FormField>
        );
      })}
    </div>
  );
}

/** An optional proof file (photo of the cheque, SMS screenshot, bank advice); attached on save. */
export function ProofFilePicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const t = useTranslations('platform.receipts.proof');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label={t('file')}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {file ? (
        <span className="inline-flex max-w-full items-center gap-2 rounded-control border border-border bg-surface px-3 py-1.5 text-body-sm">
          <Paperclip size={14} aria-hidden="true" />
          <span className="truncate">{file.name}</span>
          <button type="button" aria-label={t('removeFile')} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Paperclip size={14} aria-hidden="true" />
          {t('file')}
        </Button>
      )}
    </div>
  );
}
