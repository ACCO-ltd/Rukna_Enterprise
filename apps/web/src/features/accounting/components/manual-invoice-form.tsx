'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  cn,
  Combobox,
  DatePicker,
  entityTintClass,
  FormField,
  Input,
  Select,
  SideSheet,
} from '@erp/ui';
import type { ManualInvoiceInput, ManualInvoiceLineInput } from '@erp/types';

import { ClientForm } from '@/features/clients/components/client-form';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { fromMinorUnits, MONEY_SCALE, parseMinorUnits } from '@/lib/money';
import { prepareTotals, formatRate } from '@/features/commercial/components/prepare-invoice-dialog.model';

import { defaultDueDate } from '../invoice-actions';
import { todayWireDate } from '../invoice-overdue';
import { useIncomeAccounts, useSaveManualInvoice } from '../hooks/use-invoices';
import type { ClientInvoice } from '../types';
import { InvoiceTaxField, taxCodeBody, useInvoiceTaxChoice, useInvoiceTaxErrorMessage } from './invoice-tax-field';

const LIST_HREF = '/finance/accounting/invoices';
const TERMS = [
  { key: 'RECEIPT', days: 0 },
  { key: 'NET_15', days: 15 },
  { key: 'NET_30', days: 30 },
  { key: 'CUSTOM', days: null },
] as const;
type TermsKey = (typeof TERMS)[number]['key'];

interface LineDraft extends ManualInvoiceLineInput {
  key: number;
}

/** qty × rate in minor units, rounded half-up like the server (`priceManualLines`). */
function lineMinor(line: Pick<ManualInvoiceLineInput, 'quantity' | 'unitPrice'>): number | null {
  const qty = Number(line.quantity);
  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (!Number.isFinite(qty) || qty <= 0 || price === null || price <= 0) return null;
  // Quantity has up to 3 decimals: scale to an integer before multiplying, so no float drift.
  const qtyThousandths = Math.round(qty * 1000);
  return Math.round((qtyThousandths * price) / 1000);
}

function termsFromLabel(label: string | null): TermsKey {
  const found = TERMS.find((t) => t.key.replace('_', ' ').toLowerCase() === (label ?? '').toLowerCase());
  return found?.key ?? (label ? 'CUSTOM' : 'NET_15');
}

/**
 * ADR-048 — a hand-typed invoice for a sale outside any construction contract (equipment hire,
 * surplus materials, services). Mirrors the approved form mockup: who and when, then the lines
 * (Tab moves across, Enter on the last field adds a line), totals at the chosen tax code, Save
 * draft. A missing client is added in a side sheet without leaving the invoice. Contract billing
 * is not here — it stays on the source picker (ADR-037).
 */
export function ManualInvoiceForm({ invoice }: { invoice?: ClientInvoice }) {
  const t = useTranslations('accounting.invoices.manual');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const clients = useClients();
  const accounts = useIncomeAccounts();
  const save = useSaveManualInvoice(invoice?.id);
  const taxError = useInvoiceTaxErrorMessage();

  const today = todayWireDate();
  const [clientId, setClientId] = useState(invoice?.clientId ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate.slice(0, 10) ?? today);
  const [terms, setTerms] = useState<TermsKey>(termsFromLabel(invoice?.paymentTerms ?? null));
  const [customDue, setCustomDue] = useState(invoice?.dueDate?.slice(0, 10) ?? defaultDueDate(today, 15));
  const [currency, setCurrency] = useState(invoice?.currencyCode ?? 'USD');
  const defaultAccount = accounts.data?.[0]?.code ?? '';
  const [lines, setLines] = useState<LineDraft[]>(() =>
    invoice?.lines?.length
      ? invoice.lines.map((l, i) => ({ key: i, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, revenueAccountCode: l.revenueAccountCode }))
      : [{ key: 0, description: '', quantity: '1', unitPrice: '', revenueAccountCode: '' }],
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [newClientName, setNewClientName] = useState<string | null>(null);

  const tax = useInvoiceTaxChoice({ enabled: true, invoiceDate });

  const termDays = TERMS.find((x) => x.key === terms)?.days;
  const dueDate = termDays === null || termDays === undefined ? customDue : defaultDueDate(invoiceDate, termDays);

  const clientOptions = useMemo(
    () =>
      (clients.data ?? [])
        .filter((c) => c.status === 'ACTIVE')
        .map((c) => ({ value: c.id, label: c.name, hint: c.code })),
    [clients.data],
  );
  const client = (clients.data ?? []).find((c) => c.id === clientId) ?? null;

  // Lines with no account yet take the first income account once the list loads.
  const accountOf = (line: LineDraft) => line.revenueAccountCode || defaultAccount;

  const subtotalMinor = lines.reduce((sum, l) => sum + (lineMinor(l) ?? 0), 0);
  const totals = prepareTotals(fromMinorUnits(subtotalMinor, MONEY_SCALE), [], tax.rateFraction);
  const money = (value: string | null) => (value === null ? '—' : (formatMoney(value, currency, 'en') ?? value));

  // ── Validation (the server re-checks everything and lists its own problems) ────────────────
  const problems: string[] = [];
  if (!clientId) problems.push(t('errors.client'));
  if (dueDate < invoiceDate) problems.push(t('errors.dueBeforeDate'));
  lines.forEach((line, i) => {
    if (!line.description.trim()) problems.push(t('errors.description', { n: i + 1 }));
    if (lineMinor(line) === null) problems.push(t('errors.amount', { n: i + 1 }));
    if (!accountOf(line)) problems.push(t('errors.account', { n: i + 1 }));
  });
  const shown = attempted ? problems : [];

  const update = (key: number, patch: Partial<ManualInvoiceLineInput>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((current) => [...current, { key: nextKey, description: '', quantity: '1', unitPrice: '', revenueAccountCode: accountOf(current[current.length - 1] ?? ({} as LineDraft)) }]);
    setNextKey((k) => k + 1);
  };

  async function submit() {
    setAttempted(true);
    setServerProblems([]);
    if (problems.length > 0 || tax.blocked) return;
    const payload: ManualInvoiceInput = {
      clientId,
      invoiceDate,
      dueDate,
      currencyCode: currency,
      paymentTerms: t(`terms.${terms}`),
      ...taxCodeBody(tax),
      lines: lines.map((l) => ({
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        revenueAccountCode: accountOf(l),
      })),
    };
    try {
      const saved = await save.mutateAsync(payload);
      router.push(`${LIST_HREF}/${saved.id}`);
    } catch (error) {
      const fromServer = error instanceof ApiError ? error.details?.['problems'] : undefined;
      setServerProblems(
        Array.isArray(fromServer)
          ? fromServer.map(String)
          : [taxError(error) ?? (error instanceof Error && error.message ? error.message : t('saveFailed'))],
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="gap-1.5 px-2" asChild>
            <Link href={invoice ? `${LIST_HREF}/${invoice.id}` : LIST_HREF}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
          <h2 className="text-h1 font-bold text-foreground">{invoice ? t('editTitle') : t('title')}</h2>
        </div>
        <Button onClick={() => void submit()} disabled={save.isPending}>
          {save.isPending ? t('saving') : t('saveDraft')}
        </Button>
      </div>

      <p className="max-w-prose text-body-sm text-muted-foreground">{t('intro')}</p>

      {shown.length > 0 || serverProblems.length > 0 ? (
        <Alert variant="error" title={t('fixTitle')} messages={[...shown, ...serverProblems]} />
      ) : null}

      {/* ── Who and when ─────────────────────────────────────────────── */}
      <section className="rounded-panel border border-border bg-surface p-5" aria-labelledby="manual-who">
        <h3 id="manual-who" className="text-h2 font-semibold text-foreground">{t('whoTitle')}</h3>
        <p className="mt-0.5 text-body-sm text-muted-foreground">{t('whoSub')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField htmlFor="manual-client" label={t('client')} required>
            <Combobox
              id="manual-client"
              value={clientId}
              onChange={(next) => {
                setClientId(next);
                const c = (clients.data ?? []).find((x) => x.id === next);
                if (c?.defaultCurrency) setCurrency(c.defaultCurrency);
              }}
              options={clientOptions}
              placeholder={t('clientPlaceholder')}
              searchPlaceholder={t('clientSearch')}
              emptyLabel={t('clientEmpty')}
              loading={clients.isPending}
              loadingLabel={tCommon('loading')}
              footerAction={{ label: (q) => (q ? t('createClientNamed', { name: q }) : t('createClient')), onSelect: (q) => setNewClientName(q) }}
              invalid={attempted && !clientId}
            />
          </FormField>
          <FormField htmlFor="manual-currency" label={t('currency')} hint={t('currencyHint')}>
            <Input
              id="manual-currency"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="w-28 font-mono"
            />
          </FormField>
          {client ? (
            <p className="-mt-2 flex items-center gap-2 text-caption text-muted-foreground md:col-span-2">
              <Avatar name={client.name} size="sm" className={cn('rounded-control ring-0', entityTintClass(client.id))} />
              {client.name}
              {client.taxNumber ? ` · ${t('taxNumber', { number: client.taxNumber })}` : ''}
            </p>
          ) : null}
          <FormField htmlFor="manual-date" label={t('invoiceDate')} required>
            <DatePicker id="manual-date" value={invoiceDate} onChange={setInvoiceDate} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div>
              <p id="manual-terms-label" className="mb-1.5 text-body-sm font-medium text-foreground">{t('termsLabel')}</p>
              <div role="radiogroup" aria-labelledby="manual-terms-label" className="inline-flex overflow-hidden rounded-control border border-border-strong">
                {TERMS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={terms === option.key}
                    onClick={() => setTerms(option.key)}
                    className={cn(
                      'h-control whitespace-nowrap border-e border-border-strong px-2.5 text-body-sm last:border-e-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary',
                      terms === option.key ? 'bg-brand-accent font-semibold text-brand-primary' : 'text-muted-foreground hover:bg-surface-hover',
                    )}
                  >
                    {t(`terms.${option.key}`)}
                  </button>
                ))}
              </div>
            </div>
            <FormField htmlFor="manual-due" label={t('dueDate')} hint={terms === 'CUSTOM' ? undefined : t('dueHint')}>
              {terms === 'CUSTOM' ? (
                <DatePicker id="manual-due" value={customDue} onChange={setCustomDue} min={invoiceDate} />
              ) : (
                <Input id="manual-due" value={dueDate} readOnly className="tabular-nums" />
              )}
            </FormField>
          </div>
          <div className="md:col-span-2">
            <InvoiceTaxField choice={tax} id="manual-tax" disabled={save.isPending} />
          </div>
        </div>
      </section>

      {/* ── What you're billing ──────────────────────────────────────── */}
      <section className="rounded-panel border border-border bg-surface p-5" aria-labelledby="manual-lines">
        <h3 id="manual-lines" className="text-h2 font-semibold text-foreground">{t('linesTitle')}</h3>
        <p className="mt-0.5 text-body-sm text-muted-foreground">{t('linesSub')}</p>

        {accounts.data && accounts.data.length === 0 ? (
          <Alert className="mt-4" variant="warning" messages={[t('noIncomeAccounts')]} />
        ) : null}

        <div className="-mx-5 mt-4 overflow-x-auto px-5">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="w-8 pb-2 text-start font-medium">#</th>
                <th scope="col" className="pb-2 text-start font-medium">{t('colDescription')}</th>
                <th scope="col" className="w-24 pb-2 text-end font-medium">{t('colQty')}</th>
                <th scope="col" className="w-32 pb-2 pe-3 text-end font-medium">{t('colRate')}</th>
                <th scope="col" className="w-64 pb-2 ps-1 text-start font-medium">{t('colAccount')}</th>
                <th scope="col" className="w-32 pb-2 text-end font-medium">{t('colAmount')}</th>
                <th scope="col" className="w-10 pb-2"><span className="sr-only">{t('remove')}</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const minor = lineMinor(line);
                const isLast = i === lines.length - 1;
                return (
                  <tr key={line.key} className="border-t border-border align-top">
                    <td className="py-2 pt-4 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pe-2">
                      <Input
                        aria-label={t('lineDescription', { n: i + 1 })}
                        value={line.description}
                        maxLength={300}
                        onChange={(e) => update(line.key, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pe-2">
                      <Input
                        aria-label={t('lineQty', { n: i + 1 })}
                        inputMode="decimal"
                        value={line.quantity}
                        className="text-end tabular-nums"
                        onChange={(e) => update(line.key, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                      />
                    </td>
                    <td className="py-2 pe-2">
                      <Input
                        aria-label={t('lineRate', { n: i + 1 })}
                        inputMode="decimal"
                        value={line.unitPrice}
                        placeholder="0.00"
                        className="text-end tabular-nums"
                        onChange={(e) => update(line.key, { unitPrice: e.target.value.replace(/[^0-9.]/g, '') })}
                      />
                    </td>
                    <td className="py-2 pe-2">
                      <Select
                        id={`manual-line-account-${line.key}`}
                        aria-label={t('lineAccount', { n: i + 1 })}
                        value={accountOf(line)}
                        onChange={(value) => update(line.key, { revenueAccountCode: value })}
                      >
                        {(accounts.data ?? []).map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pt-4 text-end font-semibold tabular-nums">
                      {minor === null ? '—' : money(fromMinorUnits(minor, MONEY_SCALE))}
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                        aria-label={t('removeLine', { n: i + 1 })}
                        onKeyDown={(e) => {
                          // Enter on the last row's last control adds a line, as the mockup notes.
                          if (isLast && e.key === 'Enter') {
                            e.preventDefault();
                            addLine();
                          }
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Button type="button" variant="ghost" className="gap-1.5 text-brand-primary" onClick={addLine} disabled={lines.length >= 50}>
            <Plus size={16} aria-hidden="true" /> {t('addLine')}
          </Button>
          <dl className="w-full max-w-xs space-y-1.5 text-body-sm sm:ms-auto">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('subtotal')}</dt>
              <dd className="tabular-nums">{money(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {tax.rateFraction !== null ? t('taxAt', { rate: formatRate(tax.rateFraction) }) : t('tax')}
              </dt>
              <dd className="tabular-nums">{money(totals.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-body font-bold">
              <dt>{t('totalDue')}</dt>
              <dd className="tabular-nums">{money(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <SideSheet
        open={newClientName !== null}
        onOpenChange={(open) => (!open ? setNewClientName(null) : undefined)}
        title={t('newClientTitle')}
        description={t('newClientSub')}
        closeLabel={tCommon('close')}
      >
        {newClientName !== null ? (
          <ClientForm
            initialName={newClientName}
            onCreated={(created) => {
              void clients.refetch();
              setClientId(created.id);
              if (created.defaultCurrency) setCurrency(created.defaultCurrency);
              setNewClientName(null);
            }}
            onCancel={() => setNewClientName(null)}
          />
        ) : null}
      </SideSheet>
    </div>
  );
}
