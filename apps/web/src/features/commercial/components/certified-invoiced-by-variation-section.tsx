'use client';

import * as React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  SectionHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { CertifiedInvoicedByVariationResponse } from '@erp/types';

import { formatMoney } from '@/lib/format';

import { useCertifiedInvoicedByVariation } from '../hooks/use-commercial';
import { errorText } from './commercial-workspace';

/**
 * Certified & invoiced value to date, traced by variation (ADR-026 CONST-VAR-008, Phase 3).
 *
 * A first-class **base-scope** row (original contract scope — never omitted, never folded under a
 * VO) + one row per VO + a **total** row. Reconciliation is shown naturally: the rows sum to the
 * total, which the server guarantees by construction (base + Σ byVariation = total). The UI renders
 * the server's figures and never recomputes the sum (CONST-COM / ADR-017).
 *
 * Honesty: money is `string | null`. When `canViewFinancials === false` every cell is null and
 * renders as RESTRICTED (a reason, not a fake `$0`). A VO with genuinely zero certified/invoiced
 * renders a real `$0.00` — a distinct fact. Money is gross / ex-VAT (certified = effective IPC item
 * lines; invoiced = POSTED-invoice item lines); the caption labels it so the number is not mistaken
 * for the VAT-inclusive invoice total.
 */
export function CertifiedInvoicedByVariationSection({ contractId }: { contractId: string }) {
  const t = useTranslations('commercial.variations.trace');
  const query = useCertifiedInvoicedByVariation(contractId);

  return (
    <section className="space-y-3">
      <SectionHeader title={t('title')} />
      <p className="text-caption text-muted-foreground">{t('explainer')}</p>

      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <Alert variant="error" title={t('loadFailed')} messages={[errorText(query.error, t('loadFailedHint'))]}>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <TraceTable data={query.data} />
      )}
    </section>
  );
}

/**
 * The gross/ex-VAT amount for a single cell. On this read model `null` occurs exactly when
 * `canViewFinancials === false` (the server nulls every money field together), so `null` here is
 * RESTRICTED (withheld — a reason, never a zero). A real `"0.00"` is a genuine figure and formats as
 * money. The distinction is the whole honesty point of Phase 3, so the two paths never collapse.
 */
function MoneyCell({
  amount,
  currency,
  locale,
}: {
  amount: string | null;
  currency: string | null;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial.variations.trace');

  if (amount === null) {
    // Null only ever means "financials restricted" here (canViewFinancials === false). Show the
    // withheld reason, not a dash and never a `$0`.
    return (
      <span className="inline-flex items-center justify-end gap-1.5 text-body-sm font-medium text-muted-foreground">
        <LockKeyhole size={13} aria-hidden="true" />
        {t('restricted')}
      </span>
    );
  }

  // A real figure — including a genuine `$0.00`, which is distinct from RESTRICTED above.
  return <span className="tabular-nums">{formatMoney(amount, currency, locale) ?? '—'}</span>;
}

function TraceTable({ data }: { data: CertifiedInvoicedByVariationResponse }) {
  const t = useTranslations('commercial.variations.trace');
  const locale = useLocale() as 'en' | 'ar';
  // Currency isn't on this read model; certified/invoiced money here is gross ex-VAT decimal
  // strings. formatMoney renders a plain grouped decimal when currency is null, which is correct —
  // an amount labelled with the wrong currency is worse than an amount with none.
  const currency = null;

  const cell = (amount: string | null) => (
    <MoneyCell amount={amount} currency={currency} locale={locale} />
  );

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.scope')}</TableHead>
              <TableHead className="text-end">{t('col.certified')}</TableHead>
              <TableHead className="text-end">{t('col.invoiced')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Base scope — original contract scope, first-class and always present, never folded
                into a VO. */}
            <TableRow>
              <TableCell>
                <span className="font-medium text-foreground">{t('baseScope')}</span>
                <span className="ms-2 text-caption text-muted-foreground">{t('baseScopeHint')}</span>
              </TableCell>
              <TableCell className="text-end">{cell(data.baseScope.certifiedToDate)}</TableCell>
              <TableCell className="text-end">{cell(data.baseScope.invoicedToDate)}</TableCell>
            </TableRow>

            {data.byVariation.map((vo) => (
              <TableRow key={vo.variationId}>
                <TableCell>
                  <span className="font-mono text-caption text-muted-foreground">{vo.reference}</span>
                  <span className="ms-2 text-body-sm text-foreground">{vo.title}</span>
                </TableCell>
                <TableCell className="text-end">{cell(vo.certifiedToDate)}</TableCell>
                <TableCell className="text-end">{cell(vo.invoicedToDate)}</TableCell>
              </TableRow>
            ))}

            {/* Total — base + Σ byVariation, computed by the server. The rows above visibly sum to
                it (reconciliation by construction). */}
            <TableRow className="border-t-2 border-border bg-surface-subtle">
              <TableCell className="font-semibold text-foreground">{t('total')}</TableCell>
              <TableCell className="text-end font-semibold">
                {cell(data.totalCertifiedToDate)}
              </TableCell>
              <TableCell className="text-end font-semibold">
                {cell(data.totalInvoicedToDate)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableScroll>
      <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
        {t('exVatNote')}
      </p>
    </div>
  );
}
