'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  FormField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, sumMinorUnits } from '@/lib/money';

import { useFiscalYears, useMonthlyPL } from '../hooks/use-accounting';
import type { MonthlyPLColumn } from '../types';

export function MonthlyComparisonReport() {
  const t = useTranslations('accounting.monthlyPL');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const years = useFiscalYears();

  // The chosen year, DERIVED rather than synchronised into state by an effect. Defaulting
  // with `useEffect(() => setSelected(...))` renders once with an empty picker, once more to
  // fill it, and needs a guard against overwriting a real choice — all to express "the first
  // one unless the user picked another", which is what this line says.
  const [chosenId, setChosenId] = useState('');
  const fiscalYearId = chosenId || years.data?.[0]?.id || '';

  const report = useMonthlyPL(fiscalYearId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {years.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : years.data?.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('noFiscalYears')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('noFiscalYearsHint')}
          </p>
        </div>
      ) : (
        <>
          <FormField htmlFor="mpl-year" label={t('fiscalYearLabel')} className="sm:w-64">
            <Select
              id="mpl-year"
              value={fiscalYearId}
              onChange={(e) => setChosenId(e.target.value)}
            >
              <option value="">{t('selectFiscalYear')}</option>
              {(years.data ?? []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          </FormField>

          {report.isPending ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">{tShared('loading')}</span>
              <div
                className="h-64 animate-pulse rounded-lg border border-border bg-muted"
                aria-hidden="true"
              />
            </div>
          ) : report.isError ? (
            <Alert variant="error" messages={[t('loadFailed')]} />
          ) : /* The endpoint answers 200 with a null body for an unknown fiscal year rather
                than 404, so the null has to be interpreted here. */
          report.data === null ? (
            <Alert variant="warning" messages={[t('notFound')]} />
          ) : (
            <ComparisonTable columns={report.data.columns} locale={locale} />
          )}
        </>
      )}
    </div>
  );
}

function ComparisonTable({
  columns,
  locale,
}: {
  columns: MonthlyPLColumn[];
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('accounting.monthlyPL');

  const posted = columns.some((c) => sumMinorUnits([c.revenue, c.expenses], MONEY_SCALE) !== 0);

  if (!posted) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  }

  // Year-to-date totals are not on the response. Summed in minor units, like every other
  // column of money in this app.
  const total = (key: keyof MonthlyPLColumn) =>
    fromMinorUnits(
      sumMinorUnits(
        columns.map((c) => String(c[key])),
        MONEY_SCALE,
      ),
      MONEY_SCALE,
    );

  return (
    <TableScroll aria-label={t('title')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[140px]">{t('colPeriod')}</TableHead>
            <TableHead numeric>{t('colRevenue')}</TableHead>
            <TableHead numeric>{t('colCostOfSales')}</TableHead>
            <TableHead numeric>{t('colGrossProfit')}</TableHead>
            <TableHead numeric>{t('colExpenses')}</TableHead>
            <TableHead numeric>{t('colNetIncome')}</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {columns.map((column) => (
            <TableRow key={column.periodNumber}>
              <TableCell className="min-w-[140px]">
                <span className="text-sm text-foreground">{column.periodName}</span>
              </TableCell>
              {[
                column.revenue,
                column.costOfSales,
                column.grossProfit,
                column.expenses,
              ].map((amount, i) => (
                <TableCell key={i} numeric>
                  <bdi className="tabular-nums">{formatMoney(amount, undefined, locale)}</bdi>
                </TableCell>
              ))}
              {/* Net income is the column being read across; a loss is coloured so a run of
                  them is visible without reading every figure. */}
              <TableCell numeric>
                <bdi
                  className={
                    Number(column.netIncome) < 0
                      ? 'text-sm font-medium tabular-nums text-danger'
                      : 'text-sm font-medium tabular-nums'
                  }
                >
                  {formatMoney(column.netIncome, undefined, locale)}
                </bdi>
              </TableCell>
            </TableRow>
          ))}

          <TableRow>
            <TableCell className="min-w-[140px]">
              <span className="text-sm font-semibold text-foreground">{t('total')}</span>
            </TableCell>
            {(['revenue', 'costOfSales', 'grossProfit', 'expenses', 'netIncome'] as const).map(
              (key) => (
                <TableCell key={key} numeric>
                  <bdi className="text-sm font-semibold tabular-nums">
                    {formatMoney(total(key), undefined, locale)}
                  </bdi>
                </TableCell>
              ),
            )}
          </TableRow>
        </TableBody>
      </Table>
    </TableScroll>
  );
}
