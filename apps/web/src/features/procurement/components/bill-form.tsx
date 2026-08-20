'use client';

/**
 * Supplier bill creation — **non-PO bills only** (Tier B).
 *
 * There is deliberately no purchase-order field. `CreateSupplierBillDto` accepts a
 * `purchaseOrderId`, but nothing anywhere writes `SupplierBill.purchaseOrderRevisionId`
 * (A14 / #33), and three behaviours key on it: matching returns early, the post gate
 * short-circuits, and the commitment ledger never advances from ACCRUED to ACTUAL. A bill
 * created here with a PO attached would look linked and behave unlinked — the worst of both.
 *
 * So this form raises the bills whose revision id is *legitimately* null: utilities, rent,
 * services, one-off purchases. For those, "no matching required" is correct rather than
 * merely unenforced, and the commitment ledger is right to stay silent because no commitment
 * was ever raised.
 *
 * ─── Money ──────────────────────────────────────────────────────────────────────
 *
 * Amounts are entered as text, parsed to integer minor units, and converted to JSON numbers
 * only in the payload (`moneyToApi`), because the write DTOs are `@IsNumber()` while every
 * read is a decimal string (A9/P17). `parseMinorUnits` returns null on a bad value rather
 * than 0 — a typo reading as a valid zero is how a bill posts for nothing.
 */

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, MoneyInput } from '@erp/ui';

import { accountName } from '@/features/accounting/account-display';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { expenseProfiles } from '../bill-actions';
import { useCreateSupplierBill } from '../hooks/use-procurement';
import { moneyToApi } from '../quantities';
import type { CreateSupplierBillLinePayload } from '../types';
import { SupplierPicker } from './supplier-picker';

export interface BillLineDraft {
  description: string;
  netAmount: string;
  vatAmount: string;
  expenseProfileCode: string;
}

export function emptyBillLine(): BillLineDraft {
  return { description: '', netAmount: '', vatAmount: '', expenseProfileCode: '' };
}

/**
 * Why a line cannot be submitted, or null when it can.
 *
 * VAT is required rather than optional: `CreateSupplierBillLineDto` marks `vatAmount`
 * `@IsNumber() @Min(0)` with no default, so omitting it is a 400 — and §6.20 omits it
 * entirely, which is one of A4's three defects. A zero is a legitimate answer and has to be
 * typed, because "no VAT" and "VAT not yet entered" must not look the same on a form that
 * posts to the ledger.
 */
export function billLineError(line: BillLineDraft): 'description' | 'net' | 'vat' | 'profile' | null {
  if (!line.description.trim()) return 'description';

  const net = parseMinorUnits(line.netAmount, MONEY_SCALE);
  if (net === null || net < 0) return 'net';

  const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE);
  if (vat === null || vat < 0) return 'vat';

  if (!line.expenseProfileCode) return 'profile';
  return null;
}

/** `net + vat` per line, summed in minor units. Mirrors the server's own total. */
export function billTotalMinor(lines: readonly BillLineDraft[]): number {
  return lines.reduce((sum, line) => {
    const net = parseMinorUnits(line.netAmount, MONEY_SCALE) ?? 0;
    const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0;
    return sum + net + vat;
  }, 0);
}

export function SupplierBillForm() {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billDate, setBillDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [lines, setLines] = useState<BillLineDraft[]>([emptyBillLine()]);
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateSupplierBill();
  const accounts = useAccounts();
  const profiles = usePostingProfiles();

  const ids = {
    supplier: useId(),
    invoiceNumber: useId(),
    billDate: useId(),
    dueDate: useId(),
    currency: useId(),
  };

  const options = useMemo(
    () => expenseProfiles(profiles.data ?? [], accounts.data ?? []),
    [profiles.data, accounts.data],
  );

  const totalMinor = billTotalMinor(lines);
  const headerComplete = Boolean(supplierId && invoiceNumber.trim() && billDate && dueDate);
  const linesValid = lines.length > 0 && lines.every((line) => billLineError(line) === null);

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  function update(index: number, patch: Partial<BillLineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function handleSubmit() {
    setShowErrors(true);
    if (!headerComplete || !linesValid) return;

    const payload: CreateSupplierBillLinePayload[] = lines.map((line) => ({
      description: line.description.trim(),
      netAmount: moneyToApi(parseMinorUnits(line.netAmount, MONEY_SCALE) ?? 0),
      vatAmount: moneyToApi(parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0),
      expenseProfileCode: line.expenseProfileCode,
    }));

    create.mutate(
      {
        supplierId,
        supplierInvoiceNumber: invoiceNumber.trim(),
        billDate,
        dueDate,
        currencyCode,
        lines: payload,
      },
      { onSuccess: (bill) => router.push(`/finance/accounting/bills/${bill.id}`) },
    );
  }

  // The whole form depends on a resolvable expense profile. Without one, every line would
  // carry an empty code and the create would 400 — better to say so than to render a form
  // whose only required select has nothing in it.
  const noProfiles = !profiles.isPending && !accounts.isPending && options.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('createSubtitle')}</p>
      </div>

      <Alert variant="info" messages={[t('nonPoOnlyNotice')]} />

      {noProfiles ? (
        <Alert variant="error" title={t('noProfilesTitle')} messages={[t('noProfilesBody')]} />
      ) : null}

      <div className="max-w-xl space-y-4">
        <FormField htmlFor={ids.supplier} label={tc('supplier')}>
          <SupplierPicker
            id={ids.supplier}
            value={supplierId}
            onChange={setSupplierId}
            required
          />
        </FormField>

        <FormField htmlFor={ids.invoiceNumber} label={t('invoiceNumber')}>
          <Input
            id={ids.invoiceNumber}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t('invoiceNumberHint')}</p>
        </FormField>

        <div className="flex flex-wrap gap-4">
          <FormField htmlFor={ids.billDate} label={t('billDate')} className="min-w-44 flex-1">
            <Input
              id={ids.billDate}
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </FormField>

          <FormField htmlFor={ids.dueDate} label={t('dueDate')} className="min-w-44 flex-1">
            <Input
              id={ids.dueDate}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField htmlFor={ids.currency} label={tc('currency')}>
          <Input
            id={ids.currency}
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            className="uppercase"
          />
        </FormField>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">{tc('lines')}</h2>

        {lines.map((line, index) => {
          const error = showErrors ? billLineError(line) : null;
          return (
            <BillLineRow
              key={index}
              index={index}
              line={line}
              options={options}
              error={error}
              locale={locale}
              onChange={(patch) => update(index, patch)}
              onRemove={
                lines.length > 1
                  ? () => setLines((prev) => prev.filter((_, i) => i !== index))
                  : undefined
              }
            />
          );
        })}

        <Button
          type="button"
          variant="outline"
          onClick={() => setLines((prev) => [...prev, emptyBillLine()])}
        >
          {tc('addLine')}
        </Button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm">
          <span className="text-muted-foreground">{t('totalAmount')}: </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), currencyCode, locale)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={create.isPending || noProfiles}
          >
            {tc('create')}
          </Button>
        </div>
      </div>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
    </div>
  );
}

// ─── One line ────────────────────────────────────────────────────────────────────

interface BillLineRowProps {
  index: number;
  line: BillLineDraft;
  options: ReturnType<typeof expenseProfiles>;
  error: ReturnType<typeof billLineError>;
  locale: 'en' | 'ar';
  onChange: (patch: Partial<BillLineDraft>) => void;
  onRemove?: (() => void) | undefined;
}

function BillLineRow({
  index,
  line,
  options,
  error,
  locale,
  onChange,
  onRemove,
}: BillLineRowProps) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');

  const ids = {
    description: useId(),
    net: useId(),
    vat: useId(),
    profile: useId(),
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {tc('lineNumber')} {index + 1}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline"
          >
            {tc('removeLine')}
          </button>
        ) : null}
      </div>

      <FormField htmlFor={ids.description} label={tc('description')}>
        <Input
          id={ids.description}
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
          maxLength={500}
          autoComplete="off"
        />
      </FormField>

      <div className="flex flex-wrap gap-4">
        <FormField htmlFor={ids.net} label={t('netAmount')} className="min-w-40 flex-1">
          <MoneyInput
            id={ids.net}
            value={line.netAmount}
            onValueChange={(v) => onChange({ netAmount: v })}
            autoComplete="off"
          />
        </FormField>

        <FormField htmlFor={ids.vat} label={t('vatAmount')} className="min-w-40 flex-1">
          <MoneyInput
            id={ids.vat}
            value={line.vatAmount}
            onValueChange={(v) => onChange({ vatAmount: v })}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t('vatHint')}</p>
        </FormField>
      </div>

      <FormField htmlFor={ids.profile} label={t('expenseProfile')}>
        <select
          id={ids.profile}
          value={line.expenseProfileCode}
          onChange={(e) => onChange({ expenseProfileCode: e.target.value })}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="" disabled>
            —
          </option>
          {options.map((profile) => (
            <option key={profile.code} value={profile.code}>
              {profile.name} · {profile.account.code} {accountName(profile.account, locale)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('expenseProfileHint')}</p>
      </FormField>

      {error ? <Alert variant="error" messages={[t(`lineError.${error}`)]} /> : null}
    </div>
  );
}
