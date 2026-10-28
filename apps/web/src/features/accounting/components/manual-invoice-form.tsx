'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  cn,
  Combobox,
  DatePicker,
  entityTintClass,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LifecycleStepper,
  LineItemsEditor,
  type LineColumn,
  MoneyInput,
  QuantityInput,
  Select,
  SideSheet,
} from '@erp/ui';
import type { ManualInvoiceInput, ManualInvoiceLineInput } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { ClientForm } from '@/features/clients/components/client-form';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { fromMinorUnits, MONEY_SCALE, parseMinorUnits } from '@/lib/money';
import { prepareTotals, formatRate } from '@/features/commercial/components/prepare-invoice-dialog.model';

import { defaultDueDate } from '../invoice-actions';
import { todayWireDate } from '../invoice-overdue';
import { useIncomeAccounts, useSaveManualInvoice } from '../hooks/use-invoices';
import type { ClientInvoice } from '../types';
import { InvoiceTaxField, taxCodeBody, useInvoiceTaxChoice, useInvoiceTaxErrorMessage } from './invoice-tax-field';

const LIST_HREF = '/finance/accounting/invoices';
const LIFECYCLE_KEYS = ['DRAFT', 'APPROVED', 'POSTED'] as const;
const MAX_LINES = 50;
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
  const tCreate = useTranslations('accounting.invoices.create');
  const summaryRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const clients = useClients();
  const accounts = useIncomeAccounts();
  const save = useSaveManualInvoice(invoice?.id);
  const taxError = useInvoiceTaxErrorMessage();

  const today = todayWireDate();
  // "New sale invoice for …" (⌘K) arrives with the client chosen.
  const searchParams = useSearchParams();
  const [clientId, setClientId] = useState(invoice?.clientId ?? searchParams?.get('clientId') ?? '');
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
  // Each problem names its field, so the summary links to it and the field shows it too (ADR-037).
  const lineId = (key: number, field: string) => `manual-line-${field}-${key}`;
  const fieldErrors: FormFieldError[] = [];
  const lineErrors = new Map<number, Partial<Record<string, string>>>();
  if (!clientId) fieldErrors.push({ fieldId: 'manual-client', label: t('client'), message: t('errors.client') });
  if (dueDate < invoiceDate)
    fieldErrors.push({ fieldId: terms === 'CUSTOM' ? 'manual-due' : 'manual-date', label: t('dueDate'), message: t('errors.dueBeforeDate') });
  lines.forEach((line, i) => {
    const errors: Partial<Record<string, string>> = {};
    const add = (field: string, label: string, message: string) => {
      errors[field] = message;
      fieldErrors.push({ fieldId: lineId(line.key, field), label, message });
    };
    if (!line.description.trim()) add('description', t('lineDescription', { n: i + 1 }), t('errors.description', { n: i + 1 }));
    if (lineMinor(line) === null) add('unitPrice', t('lineRate', { n: i + 1 }), t('errors.amount', { n: i + 1 }));
    if (!accountOf(line)) add('account', t('lineAccount', { n: i + 1 }), t('errors.account', { n: i + 1 }));
    lineErrors.set(i, errors);
  });
  const shownErrors = attempted ? fieldErrors : [];
  const shownFor = (fieldId: string) => shownErrors.find((e) => e.fieldId === fieldId)?.message;

  // Unsaved changes: anything different from what the form opened with.
  const snapshot = JSON.stringify({ clientId, invoiceDate, terms, customDue, currency, lines: lines.map((l) => [l.description, l.quantity, l.unitPrice, l.revenueAccountCode]) });
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const backHref = invoice ? `${LIST_HREF}/${invoice.id}` : LIST_HREF;
  const leave = () => router.push(backHref);

  const update = (key: number, patch: Partial<ManualInvoiceLineInput>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    if (lines.length >= MAX_LINES) return;
    setLines((current) => [...current, { key: nextKey, description: '', quantity: '1', unitPrice: '', revenueAccountCode: accountOf(current[current.length - 1] ?? ({} as LineDraft)) }]);
    setNextKey((k) => k + 1);
  };
  // Enter in a line never submits the form; on the last line it adds the next one (the mockup).
  const lineEnter = (index: number) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (index === lines.length - 1) addLine();
  };

  async function submit() {
    setAttempted(true);
    setServerProblems([]);
    if (fieldErrors.length > 0 || tax.blocked) {
      summaryRef.current?.scrollIntoView({ block: 'start' });
      return;
    }
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

  const columns: LineColumn<LineDraft>[] = [
    {
      key: 'description',
      header: t('colDescription'),
      required: true,
      width: 'minmax(14rem,2fr)',
      controlId: (i) => lineId(lines[i]!.key, 'description'),
      cell: (line, i) => (
        <Input
          id={lineId(line.key, 'description')}
          aria-label={t('lineDescription', { n: i + 1 })}
          value={line.description}
          maxLength={300}
          aria-invalid={Boolean(attempted && lineErrors.get(i)?.description)}
          onKeyDown={lineEnter(i)}
          onChange={(e) => update(line.key, { description: e.target.value })}
        />
      ),
    },
    {
      key: 'quantity',
      header: t('colQty'),
      required: true,
      width: '6.5rem',
      controlId: (i) => lineId(lines[i]!.key, 'quantity'),
      cell: (line, i) => (
        <QuantityInput
          id={lineId(line.key, 'quantity')}
          aria-label={t('lineQty', { n: i + 1 })}
          value={line.quantity}
          autoComplete="off"
          onKeyDown={lineEnter(i)}
          onValueChange={(quantity) => update(line.key, { quantity })}
        />
      ),
    },
    {
      key: 'unitPrice',
      header: t('colRate'),
      required: true,
      width: '8.5rem',
      controlId: (i) => lineId(lines[i]!.key, 'unitPrice'),
      cell: (line, i) => (
        <MoneyInput
          id={lineId(line.key, 'unitPrice')}
          aria-label={t('lineRate', { n: i + 1 })}
          value={line.unitPrice}
          currencyMark={currency === 'USD' ? '$' : null}
          autoComplete="off"
          aria-invalid={Boolean(attempted && lineErrors.get(i)?.unitPrice)}
          onKeyDown={lineEnter(i)}
          onValueChange={(unitPrice) => update(line.key, { unitPrice })}
        />
      ),
    },
    {
      key: 'account',
      header: t('colAccount'),
      required: true,
      // A fraction track, so the phone card gives the account name the full width.
      width: 'minmax(13rem,1fr)',
      controlId: (i) => lineId(lines[i]!.key, 'account'),
      cell: (line, i) => (
        <Select
          id={lineId(line.key, 'account')}
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
      ),
    },
    {
      key: 'amount',
      header: t('colAmount'),
      width: '8.5rem',
      align: 'end',
      cell: (line) => {
        const minor = lineMinor(line);
        return (
          <span className="block pt-2 font-semibold tabular-nums">
            {minor === null ? '—' : money(fromMinorUnits(minor, MONEY_SCALE))}
          </span>
        );
      },
    },
  ];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormActionBar
        back={
          <Button variant="ghost" className="gap-1.5 px-2" asChild>
            <Link href={backHref}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
        }
        save={
          <Button type="submit" disabled={save.isPending || tax.blocked}>
            {save.isPending ? t('saving') : t('saveDraft')}
          </Button>
        }
        discard={
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
            {t('discard')}
          </Button>
        }
        saveState={dirty ? 'dirty' : invoice ? 'clean' : 'new'}
        saveStateLabels={{
          new: tCommon('formState.new'),
          dirty: tCommon('formState.dirty'),
          clean: tCommon('formState.clean'),
        }}
        lifecycle={
          <LifecycleStepper
            steps={LIFECYCLE_KEYS.map((key) => ({ key, label: tCreate(`lifecycle.${key}`) }))}
            current="DRAFT"
            stepOfLabel={(n, total) => tCreate('stepOf', { n, total })}
          />
        }
      />

      <div className="space-y-8">
        <header className="space-y-1">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{t('eyebrow')}</p>
          <h2 className="text-h2 font-semibold text-foreground">{invoice ? t('editTitle') : t('title')}</h2>
          <p className="max-w-prose text-body-sm text-muted-foreground">{t('intro')}</p>
        </header>

        <div ref={summaryRef} className="scroll-mt-32">
          {shownErrors.length > 0 || serverProblems.length > 0 ? (
            <FormErrorSummary errors={shownErrors} formErrors={serverProblems} />
          ) : null}
        </div>

        {clients.isError || accounts.isError ? (
          <LoadError
            message={t('pickersLoadFailed')}
            onRetry={() => {
              if (clients.isError) void clients.refetch();
              if (accounts.isError) void accounts.refetch();
            }}
          />
        ) : null}

        <FormGroup title={t('whoTitle')} description={t('whoSub')}>
          <FormField htmlFor="manual-client" label={t('client')} required error={shownFor('manual-client')}>
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
              invalid={Boolean(shownFor('manual-client'))}
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
            <p className="-mt-2 flex items-center gap-2 text-caption text-muted-foreground sm:col-span-2">
              <Avatar name={client.name} size="sm" className={cn('rounded-control ring-0', entityTintClass(client.id))} />
              {client.name}
              {client.taxNumber ? ` · ${t('taxNumber', { number: client.taxNumber })}` : ''}
            </p>
          ) : null}
          <FormField htmlFor="manual-date" label={t('invoiceDate')} required error={terms === 'CUSTOM' ? undefined : shownFor('manual-date')}>
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
            <FormField
              htmlFor="manual-due"
              label={t('dueDate')}
              hint={terms === 'CUSTOM' ? undefined : t('dueHint')}
              error={terms === 'CUSTOM' ? shownFor('manual-due') : undefined}
            >
              {terms === 'CUSTOM' ? (
                <DatePicker id="manual-due" value={customDue} onChange={setCustomDue} min={invoiceDate} />
              ) : (
                <Input id="manual-due" value={formatDate(dueDate) ?? dueDate} readOnly className="tabular-nums" />
              )}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <InvoiceTaxField choice={tax} id="manual-tax" disabled={save.isPending} />
          </div>
        </FormGroup>

        <section className="space-y-4" aria-labelledby="manual-lines">
          <div className="border-b border-border pb-2">
            <h2 id="manual-lines" className="text-body font-semibold text-foreground">{t('linesTitle')}</h2>
            <p className="text-caption text-muted-foreground">{t('linesSub')}</p>
          </div>

          {accounts.data && accounts.data.length === 0 ? (
            <Alert variant="warning" messages={[t('noIncomeAccounts')]} />
          ) : null}

          <LineItemsEditor<LineDraft>
            label={t('linesTitle')}
            rows={lines}
            rowKey={(line) => String(line.key)}
            columns={columns}
            errors={(i) => (attempted ? lineErrors.get(i) : undefined)}
            cardTitle={(line, i) =>
              line.description.trim() ? t('lineTitleNamed', { n: i + 1, name: line.description.trim() }) : t('lineTitle', { n: i + 1 })
            }
            onAdd={lines.length < MAX_LINES ? addLine : undefined}
            addLabel={t('addLine')}
            onRemove={lines.length > 1 ? (index) => setLines((current) => current.filter((_, i) => i !== index)) : undefined}
            removeLabel={(i) => t('removeLine', { n: i + 1 })}
          />

          <dl className="ms-auto w-full max-w-xs space-y-1.5 text-body-sm">
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
        </section>
      </div>

      {confirmLeave ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmLeave(false)}
        />
      ) : null}

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
    </form>
  );
}
