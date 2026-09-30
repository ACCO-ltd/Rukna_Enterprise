'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  type FormDialogSize,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

export interface PostingPreviewLine {
  accountCode: string;
  accountName: string;
  /** Decimal string, or null/empty on the side the line does not touch. */
  debit?: string | null;
  credit?: string | null;
}

/**
 * ─── Showing the journal before it is written ───────────────────────────────────
 *
 * Posting is irreversible except by a reversal journal, and the request body names GL accounts
 * the user never chose — they were resolved from the chart. Sending that without showing it
 * would have an accountant approve a ledger entry they cannot see.
 *
 * So every posting confirmation (client invoice, supplier bill, supplier payment) renders the
 * exact lines the server will write, and each caller builds both this preview and the payload
 * from one plan: the dialog cannot display one thing and send another. When the chart cannot
 * answer, the caller passes `problems` instead of `lines` and Post is unavailable.
 *
 * One component, so an accountant posting a bill and posting an invoice is not learning two
 * screens. A `FormDialog` (ADR-039): Post is blocked while in flight (`busy` also blocks every way
 * out), and there is nothing to discard, so Cancel closes at once.
 */
export function PostingPreviewDialog({
  title,
  description,
  size = 'md',
  currencyCode,
  lines,
  totals,
  accountHeading,
  debitHeading,
  creditHeading,
  totalsLabel,
  unbalanced,
  problems,
  errorMessage,
  confirmLabel,
  isPending,
  onConfirm,
  onDismiss,
}: {
  title: ReactNode;
  description: ReactNode;
  /** `md` for a fixed few lines (an invoice); `lg` for a preview as long as its document. */
  size?: FormDialogSize;
  currencyCode: string;
  /** The journal the server will write. Omit when the plan failed and `problems` explain why. */
  lines?: readonly PostingPreviewLine[];
  /** A totals row under the lines, when the document shows one. */
  totals?: { debit: string; credit: string };
  accountHeading: string;
  debitHeading: string;
  creditHeading: string;
  totalsLabel?: string;
  /** Set when the plan's debits and credits differ: the message to show; Post is unavailable. */
  unbalanced?: string | null;
  /** Why no plan could be built (a role unfilled, an account ambiguous). Post is unavailable. */
  problems?: readonly string[];
  errorMessage?: string | null;
  confirmLabel: string;
  isPending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const postable = Boolean(lines) && !unbalanced && (problems?.length ?? 0) === 0;
  const money = (value: string | null | undefined) =>
    value ? formatMoney(value, currencyCode, locale) : null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      title={title}
      subtitle={description}
      size={size}
      busy={isPending}
      initialFocus="dialog"
      closeLabel={tCommon('close')}
    >
      <FormDialogBody className="space-y-3">
        {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

        {lines ? (
          <>
            {/* Not a `<Table>`: a short, fixed preview inside a dialog. The shared table brings a
                horizontal scroller and header semantics that read as a grid the user can act on. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      {accountHeading}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {debitHeading}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {creditHeading}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.accountCode}-${index}`} className="border-b border-border/60">
                      <td className="py-2 pe-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.accountCode}
                        </span>
                        <span className="ms-2 text-foreground">{line.accountName}</span>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">{money(line.debit)}</bdi>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">{money(line.credit)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals ? (
                  <tfoot>
                    <tr className="font-medium text-foreground">
                      <td className="py-2 pe-3">{totalsLabel}</td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">{money(totals.debit)}</bdi>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">{money(totals.credit)}</bdi>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {unbalanced ? <Alert variant="error" messages={[unbalanced]} /> : null}
          </>
        ) : null}

        {problems && problems.length > 0 ? <Alert variant="error" messages={[...problems]} /> : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="button"
          onClick={() => {
            if (postable) onConfirm();
          }}
          loading={isPending}
          loadingText={tCommon('saving')}
          disabled={!postable}
        >
          {confirmLabel}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
