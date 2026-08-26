'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { InvoiceStatusBadges } from '@/features/accounting/components/invoice-status-badges';
import { useGenerateInvoice, useInvoiceForIpc } from '@/features/accounting/hooks/use-invoices';
import { canGenerateInvoice, defaultDueDate } from '@/features/accounting/invoice-actions';
import { lifecycleErrorKey, toLifecycleError } from '@/features/lifecycle/lifecycle-error';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

/**
 * ─── Raising the client invoice from the certificate ────────────────────────────
 *
 * `POST /invoices/from-ipc` is the only way a client invoice comes into existence — there is no
 * blank create — so the action has to start from a certificate. It lives here rather than on
 * the invoices list because this is where someone already is when a certificate becomes
 * effective, and the certificate carries the amounts the invoice will inherit.
 *
 * The server refuses a second invoice per IPC with a **409**. That is not an error worth
 * showing as one: it means somebody else already raised it, and the right response is to render
 * the invoice. So the card reads the existing invoice first and only offers the action when
 * there is none.
 *
 * ─── What this card deliberately does not do ────────────────────────────────────
 *
 * It shows no settlement figure. The `SettlementSection` above it already reports what has been
 * received against this certificate, drawn from Sprint 3's receipt allocations; the invoice's
 * `outstandingAmount` is drawn from Sprint 4's, and the two ledgers have no guard between them.
 * Showing both here would put two different answers to "how much is still owed" side by side.
 * Until that duality is settled, this card reports only what the invoice *is*.
 */
export function IpcBillingCard({
  ipcId,
  isEffective,
  currency,
}: {
  ipcId: string;
  isEffective: boolean;
  currency: string | null;
}) {
  const t = useTranslations('accounting.invoices.billingCard');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('common.lifecycleErrors');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const invoice = useInvoiceForIpc(ipcId);
  const generate = useGenerateInvoice();

  const today = new Date().toISOString().slice(0, 10);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => defaultDueDate(today));
  const [formOpen, setFormOpen] = useState(false);

  // A certificate that is not effective cannot be invoiced, and the card would only ever show
  // an empty state. Rendering nothing is the honest result.
  if (!isEffective) return null;

  const existing = invoice.data ?? null;
  const mayRaise = can(ACCOUNTING_PERMISSIONS.manageReceivables);

  // A 409 here means the invoice exists but the lookup raced it. Treated as "already invoiced"
  // rather than as a failure, because that is what it means.
  const alreadyInvoiced =
    generate.error instanceof ApiError && generate.error.status === 409;

  const errorMessage =
    generate.isError && !alreadyInvoiced
      ? tLifecycle(lifecycleErrorKey(toLifecycleError(generate.error).kind))
      : undefined;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>

      {invoice.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-24 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : existing ? (
        <div className="space-y-3 rounded-panel border border-border bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="font-mono text-sm font-medium text-foreground">
                {existing.invoiceNumber ?? t('unnumbered')}
              </p>
              <InvoiceStatusBadges
                documentStatus={existing.documentStatus}
                postingStatus={existing.postingStatus}
              />
            </div>
            <bdi className="tabular-nums text-lg font-semibold text-foreground">
              {formatMoney(existing.totalAmount, existing.currencyCode, locale)}
            </bdi>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('dueOn', { date: formatDate(existing.dueDate, locale) ?? '—' })}
          </p>

          <Button variant="outline" asChild>
            <Link href={`/finance/accounting/invoices/${existing.id}`}>{t('viewInvoice')}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4 rounded-panel border border-dashed border-border bg-surface p-6">
          <p className="text-sm text-foreground">{t('none')}</p>

          {!mayRaise ? (
            <p className="text-sm text-muted-foreground">{t('noPermission')}</p>
          ) : !formOpen ? (
            <Button onClick={() => setFormOpen(true)}>{t('generate')}</Button>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canGenerateInvoice({ isEffective }, existing)) return;
                generate.mutate(
                  { ipcId, invoiceDate, dueDate },
                  { onSuccess: () => setFormOpen(false) },
                );
              }}
            >
              {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField htmlFor="invoice-date" label={t('invoiceDate')}>
                  <Input
                    id="invoice-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => {
                      setInvoiceDate(e.target.value);
                      // Keeping the 30-day relationship as the user edits the issue date. They
                      // can still override the due date afterwards; this only stops it silently
                      // falling before the invoice date.
                      setDueDate(defaultDueDate(e.target.value));
                    }}
                    required
                  />
                </FormField>

                <FormField htmlFor="due-date" label={t('dueDate')}>
                  <Input
                    id="due-date"
                    type="date"
                    value={dueDate}
                    min={invoiceDate}
                    aria-describedby="due-date-hint"
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                  <p id="due-date-hint" className="text-xs text-muted-foreground">
                    {t('dueDateHint')}
                  </p>
                </FormField>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('amountNote', { currency: currency ?? '' })}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={generate.isPending}>
                  {generate.isPending ? tCommon('saving') : t('generate')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    generate.reset();
                    setFormOpen(false);
                  }}
                  disabled={generate.isPending}
                >
                  {tCommon('cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
