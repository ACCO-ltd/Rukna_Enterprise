'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, CircleCheck, Circle } from 'lucide-react';
import { cn, Progress, StatTile } from '@erp/ui';
import type { FinanceHome as FinanceHomeData, GuideCycle } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { useApprovalsInbox } from '@/features/approvals/hooks';
import { findCycle, useAccountingGuide } from '@/features/finance/hooks/use-accounting-guide';
import { ShareBar, toSegments } from '@/features/finance/components/share-bar';
import { formatDate, formatMoney } from '@/lib/format';

import { useFinanceHome } from './hooks';

const tileLink = ({ href, className, children }: { href: string; className: string; children: React.ReactNode }) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

const usd = (amount: string | null | undefined) => (amount == null ? null : (formatMoney(amount, 'USD') ?? amount));

/**
 * Step 4 (ADR-047 §4) — Finance Home: the finance team's start page. The setup checklist leads
 * until setup is complete; then the money: cash in the bank, what clients owe and how late, what
 * is owed to suppliers and when, what waits on the reader, and this month's money in and out.
 * Every figure links to the list behind it.
 */
export function FinanceHome() {
  const t = useTranslations('finance.home');
  const home = useFinanceHome();
  const guide = useAccountingGuide();
  const approvals = useApprovalsInbox();
  const setup = findCycle(guide.data, 'setup');

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={t('title')}
        summary={home.data ? t('asOf', { date: formatDate(home.data.asOf) ?? home.data.asOf }) : undefined}
      />

      {guide.data && setup && setupOutstanding(setup) ? (
        <SetupChecklist cycle={setup} company={guide.data.organizationName} ready={guide.data.ready} />
      ) : null}

      {home.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void home.refetch()} />
      ) : home.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-panel border border-border bg-muted" />
          ))}
        </div>
      ) : (
        <HomeBody data={home.data} approvalsCount={approvals.data?.count ?? null} />
      )}
    </div>
  );
}

function HomeBody({ data, approvalsCount }: { data: FinanceHomeData; approvalsCount: number | null }) {
  const t = useTranslations('finance.home');
  const { cash, receivables, payables, month } = data;

  return (
    <>
      <section aria-label={t('headlines')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cash ? (
          <StatTile label={t('cash')} value={usd(cash.total)} note={t('cashNote', { count: cash.accounts.length })} href="/finance/accounting/bank-accounts" renderLink={tileLink} />
        ) : null}
        {receivables ? (
          <StatTile
            label={t('owedToUs')}
            value={usd(receivables.outstanding)}
            note={Number(receivables.overdue) > 0 ? t('overdueNote', { amount: usd(receivables.overdue) ?? '' }) : t('nothingOverdue')}
            href="/finance/accounting/aging/receivables"
            renderLink={tileLink}
          />
        ) : null}
        {payables ? (
          <StatTile
            label={t('weOwe')}
            value={usd(payables.outstanding)}
            note={
              payables.dueThisWeekCount > 0
                ? t('dueThisWeekNote', { amount: usd(payables.dueThisWeek) ?? '', count: payables.dueThisWeekCount })
                : Number(payables.overdue) > 0
                  ? t('overdueNote', { amount: usd(payables.overdue) ?? '' })
                  : t('nothingDue')
            }
            href="/finance/accounting/aging/payables"
            renderLink={tileLink}
          />
        ) : null}
        <StatTile
          label={t('waiting')}
          value={approvalsCount === null ? null : String(approvalsCount)}
          note={approvalsCount ? t('waitingNote') : t('waitingNone')}
          href="/approvals"
          renderLink={tileLink}
        />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {receivables ? <ReceivablesCard data={receivables} /> : null}
        <div className="space-y-6">
          {month ? <MonthCard data={month} /> : null}
          {cash ? <CashCard data={cash} /> : null}
        </div>
      </div>
    </>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-border bg-surface" aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-body font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-body-sm font-medium text-brand-primary hover:underline">
      {label} <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

function ReceivablesCard({ data }: { data: NonNullable<FinanceHomeData['receivables']> }) {
  const t = useTranslations('finance.home');
  const segments = toSegments(
    data.aging.map((b) => ({ key: b.key, label: t(`aging.${b.key}`), amount: b.amount })),
    t('aging.other'),
  );
  return (
    <Card title={t('agingTitle')} action={<SeeAll href="/finance/accounting/aging/receivables" label={t('fullAging')} />}>
      <ShareBar title={t('agingTitle')} segments={segments} total={data.outstanding} currency="USD" totalLabel={t('outstanding')} />
      <table className="w-full text-body-sm">
        <caption className="sr-only">{t('agingTitle')}</caption>
        <thead>
          <tr className="border-y border-border bg-surface-subtle text-caption text-muted-foreground">
            <th scope="col" className="px-4 py-2 text-start font-medium sm:px-5">{t('colAge')}</th>
            <th scope="col" className="px-2 py-2 text-end font-medium">{t('colInvoices')}</th>
            <th scope="col" className="px-4 py-2 text-end font-medium sm:px-5">{t('colAmount')}</th>
          </tr>
        </thead>
        <tbody>
          {data.aging.map((b) => (
            <tr key={b.key} className="border-b border-border last:border-b-0">
              <th scope="row" className={cn('px-4 py-2 text-start font-normal sm:px-5', b.key === 'd90_plus' && Number(b.amount) > 0 && 'font-semibold text-danger')}>
                {t(`aging.${b.key}`)}
              </th>
              <td className="px-2 py-2 text-end tabular-nums text-muted-foreground">{b.count}</td>
              <td className="px-4 py-2 text-end tabular-nums sm:px-5">{usd(b.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.topOverdue.length > 0 ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">{t('topOverdue')}</h3>
          <ul className="mt-2 divide-y divide-border">
            {data.topOverdue.map((c) => (
              <li key={c.clientId} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/finance/accounting/invoices?clientId=${c.clientId}`} className="min-w-0 truncate font-medium text-foreground hover:underline">
                  {c.clientName}
                </Link>
                <span className="shrink-0 text-end">
                  <span className="block font-semibold tabular-nums">{usd(c.overdue)}</span>
                  <span className="block text-caption text-muted-foreground">{t('daysLate', { count: c.oldestDaysLate })}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function MonthCard({ data }: { data: NonNullable<FinanceHomeData['month']> }) {
  const t = useTranslations('finance.home');
  const rows = [
    { key: 'invoiced', amount: data.invoiced, href: '/finance/accounting/invoices' },
    { key: 'collected', amount: data.collected, href: '/receipts' },
    { key: 'paid', amount: data.paid, href: '/finance/accounting/payments' },
  ] as const;
  return (
    <Card title={t('monthTitle')}>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <dt>
              <Link href={r.href} className="text-body-sm text-foreground hover:underline">
                {t(`month.${r.key}`)}
              </Link>
            </dt>
            <dd className="font-semibold tabular-nums">{usd(r.amount)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function CashCard({ data }: { data: NonNullable<FinanceHomeData['cash']> }) {
  const t = useTranslations('finance.home');
  return (
    <Card title={t('cashTitle')} action={<SeeAll href="/finance/accounting/bank-accounts" label={t('banks')} />}>
      {data.accounts.length === 0 ? (
        <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('noBanks')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.accounts.map((a) => (
            <li key={a.bankAccountId} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-medium text-foreground">{a.bankName}</span>
                <span className="block truncate text-caption text-muted-foreground">{a.accountName}</span>
              </span>
              <span className={cn('shrink-0 font-semibold tabular-nums', Number(a.balance) < 0 && 'text-danger')}>{usd(a.balance)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The checklist stays until every step is done (or not for this reader to do). */
function setupOutstanding(cycle: GuideCycle): boolean {
  return cycle.steps.some((s) => s.status !== 'DONE' && s.status !== 'NA' && s.status !== 'RESTRICTED');
}

/**
 * Step 5 — "Get {company} ready": a progress bar and the eight setup steps, done ones ticked and
 * the current one highlighted. Optional steps are labelled; once the ledger can post, a line says
 * the rest is optional so the card informs rather than nags.
 */
function SetupChecklist({ cycle, company, ready }: { cycle: GuideCycle; company: string; ready: boolean }) {
  const t = useTranslations('finance.home');
  const done = cycle.steps.filter((s) => s.status === 'DONE').length;
  const next = cycle.steps.find((s) => s.status !== 'DONE' && s.href);
  return (
    <section className="rounded-panel border border-brand-primary/30 bg-brand-accent px-4 py-4 sm:px-5" aria-label={t('setupTitle', { company })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-foreground">{t('setupTitle', { company })}</h2>
          <p className="text-body-sm text-muted-foreground">
            {t('setupProgress', { done, total: cycle.steps.length })}
            {ready ? ` · ${t('setupReadyNote')}` : ''}
          </p>
          <Progress className="mt-2 max-w-md" value={done} max={cycle.steps.length} label={t('setupProgressLabel')} />
        </div>
        {next?.href ? (
          <Link href={next.href} className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-brand-primary px-3 text-body-sm font-medium text-brand-on-primary hover:bg-brand-primary-hover">
            {t('setupNext', { step: next.label })} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <ol className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {cycle.steps.map((s) => {
          const current = s === next;
          return (
            <li
              key={s.key}
              aria-current={current ? 'step' : undefined}
              className={cn('flex min-h-8 items-center gap-2 rounded-control px-2 text-body-sm', current && 'bg-surface font-medium ring-1 ring-brand-primary/40')}
            >
              {s.status === 'DONE' ? (
                <CircleCheck size={16} className="shrink-0 text-success" aria-label={t('stepDone')} />
              ) : (
                <Circle size={16} className={cn('shrink-0', current ? 'text-brand-primary' : 'text-muted-foreground')} aria-label={t('stepTodo')} />
              )}
              {s.href && s.status !== 'DONE' ? (
                <Link href={s.href} className="min-w-0 truncate text-foreground hover:underline">{s.label}</Link>
              ) : (
                <span className={cn('min-w-0 truncate', s.status === 'DONE' ? 'text-muted-foreground' : 'text-foreground')}>{s.label}</span>
              )}
              {s.optional && s.status !== 'DONE' ? <span className="shrink-0 text-caption text-muted-foreground">{t('setupOptional')}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
