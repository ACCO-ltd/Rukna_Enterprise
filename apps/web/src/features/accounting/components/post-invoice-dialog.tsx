'use client';

import { useLocale, useTranslations } from 'next-intl';

import { planInvoicePost } from '../invoice-journal';
import type { Account, ClientInvoice, PostInvoicePayload } from '../types';
import { PostingPreviewDialog } from './posting-preview-dialog';

/**
 * Posting a client invoice, with the journal shown before it is written.
 *
 * Both the preview and the payload come from one `planInvoicePost` call, so the dialog cannot
 * display one thing and send another. When the chart cannot answer — a role unfilled, or two
 * accounts claiming it — the dialog says which role and why, and Post is unavailable. That is a
 * configuration error an administrator has to fix, and surfacing it here beats a 404 from the
 * server with an account code in it.
 *
 * `md` (ADR-039): an invoice posts a fixed three lines at most.
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
  const locale = useLocale() as 'en' | 'ar';

  const result = planInvoicePost(invoice, accounts, locale);

  return (
    <PostingPreviewDialog
      title={t('title')}
      description={t('description')}
      size="md"
      currencyCode={invoice.currencyCode}
      lines={result.ok ? result.plan.lines : undefined}
      totals={
        result.ok
          ? { debit: result.plan.totalDebit, credit: result.plan.totalCredit }
          : undefined
      }
      accountHeading={t('colAccount')}
      debitHeading={t('colDebit')}
      creditHeading={t('colCredit')}
      totalsLabel={t('totals')}
      // Should be unreachable — `total = subtotal + vat` is set at creation. If it ever fires,
      // the invoice row is inconsistent and the double-entry validator would reject it anyway.
      unbalanced={result.ok && !result.plan.balanced ? t('unbalanced') : null}
      problems={
        result.ok
          ? undefined
          : result.problems.map((problem) =>
              problem.problem === 'AMBIGUOUS'
                ? t('ambiguous', {
                    role: t(`role.${problem.role}`),
                    codes: problem.candidates.map((a) => a.code).join(', '),
                  })
                : t('notConfigured', { role: t(`role.${problem.role}`) }),
            )
      }
      errorMessage={errorMessage}
      confirmLabel={t('confirm')}
      isPending={isPending}
      onConfirm={() => {
        if (result.ok && result.plan.balanced) onConfirm(result.plan.payload);
      }}
      onDismiss={onDismiss}
    />
  );
}
