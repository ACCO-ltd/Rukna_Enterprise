'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { planInvoicePost } from '../invoice-journal';
import type { Account, ClientInvoice, PostInvoicePayload } from '../types';

/**
 * ─── Showing the journal before it is written ───────────────────────────────────
 *
 * Posting is irreversible except by a reversal journal, and the request body names GL accounts
 * the user never chose — `posting-accounts.ts` resolved them from the chart. Sending that
 * without showing it would have an accountant approve a ledger entry they cannot see.
 *
 * So the dialog renders the exact lines the server will write, and both the preview and the
 * payload come from one `planInvoicePost` call: the dialog cannot display one thing and send
 * another.
 *
 * When the chart cannot answer — a role unfilled, or two accounts claiming it — the dialog says
 * which role and why, and Post is unavailable. That is a configuration error an administrator
 * has to fix, and surfacing it here beats a 404 from the server with an account code in it.
 */
export function PostInvoiceDialog({
  invoice,
  accounts,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  invoice: ClientInvoice;
  accounts: readonly Account[];
  isPending: boolean;
  errorMessage?: string | undefined;
  onConfirm: (payload: PostInvoicePayload) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('accounting.invoices.post');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const result = planInvoicePost(invoice, accounts, locale);

  const preventWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isPending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventWhilePending}
        onPointerDownOutside={preventWhilePending}
        onInteractOutside={preventWhilePending}
      >
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>

        {errorMessage ? (
          <div className="mt-4">
            <Alert variant="error" messages={[errorMessage]} />
          </div>
        ) : null}

        {result.ok ? (
          <div className="mt-4 space-y-3">
            {/* Not a `<Table>`: this is a fixed three-line preview inside a dialog, and the
                shared table brings a horizontal scroller and header semantics that read as a
                data grid the user can act on. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      {t('colAccount')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('colDebit')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('colCredit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.plan.lines.map((line) => (
                    <tr key={line.accountCode} className="border-b border-border/60">
                      <td className="py-2 pe-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.accountCode}
                        </span>
                        <span className="ms-2 text-foreground">{line.accountName}</span>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">
                          {line.debit
                            ? formatMoney(line.debit, invoice.currencyCode, locale)
                            : null}
                        </bdi>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">
                          {line.credit
                            ? formatMoney(line.credit, invoice.currencyCode, locale)
                            : null}
                        </bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium text-foreground">
                    <td className="py-2 pe-3">{t('totals')}</td>
                    <td className="py-2 text-end">
                      <bdi className="tabular-nums">
                        {formatMoney(result.plan.totalDebit, invoice.currencyCode, locale)}
                      </bdi>
                    </td>
                    <td className="py-2 text-end">
                      <bdi className="tabular-nums">
                        {formatMoney(result.plan.totalCredit, invoice.currencyCode, locale)}
                      </bdi>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Should be unreachable — `total = subtotal + vat` is set at creation. If it ever
                fires, the invoice row is inconsistent and posting would be rejected by the
                double-entry validator anyway. */}
            {result.plan.balanced ? null : (
              <Alert variant="error" messages={[t('unbalanced')]} />
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={result.problems.map((problem) =>
                problem.problem === 'AMBIGUOUS'
                  ? t('ambiguous', {
                      role: t(`role.${problem.role}`),
                      codes: problem.candidates.map((a) => a.code).join(', '),
                    })
                  : t('notConfigured', { role: t(`role.${problem.role}`) }),
              )}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => {
              if (result.ok && result.plan.balanced) onConfirm(result.plan.payload);
            }}
            disabled={isPending || !result.ok || !result.plan.balanced}
          >
            {isPending ? tCommon('saving') : t('confirm')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={isPending}>
            {tCommon('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
