'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, Combobox, Input, Select } from '@erp/ui';

import { useClients } from '@/features/clients/hooks/use-clients';
import { ApiError } from '@/lib/api-client';
import { parseMinorUnits, MONEY_SCALE } from '@/lib/money';

import { defaultDueDate } from '../invoice-actions';
import { todayWireDate } from '../invoice-overdue';
import { useIncomeAccounts, useSaveManualInvoice } from '../hooks/use-invoices';

export interface QuickAddInvoiceHandle {
  open: () => void;
}

/**
 * The quick-add row at the top of the invoice list (ADR-047 list design, ADR-048): a one-line sale
 * invoice — client, what it is for, amount, income account — saved as a DRAFT with today's date and
 * Net 15, without leaving the list. Anything more (several lines, other terms, tax choice) is the
 * full "Other sale" form. Contract billing never goes through here (ADR-037).
 */
export const QuickAddInvoice = forwardRef<QuickAddInvoiceHandle, { onCreated?: (id: string) => void }>(
  function QuickAddInvoice({ onCreated }, ref) {
    const t = useTranslations('accounting.invoices.quickAdd');
    const clients = useClients();
    const accounts = useIncomeAccounts();
    const save = useSaveManualInvoice();
    const [open, setOpen] = useState(false);
    const [clientId, setClientId] = useState('');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [account, setAccount] = useState('');
    const [error, setError] = useState<string | null>(null);
    const firstField = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      open: () => {
        setOpen(true);
        setTimeout(() => firstField.current?.querySelector<HTMLElement>('button, input')?.focus(), 0);
      },
    }));

    const reset = () => {
      setClientId('');
      setDescription('');
      setAmount('');
      setError(null);
      setOpen(false);
    };

    const chosenAccount = account || accounts.data?.[0]?.code || '';
    const amountMinor = parseMinorUnits(amount, MONEY_SCALE);
    const ready = clientId !== '' && description.trim() !== '' && amountMinor !== null && amountMinor > 0 && chosenAccount !== '';

    async function submit() {
      if (!ready) {
        setError(t('incomplete'));
        return;
      }
      setError(null);
      const today = todayWireDate();
      const client = (clients.data ?? []).find((c) => c.id === clientId);
      try {
        const saved = await save.mutateAsync({
          clientId,
          invoiceDate: today,
          dueDate: defaultDueDate(today, 15),
          currencyCode: client?.defaultCurrency ?? 'USD',
          paymentTerms: t('terms'),
          lines: [{ description: description.trim(), quantity: '1', unitPrice: amount, revenueAccountCode: chosenAccount }],
        });
        reset();
        onCreated?.(saved.id);
      } catch (err) {
        const problems = err instanceof ApiError ? err.details?.['problems'] : undefined;
        setError(Array.isArray(problems) ? problems.map(String).join(' ') : t('failed'));
      }
    }

    if (!open) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2 text-body-sm font-medium text-brand-primary hover:bg-brand-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <Plus size={16} aria-hidden="true" />
          {t('open')}
          <kbd className="ms-1 hidden rounded border border-border px-1 font-mono text-micro text-muted-foreground md:inline">N</kbd>
        </button>
      );
    }

    return (
      <form
        className="space-y-2"
        aria-label={t('formLabel')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            reset();
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
          <span className="w-20 shrink-0 text-body-sm text-muted-foreground">{t('newDraft')}</span>
          <div ref={firstField} className="w-56 shrink-0">
            <Combobox
              id="quick-add-client"
              aria-label={t('client')}
              value={clientId}
              onChange={setClientId}
              options={(clients.data ?? [])
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
              placeholder={t('client')}
              searchPlaceholder={t('clientSearch')}
              emptyLabel={t('clientEmpty')}
              loading={clients.isPending}
            />
          </div>
          <Input
            aria-label={t('description')}
            placeholder={t('description')}
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            className="min-w-48 flex-1"
          />
          <Input
            aria-label={t('amount')}
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-28 shrink-0 text-end tabular-nums"
          />
          <div className="w-52 shrink-0">
            <Select id="quick-add-account" aria-label={t('account')} value={chosenAccount} onChange={setAccount}>
              {(accounts.data ?? []).map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            {t('cancel')}
          </Button>
        </div>
        <p className="text-caption text-muted-foreground" role={error ? 'alert' : undefined}>
          {error ?? (accounts.isError || clients.isError ? t('pickersFailed') : t('hint'))}
        </p>
      </form>
    );
  },
);
