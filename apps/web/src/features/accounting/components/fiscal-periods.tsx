'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  type BadgeTone,
  Sheet,
  SheetContent,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate } from '@/lib/format';

import { useFiscalYears } from '../hooks/use-accounting';
import type { AccountingPeriod, FiscalYear, FiscalYearStatus, PeriodStatus } from '../types';
import { CreateFiscalYearForm } from './create-fiscal-year-form';
import { FiscalYearCloseAction, PeriodActions } from './period-actions';

/**
 * Period status is the single most consequential thing on this screen: it decides whether a
 * journal dated in that month can be posted at all. `CLOSED` is `danger` not because closing
 * is a fault but because it is the state that rejects work.
 */
const PERIOD_TONES: Record<PeriodStatus, BadgeTone> = {
  OPEN: 'live',
  LOCKED: 'warning',
  CLOSED: 'danger',
  REOPENED: 'accent',
};

const YEAR_TONES: Record<FiscalYearStatus, BadgeTone> = {
  DRAFT: 'neutral',
  OPEN: 'live',
  LOCKED: 'warning',
  CLOSED: 'danger',
};

export function FiscalPeriods() {
  const t = useTranslations('accounting.periods');
  const tActions = useTranslations('accounting.periodActions');
  const tCommon = useTranslations('common');

  const years = useFiscalYears();
  const [creating, setCreating] = useState(false);
  const { can } = usePermissions();

  if (years.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (years.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(ACCOUNTING_PERMISSIONS.manageChart) ? (
          <Button type="button" onClick={() => setCreating(true)}>
            {t('create.new')}
          </Button>
        ) : null}
      </div>

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent className="p-6">
          <SheetTitle className="text-lg font-semibold text-foreground">
            {t('create.title')}
          </SheetTitle>
          <div className="mt-5">
            <CreateFiscalYearForm onDone={() => setCreating(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* The lifecycle endpoints carry `JwtAuthGuard` and nothing else — any signed-in user
          can close a fiscal year (#25). The actions are gated on `can()` so one flag secures
          them when a guard lands, but that is presentation only, and saying so is more honest
          than a screen that looks authorised. */}
      <Alert variant="warning" messages={[tActions('unauthorizedNote')]} />

      {years.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {years.data.map((year) => (
            <FiscalYearPanel key={year.id} year={year} />
          ))}
        </div>
      )}
    </div>
  );
}

function FiscalYearPanel({ year }: { year: FiscalYear }) {
  const t = useTranslations('accounting.periods');
  const tActions = useTranslations('accounting.periodActions');
  const locale = useLocale() as 'en' | 'ar';

  const openCount = year.periods.filter(
    (p) => p.status === 'OPEN' || p.status === 'REOPENED',
  ).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{year.name}</h2>
          <Badge tone={YEAR_TONES[year.status] ?? 'neutral'}>{t(`yearStatus.${year.status}`)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-xs text-muted-foreground">
            <bdi>
              {t('yearRange', {
                start: formatDate(year.startDate, locale) ?? year.startDate,
                end: formatDate(year.endDate, locale) ?? year.endDate,
              })}
            </bdi>
          </p>
          <FiscalYearCloseAction year={year} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('periodCount', { count: year.periods.length })} · {t('openCount', { count: openCount })}
      </p>

      {year.periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <TableScroll aria-label={`${year.name} — ${t('title')}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">{t('colPeriod')}</TableHead>
                <TableHead>{t('colRange')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tActions('heading')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {year.periods.map((period) => (
                <PeriodRow key={period.id} period={period} locale={locale} />
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </section>
  );
}

function PeriodRow({ period, locale }: { period: AccountingPeriod; locale: 'en' | 'ar' }) {
  const t = useTranslations('accounting.periods');

  return (
    <TableRow>
      <TableCell className="min-w-[140px]">
        <span className="text-sm text-foreground">{period.name}</span>
        <span className="ms-2 font-mono text-xs text-muted-foreground tabular-nums">
          #{period.periodNumber}
        </span>
      </TableCell>

      <TableCell>
        <span className="text-sm text-muted-foreground">
          <bdi>
            {formatDate(period.startDate, locale)} — {formatDate(period.endDate, locale)}
          </bdi>
        </span>
      </TableCell>

      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge tone={PERIOD_TONES[period.status] ?? 'neutral'}>
            {t(`status.${period.status}`)}
          </Badge>
          {/* What the status means for posting. A period list whose statuses are only badges
              leaves the reader to remember which of four words accepts a journal. */}
          <span className="text-xs text-muted-foreground">{t(`statusHint.${period.status}`)}</span>
          {period.reopenReason ? (
            <span className="text-xs text-muted-foreground">{period.reopenReason}</span>
          ) : null}
        </div>
      </TableCell>

      <TableCell>
        <PeriodActions period={period} />
      </TableCell>
    </TableRow>
  );
}
