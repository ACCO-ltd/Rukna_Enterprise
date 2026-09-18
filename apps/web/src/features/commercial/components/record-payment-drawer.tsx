'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  LtrValue,
  Select,
  Textarea,
  cn,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import {
  buildAllocationPreview,
  type ClientReceivableView,
} from '../lib/collection-view-model';
import { useProjectDepositAccounts, useRecordProjectPayment } from '../hooks/use-commercial';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface RecordPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currency: string;
  /** The invoice the user clicked "Record payment" on — pre-populates amount with its outstanding. */
  preselectedInvoice: ClientReceivableView | null;
  /** All invoices eligible for allocation (canRecordPayment === true). */
  allInvoices: ClientReceivableView[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RecordPaymentDrawer({
  open,
  onOpenChange,
  projectId,
  currency,
  preselectedInvoice,
  allInvoices,
}: RecordPaymentDrawerProps) {
  const t = useTranslations('commercial.billing.collection.drawer');
  const locale = useLocale() as 'en';

  const defaultAmount = preselectedInvoice?.outstanding ?? '';
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  // User-confirmed allocation overrides: maps invoiceId → amount string. Empty = use greedy suggestion.
  const [allocationOverrides, setAllocationOverrides] = useState<Record<string, string>>({});

  const depositAccountsQuery = useProjectDepositAccounts(projectId);
  const mutation = useRecordProjectPayment(projectId);

  // ─── Reset when drawer closes ────────────────────────────────────────────

  function handleOpenChange(next: boolean) {
    if (!next) {
      setAmount(preselectedInvoice?.outstanding ?? '');
      setDate(new Date().toISOString().slice(0, 10));
      setBankAccountId('');
      setPaymentMethod('');
      setReference('');
      setNotes('');
      setAllocationOverrides({});
      mutation.reset();
    }
    onOpenChange(next);
  }

  function handleAmountChange(nextAmount: string) {
    // A new receipt amount needs a fresh greedy suggestion; manual allocations belong to the
    // previous amount and must not be silently carried into this calculation.
    setAllocationOverrides({});
    setAmount(nextAmount);
  }

  // ─── Allocation (editable) ───────────────────────────────────────────────

  const allocationLines = buildAllocationPreview(amount, allInvoices);
  const amountNum = parseFloat(amount) || 0;

  const effectiveAmount = (invoiceId: string, suggested: string): string =>
    allocationOverrides[invoiceId] ?? suggested;

  const allocatedNum = allocationLines.reduce(
    (sum, l) => sum + (parseFloat(effectiveAmount(l.invoiceId, l.suggested)) || 0),
    0,
  );
  const unallocatedNum = parseFloat(Math.max(0, amountNum - allocatedNum).toFixed(2));
  const hasUnallocated = unallocatedNum > 0 && amountNum > 0;

  const allocationsValid =
    allocationLines.every((l) => {
      const v = parseFloat(effectiveAmount(l.invoiceId, l.suggested));
      return !isNaN(v) && v >= 0 && v <= parseFloat(l.max);
    }) && allocatedNum <= amountNum;

  const money = (value: number) =>
    formatMoney(value.toFixed(2), currency, locale) ?? value.toFixed(2);

  // ─── Submit ──────────────────────────────────────────────────────────────

  const canSubmit =
    bankAccountId !== '' &&
    amountNum > 0 &&
    date.length > 0 &&
    allocationsValid &&
    !mutation.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    mutation.mutate(
      {
        bankAccountId,
        receiptDate: date,
        amount,
        currency,
        paymentMethod: paymentMethod || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        allocations: allocationLines
          .map((l) => ({
            clientInvoiceId: l.invoiceId,
            amount: parseFloat(effectiveAmount(l.invoiceId, l.suggested)),
          }))
          .filter((a) => a.amount > 0),
      },
      {
        onSuccess: () => handleOpenChange(false),
      },
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription className="text-body-sm text-muted-foreground">
          {t('description')}
        </DialogDescription>

        <div className="space-y-4 py-2">
          {/* ── Deposit account ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-bank-account">{t('depositAccountLabel')}</Label>
            <Select
              id="rp-bank-account"
              value={bankAccountId}
              onChange={setBankAccountId}
              disabled={mutation.isPending || depositAccountsQuery.isPending}
            >
              <option value="">{t('depositAccountPlaceholder')}</option>
              {(depositAccountsQuery.data ?? []).map((acct) => (
                <option key={acct.id} value={acct.id}>
                  {acct.bankName} — {acct.accountNumber}
                </option>
              ))}
            </Select>
          </div>

          {/* ── Amount & date ─────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-amount">{t('amountLabel')}</Label>
              <Input
                id="rp-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0.00"
                disabled={mutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-date">{t('dateLabel')}</Label>
              <Input
                id="rp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* ── Payment method & reference ────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-method">{t('methodLabel')}</Label>
              <Select
                id="rp-method"
                value={paymentMethod}
                onChange={setPaymentMethod}
                disabled={mutation.isPending}
              >
                <option value="">{t('methodPlaceholder')}</option>
                <option value="bank_transfer">{t('method.bank_transfer')}</option>
                <option value="cheque">{t('method.cheque')}</option>
                <option value="cash">{t('method.cash')}</option>
                <option value="other">{t('method.other')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-reference">{t('referenceLabel')}</Label>
              <Input
                id="rp-reference"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* ── Note ─────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-notes">{t('notesLabel')}</Label>
            <Textarea
              id="rp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={mutation.isPending}
            />
          </div>

          {/* ── Allocation (editable) ────────────────────────────────────── */}
          {amountNum > 0 ? (
            <div>
              <p className="mb-2 text-body-sm font-semibold text-foreground">
                {t('allocationPreviewTitle')}
              </p>
              <ul className="space-y-2">
                {allocationLines.map((line) => {
                  const val = effectiveAmount(line.invoiceId, line.suggested);
                  const numVal = parseFloat(val);
                  const isOver = !isNaN(numVal) && numVal > parseFloat(line.max);
                  return (
                    <li key={line.invoiceId} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                        <LtrValue>{line.invoiceNumber ?? '—'}</LtrValue>
                      </span>
                      <Input
                        type="number"
                        min="0"
                        max={line.max}
                        step="0.01"
                        value={val}
                        onChange={(e) =>
                          setAllocationOverrides((prev) => ({
                            ...prev,
                            [line.invoiceId]: e.target.value,
                          }))
                        }
                        className={cn('w-28 text-right tabular-nums', isOver && 'border-danger')}
                        disabled={mutation.isPending}
                      />
                    </li>
                  );
                })}
              </ul>

              <div className="mt-2 space-y-1 border-t border-border pt-2">
                <div className="flex items-baseline justify-between gap-3 text-caption">
                  <span className="text-muted-foreground">{t('allocatedTotal')}</span>
                  <LtrValue
                    className={cn(
                      'tabular-nums font-medium',
                      allocatedNum > amountNum ? 'text-danger' : 'text-foreground',
                    )}
                  >
                    {money(allocatedNum)}
                  </LtrValue>
                </div>
                {hasUnallocated ? (
                  <div className="flex items-baseline justify-between gap-3 text-caption">
                    <span className="text-warning">{t('unallocatedAmount')}</span>
                    <LtrValue className={cn('tabular-nums font-medium', 'text-warning')}>
                      {money(unallocatedNum)}
                    </LtrValue>
                  </div>
                ) : null}
              </div>

              {allocatedNum > amountNum ? (
                <p className="mt-1.5 text-caption text-danger" role="alert">
                  {t('allocationExceedsPayment')}
                </p>
              ) : hasUnallocated ? (
                <p className="mt-1.5 text-caption text-muted-foreground">{t('unallocatedHint')}</p>
              ) : null}
            </div>
          ) : null}

          {/* ── Error ──────────────────────────────────────────────────────── */}
          {mutation.isError ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-caption text-danger" role="alert">
              {(mutation.error as Error).message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? '…' : t('submit')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
