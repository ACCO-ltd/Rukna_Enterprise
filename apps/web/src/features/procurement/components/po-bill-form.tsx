'use client';

/**
 * Supplier bill creation — **the PO-backed path** (Slice ④, D6).
 *
 * Distinct from `bill-form.tsx`, which stays the genuine non-PO path (utilities, rent,
 * one-off purchases). The two are separate choices on the bill list, not a mode toggle,
 * because they are different controlled flows: a non-PO bill never matches and its commitment
 * ledger is right to stay silent; a PO-backed bill auto-matches on submit and its commitment
 * moves ACCRUED → ACTUAL at post. Confusing the two is the "worst of both" A14 warned against.
 *
 * ─── The flow this realises (owner's sketch) ─────────────────────────────────────
 *
 *   Supplier [ABC Trading]  Invoice no. [INV-9044]  Invoice date [31 Aug 2026]
 *   Purchase order [PO-0042 ▾]
 *      System finds:  PO-0042 · GR-0081 (185 accepted) · GR-0093 (100 accepted)
 *   Bill lines …   (each carries its inherited cost-target chip, read-only)
 *
 * The supplier is chosen first, which narrows the PO picker to that supplier's orders. On
 * selecting a PO the form resolves its ACTIVE revision (a second read) and shows the
 * "System finds" line, then seeds one editable bill line per PO line — description, quantity
 * and unit price prefilled from the order, so the ordinary case (bill matches the PO) is a
 * confirm rather than re-keying, and a discrepancy is a visible edit.
 *
 * There is deliberately no "Run matching" button. Submitting the bill auto-matches (D6);
 * matching is a silent control, not manual work. The submit outcome is rendered on the bill
 * detail page the user lands on.
 *
 * ─── Money ───────────────────────────────────────────────────────────────────────
 *
 * As in the non-PO form: amounts are text, parsed to integer minor units, and become JSON
 * numbers only in the payload (`moneyToApi`). `parseMinorUnits` returns null on a bad value,
 * never 0 — a typo reading as a valid zero is how a bill posts for nothing.
 */

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, MoneyInput } from '@erp/ui';

import { accountName } from '@/features/accounting/account-display';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { expenseProfiles } from '../bill-actions';
import { poLineCostTargetLabel, systemFinds } from '../bill-po-match';
import {
  useCreateSupplierBill,
  usePurchaseOrder,
  useGoodsReceipts,
} from '../hooks/use-procurement';
import { moneyToApi, quantityToApi } from '../quantities';
import type { CreateSupplierBillLinePayload, PurchaseOrderLine } from '../types';
import { ClassificationChips } from './classification-chips';
import { SupplierPicker } from './supplier-picker';
import { PurchaseOrderPicker } from './purchase-order-picker';

/**
 * One PO-backed bill line. It carries the PO line it was seeded from so its inherited
 * cost-target chip and its PO-line default never drift from the order.
 */
interface PoBillLineDraft {
  poLineId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  netAmount: string;
  vatAmount: string;
  expenseProfileCode: string;
  costTargetLabel: string | null;
}

/** Seeds an editable bill line from a PO line — the ordinary case is a confirm, not a re-key. */
function seedLine(line: PurchaseOrderLine): PoBillLineDraft {
  const qty = Number(line.orderedQuantity);
  const price = Number(line.unitPrice);
  const net = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
  return {
    poLineId: line.id,
    description: line.description,
    quantity: line.orderedQuantity,
    unitPrice: line.unitPrice,
    netAmount: net ? net.toFixed(2) : '',
    vatAmount: '',
    expenseProfileCode: '',
    costTargetLabel: poLineCostTargetLabel(line),
  };
}

export function poBillLineError(
  line: PoBillLineDraft,
): 'description' | 'quantity' | 'unitPrice' | 'net' | 'vat' | 'profile' | null {
  if (!line.description.trim()) return 'description';

  // A PO-backed line's quantity and unit price are what the 3-way match compares, so both are
  // required here where they are optional on a non-PO bill. Quantity is 3dp (QUANTITY_SCALE).
  const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  if (qty === null || qty <= 0) return 'quantity';

  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (price === null || price < 0) return 'unitPrice';

  const net = parseMinorUnits(line.netAmount, MONEY_SCALE);
  if (net === null || net < 0) return 'net';

  const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE);
  if (vat === null || vat < 0) return 'vat';

  if (!line.expenseProfileCode) return 'profile';
  return null;
}

export function poBillTotalMinor(lines: readonly PoBillLineDraft[]): number {
  return lines.reduce((sum, line) => {
    const net = parseMinorUnits(line.netAmount, MONEY_SCALE) ?? 0;
    const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0;
    return sum + net + vat;
  }, 0);
}

export function PoSupplierBillForm() {
  const t = useTranslations('procurement.bills');
  const tPo = useTranslations('procurement.bills.po');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en';
  const router = useRouter();

  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billDate, setBillDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const currencyCode = 'USD'; // Single-currency platform (ADR-024).
  const [lines, setLines] = useState<PoBillLineDraft[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateSupplierBill();
  const accounts = useAccounts();
  const profiles = usePostingProfiles();

  // The two reads behind "System finds": the PO's ACTIVE revision + lines, and its receipts.
  const po = usePurchaseOrder(purchaseOrderId);
  const receipts = useGoodsReceipts(purchaseOrderId ? { purchaseOrderId } : undefined);
  const finds = useMemo(
    () => systemFinds(po.data, receipts.data),
    [po.data, receipts.data],
  );

  const ids = {
    supplier: useId(),
    purchaseOrder: useId(),
    invoiceNumber: useId(),
    billDate: useId(),
    dueDate: useId(),
  };

  const options = useMemo(
    () => expenseProfiles(profiles.data ?? [], accounts.data ?? []),
    [profiles.data, accounts.data],
  );

  // Seed one editable line per PO line the moment the PO resolves, and reseed when a different
  // PO resolves. This is the React "reset state when a prop changes" pattern — a setState during
  // render guarded by a stored signature — not an effect, so it does not trigger a cascading
  // render and keeps a user's in-progress edits for the SAME PO (the signature is unchanged).
  const poLineSignature = finds?.poLines.map((l) => l.id).join(',') ?? '';
  const [seededSignature, setSeededSignature] = useState('');
  if (poLineSignature !== seededSignature) {
    setSeededSignature(poLineSignature);
    setLines(finds ? finds.poLines.map(seedLine) : []);
  }

  // Changing supplier clears a PO chosen under the previous supplier — a PO belongs to one
  // supplier, and a stale selection would resolve a mismatched order.
  function handleSupplierChange(next: string) {
    setSupplierId(next);
    setPurchaseOrderId('');
  }

  const totalMinor = poBillTotalMinor(lines);
  const headerComplete = Boolean(
    supplierId && purchaseOrderId && invoiceNumber.trim() && billDate && dueDate,
  );
  const linesValid = lines.length > 0 && lines.every((line) => poBillLineError(line) === null);

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  function update(index: number, patch: Partial<PoBillLineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function handleSubmit() {
    setShowErrors(true);
    if (!headerComplete || !linesValid) return;

    // quantity is 3dp, unitPrice/net/vat are 2dp money. All four are @IsNumber() on the DTO, so
    // each is parsed to minor units then converted back to the decimal JSON number the API wants
    // (a "23" is 23, not 23000). quantity/unitPrice drive the 3-way match against the PO line.
    const payload: CreateSupplierBillLinePayload[] = lines.map((line) => ({
      description: line.description.trim(),
      quantity: quantityToApi(parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0),
      unitPrice: moneyToApi(parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0),
      netAmount: moneyToApi(parseMinorUnits(line.netAmount, MONEY_SCALE) ?? 0),
      vatAmount: moneyToApi(parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0),
      expenseProfileCode: line.expenseProfileCode,
    }));

    create.mutate(
      {
        supplierId,
        purchaseOrderId,
        supplierInvoiceNumber: invoiceNumber.trim(),
        billDate,
        dueDate,
        currencyCode,
        lines: payload,
      },
      { onSuccess: (bill) => router.push(`/finance/accounting/bills/${bill.id}`) },
    );
  }

  const noProfiles = !profiles.isPending && !accounts.isPending && options.length === 0;
  const poResolving = Boolean(purchaseOrderId) && (po.isPending || receipts.isPending);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {tPo('createTitle')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{tPo('createSubtitle')}</p>
      </div>

      {noProfiles ? (
        <Alert variant="error" title={t('noProfilesTitle')} messages={[t('noProfilesBody')]} />
      ) : null}

      <div className="max-w-xl space-y-4">
        <FormField htmlFor={ids.supplier} label={tc('supplier')}>
          <SupplierPicker
            id={ids.supplier}
            value={supplierId}
            onChange={handleSupplierChange}
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

        <FormField htmlFor={ids.purchaseOrder} label={tPo('purchaseOrder')}>
          <PurchaseOrderPicker
            id={ids.purchaseOrder}
            value={purchaseOrderId}
            onChange={setPurchaseOrderId}
            supplierId={supplierId || undefined}
            disabled={!supplierId}
            required
          />
          {!supplierId ? (
            <p className="text-xs text-muted-foreground">{tPo('chooseSupplierFirst')}</p>
          ) : null}
        </FormField>
      </div>

      {/* "System finds" — the resolved PO + its POSTED receipts, before any line is entered.
          A full-width block that wraps its receipt list at 375px. */}
      {poResolving ? (
        <div role="status" aria-live="polite">
          <div
            className="h-16 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : finds ? (
        <SystemFindsPanel finds={finds} locale={locale} />
      ) : purchaseOrderId && !po.isPending ? (
        <Alert variant="warning" messages={[tPo('poNotBillable')]} />
      ) : null}

      {finds ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <h2 className="text-lg font-semibold text-foreground">{tc('lines')}</h2>
            <span className="text-xs text-muted-foreground">{tPo('linesInheritedHint')}</span>
          </div>

          {lines.map((line, index) => {
            const error = showErrors ? poBillLineError(line) : null;
            return (
              <PoBillLineRow
                key={line.poLineId}
                index={index}
                line={line}
                options={options}
                error={error}
                locale={locale}
                onChange={(patch) => update(index, patch)}
              />
            );
          })}
        </section>
      ) : null}

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
          {/* One primary action: create the draft. Matching runs on submit from the detail
              page — there is no "Run matching" here (D6). */}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={create.isPending || noProfiles || !finds}
          >
            {tc('create')}
          </Button>
        </div>
      </div>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
    </div>
  );
}

// ─── System finds ──────────────────────────────────────────────────────────────────

function SystemFindsPanel({
  finds,
  locale,
}: {
  finds: NonNullable<ReturnType<typeof systemFinds>>;
  locale: 'en';
}) {
  const tPo = useTranslations('procurement.bills.po');

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {tPo('systemFinds')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-mono font-medium text-foreground">{finds.poNumber}</span>
        {finds.noReceipts ? (
          <span className="text-muted-foreground">· {tPo('noReceipts')}</span>
        ) : (
          finds.postedReceipts.map((r) => (
            <span key={r.id} className="text-muted-foreground">
              ·{' '}
              <span className="font-mono text-foreground">{r.grnNumber}</span>{' '}
              <span className="tabular-nums">
                ({tPo('accepted', { qty: formatNumber(String(r.acceptedQuantity), locale) ?? '0' })})
              </span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ─── One line ────────────────────────────────────────────────────────────────────

interface PoBillLineRowProps {
  index: number;
  line: PoBillLineDraft;
  options: ReturnType<typeof expenseProfiles>;
  error: ReturnType<typeof poBillLineError>;
  locale: 'en';
  onChange: (patch: Partial<PoBillLineDraft>) => void;
}

function PoBillLineRow({ index, line, options, error, locale, onChange }: PoBillLineRowProps) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');

  const ids = {
    description: useId(),
    quantity: useId(),
    unitPrice: useId(),
    net: useId(),
    vat: useId(),
    profile: useId(),
  };

  return (
    <div className="space-y-3 rounded-panel border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {tc('lineNumber')} {index + 1}
        </span>
        {/* Inherited cost-target chip, read-only (D7). Named where the PO line embeds the
            project/BOQ path; absent for an org/overhead line. */}
        <ClassificationChips
          className="flex flex-wrap items-center justify-end gap-1.5"
          costTargetLabel={line.costTargetLabel}
        />
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
        <FormField htmlFor={ids.quantity} label={tc('quantity')} className="min-w-32 flex-1">
          <Input
            id={ids.quantity}
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            autoComplete="off"
          />
        </FormField>

        <FormField htmlFor={ids.unitPrice} label={tc('unitPrice')} className="min-w-32 flex-1">
          <MoneyInput
            id={ids.unitPrice}
            value={line.unitPrice}
            onValueChange={(v) => onChange({ unitPrice: v })}
            autoComplete="off"
          />
        </FormField>
      </div>

      <div className="flex flex-wrap gap-4">
        <FormField htmlFor={ids.net} label={t('netAmount')} className="min-w-32 flex-1">
          <MoneyInput
            id={ids.net}
            value={line.netAmount}
            onValueChange={(v) => onChange({ netAmount: v })}
            autoComplete="off"
          />
        </FormField>

        <FormField htmlFor={ids.vat} label={t('vatAmount')} className="min-w-32 flex-1">
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
          className="min-h-11 w-full rounded-control border border-border bg-surface px-3 text-sm"
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
