'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  MoneyInput,
  Select,
} from '@erp/ui';

import { useAccounts, useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { bankAccountLabel } from '@/features/procurement/payment-actions';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';

import { fromMinorUnits, invoicesForClient, toMinorUnits } from '../allocation';
import { usePostReceipt } from '../hooks/use-receipts';
import type { ReceiptDetail } from '../types';

interface AllocationRow {
  key: string;
  clientInvoiceId: string;
  amount: string;
}

let rowSeq = 0;
const newRow = (): AllocationRow => ({ key: `row-${rowSeq++}`, clientInvoiceId: '', amount: '' });

/**
 * ACC-SET-001 D3 — posting a receipt is atomic with its allocations. The bank account that
 * received the cash is chosen explicitly (its GL code is resolved from the chart); the AR and
 * unapplied-cash accounts are resolved server-side by role. Anything not allocated here is left
 * in Unapplied and can be allocated later from the receipt.
 */
export function PostReceiptDialog({
  receipt,
  onClose,
}: {
  receipt: ReceiptDetail;
  onClose: () => void;
}) {
  const t = useTranslations('platform.receipts.post');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const post = usePostReceipt(receipt.id);
  const bankAccounts = useBankAccounts();
  const accounts = useAccounts();
  const invoices = useInvoices(receipt.clientId);

  const [bankAccountId, setBankAccountId] = useState('');
  const [rows, setRows] = useState<AllocationRow[]>([]);

  const receiptBanks = useMemo(
    () => (bankAccounts.data ?? []).filter((b) => b.status === 'ACTIVE' && b.allowsReceipts),
    [bankAccounts.data],
  );
  const invoiceOptions = useMemo(
    () => invoicesForClient(invoices.data ?? [], receipt.clientId),
    [invoices.data, receipt.clientId],
  );

  const selectedBank = receiptBanks.find((b) => b.id === bankAccountId) ?? null;
  const bankGlCode =
    selectedBank && (accounts.data ?? []).find((a) => a.id === selectedBank.glAccountId)?.code;

  const totalMinor = toMinorUnits(receipt.totalAmount);
  const allocatedMinor = rows.reduce(
    (sum, r) => sum + (parseMinorUnits(r.amount.trim(), MONEY_SCALE) ?? 0),
    0,
  );
  const unappliedMinor = totalMinor - allocatedMinor;
  const overAllocated = unappliedMinor < 0;

  const canPost = Boolean(bankGlCode) && !overAllocated && !post.isPending;

  function submit() {
    if (!bankGlCode || overAllocated) return;
    const allocations = rows
      .filter((r) => r.clientInvoiceId && (parseMinorUnits(r.amount.trim(), MONEY_SCALE) ?? 0) > 0)
      .map((r) => ({
        clientInvoiceId: r.clientInvoiceId,
        amount: (parseMinorUnits(r.amount.trim(), MONEY_SCALE) ?? 0) / 10 ** MONEY_SCALE,
      }));
    post.mutate(
      { bankAccountCode: bankGlCode, ...(allocations.length ? { allocations } : {}) },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !post.isPending ? onClose() : undefined)}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (post.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (post.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('title')}</DialogTitle>

        <div className="mt-4 space-y-4">
          <Alert variant="info" messages={[t('intro')]} />
          {post.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}

          <FormField htmlFor="post-bank" label={t('bankLabel')}>
            {receiptBanks.length === 0 && !bankAccounts.isPending ? (
              <Alert variant="warning" messages={[t('noBanks')]} />
            ) : (
              <Select
                id="post-bank"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">{t('bankPlaceholder')}</option>
                {receiptBanks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bankAccountLabel(bank)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{t('allocateNow')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={invoiceOptions.length === 0}
                onClick={() => setRows((prev) => [...prev, newRow()])}
              >
                {t('addInvoice')}
              </Button>
            </div>

            {rows.map((row) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2">
                <FormField htmlFor={`inv-${row.key}`} label={t('invoice')} className="min-w-40 flex-1">
                  <Select
                    id={`inv-${row.key}`}
                    value={row.clientInvoiceId}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, clientInvoiceId: e.target.value } : r,
                        ),
                      )
                    }
                  >
                    <option value="">{t('invoice')}</option>
                    {invoiceOptions.map(({ invoice, outstandingMinor }) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.invoiceNumber ?? invoice.id.slice(-8)} —{' '}
                        {formatMoney(fromMinorUnits(outstandingMinor), receipt.currencyCode, locale)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField htmlFor={`amt-${row.key}`} label={t('amount')} className="w-36">
                  <MoneyInput
                    id={`amt-${row.key}`}
                    value={row.amount}
                    onValueChange={(v) =>
                      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, amount: v } : r)))
                    }
                  />
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                >
                  {t('remove')}
                </Button>
              </div>
            ))}

            <p className="text-xs text-muted-foreground">
              {overAllocated ? (
                <span className="text-danger">{t('overAllocated')}</span>
              ) : (
                <bdi>
                  {t('unappliedNote', {
                    amount:
                      formatMoney(fromMinorUnits(unappliedMinor), receipt.currencyCode, locale) ?? '',
                  })}
                </bdi>
              )}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" onClick={submit} disabled={!canPost}>
              {post.isPending ? tCommon('loading') : t('post')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={post.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
