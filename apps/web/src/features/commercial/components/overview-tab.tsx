'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, LtrValue, Skeleton, cn } from '@erp/ui';
import type { CommercialOverviewResponse, OverviewAttentionItem } from '@erp/types';

import { formatMoney } from '@/lib/format';

import { useCommercialOverview } from '../hooks/use-commercial';

export function OverviewTab({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial');
  const query = useCommercialOverview(projectId);

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-panel" />
        <Skeleton className="h-36 w-full rounded-panel" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[t('states.loadFailedHint')]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const overview = query.data;

  return (
    <div className="space-y-4">
      <section aria-label={t('overview.financialStrip.contractValue')}>
        <FinancialStrip overview={overview} />
      </section>

      <section aria-label={t('overview.currentPosition.title')}>
        <CurrentPositionCard overview={overview} projectId={projectId} />
      </section>

      {overview.attention.length > 0 && (
        <section aria-label={t('overview.attentionSection.title')}>
          <AttentionSection items={overview.attention} projectId={projectId} currency={overview.currency} />
        </section>
      )}
    </div>
  );
}

// ─── Financial Strip ──────────────────────────────────────────────────────────

function FinancialStrip({ overview }: { overview: CommercialOverviewResponse }) {
  const t = useTranslations('commercial.overview.financialStrip');
  const locale = useLocale() as 'en' | 'ar';
  const { financialPosition: fp, contract, currency } = overview;

  const money = (v: string | null) =>
    v === null ? '—' : (formatMoney(v, currency, locale) ?? v);

  const postedCreditNotes = fp.postedCreditNotes !== null && parseFloat(fp.postedCreditNotes) > 0;

  return (
    <dl className="grid overflow-hidden rounded-panel border border-border bg-surface shadow-e1 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCell
        label={t('contractValue')}
        value={money(contract.currentContractValue)}
      />
      <MetricCell
        label={t('netBilled')}
        value={money(fp.netBilled)}
        note={
          postedCreditNotes
            ? t('creditNoteNote', { amount: money(fp.postedCreditNotes) })
            : undefined
        }
      />
      <MetricCell label={t('collected')} value={money(fp.collected)} />
      <MetricCell
        label={t('outstanding')}
        value={money(fp.outstanding)}
        highlight={fp.outstanding !== null && parseFloat(fp.outstanding) > 0}
      />
      <MetricCell
        label={t('overdue')}
        value={money(fp.overdue)}
        highlight={fp.overdue !== null && parseFloat(fp.overdue) > 0}
        highlightColor="warning"
      />
    </dl>
  );
}

function MetricCell({
  label,
  value,
  note,
  highlight,
  highlightColor = 'default',
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
  highlightColor?: 'default' | 'warning';
}) {
  return (
    <div className="border-b border-border p-4 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2">
        <LtrValue
          className={cn(
            'text-h2 font-semibold tabular-nums',
            highlight && highlightColor === 'warning'
              ? 'text-warning'
              : highlight
                ? 'text-foreground'
                : 'text-foreground',
          )}
        >
          {value}
        </LtrValue>
      </dd>
      {note ? <dd className="mt-1 text-caption text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

// ─── Current Position Card ────────────────────────────────────────────────────

const STAGE_RING: Record<CommercialOverviewResponse['currentCycle']['stage'], string> = {
  REVIEW_FOR_BILLING: 'border-amber-400',
  READY_TO_BILL: 'border-amber-400',
  ALL_BILLED: 'border-border',
  ALL_COMPLETE: 'border-border',
  NO_CONTRACT: 'border-border',
};

function CurrentPositionCard({
  overview,
  projectId,
}: {
  overview: CommercialOverviewResponse;
  projectId: string;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const { currentCycle: cc, currency } = overview;

  const ringClass = STAGE_RING[cc.stage];

  const ctaHref = ((): string => {
    const base = `/projects/${projectId}/commercial/contract-milestones`;
    if (!cc.nextAction?.targetId) return base;
    const action = cc.nextAction.kind === 'PREPARE_INVOICE' ? 'prepare' : 'review';
    return `${base}?installment=${cc.nextAction.targetId}&action=${action}`;
  })();

  return (
    <div className={cn('rounded-panel border bg-surface p-5 shadow-e1', ringClass)}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t('overview.currentPosition.title')}
      </p>
      <h3 className="mt-1 text-h3 font-semibold text-foreground">{cc.title}</h3>
      {cc.description ? (
        <p className="mt-1 text-body-sm text-muted-foreground">{cc.description}</p>
      ) : null}
      {cc.amount !== null ? (
        <p className="mt-2 text-body-sm font-medium text-foreground">
          <LtrValue>{formatMoney(cc.amount, currency, locale) ?? cc.amount}</LtrValue>
        </p>
      ) : null}
      {cc.nextAction && cc.stage !== 'NO_CONTRACT' ? (
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={ctaHref}>{cc.nextAction.label}</Link>
          </Button>
        </div>
      ) : cc.stage === 'NO_CONTRACT' ? (
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${projectId}/commercial/contract-security`}>
              {t('overview.notActiveAction')}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Attention Section ────────────────────────────────────────────────────────

function AttentionSection({
  items,
  projectId,
  currency,
}: {
  items: OverviewAttentionItem[];
  projectId: string;
  currency: string;
}) {
  const t = useTranslations('commercial.overview.attentionSection');
  const locale = useLocale() as 'en' | 'ar';

  const money = (v: string) => formatMoney(v, currency, locale) ?? v;

  return (
    <div className="rounded-panel border border-border bg-surface shadow-e1">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <AttentionRow
            key={item.invoiceId}
            item={item}
            projectId={projectId}
            money={money}
            t={t}
          />
        ))}
      </ul>
    </div>
  );
}

function AttentionRow({
  item,
  projectId,
  money,
  t,
}: {
  item: OverviewAttentionItem;
  projectId: string;
  money: (v: string) => string;
  t: ReturnType<typeof useTranslations<'commercial.overview.attentionSection'>>;
}) {
  const href = `/projects/${projectId}/commercial/billing-collection?invoice=${item.invoiceId}`;

  const actionLabel =
    item.kind === 'ISSUED_NOT_SENT'
      ? t('sendToClient')
      : item.kind === 'OPEN_DISPUTE'
        ? t('viewDispute')
        : t('followUp');

  const headline = (() => {
    if (item.kind === 'OVERDUE_INVOICE' && item.daysOverdue !== undefined) {
      return `${item.headline} · ${money(item.amount)}`;
    }
    if (item.kind === 'OPEN_DISPUTE' && item.disputedAmount) {
      return `${item.headline} · ${money(item.disputedAmount)}`;
    }
    return `${item.headline} · ${money(item.amount)}`;
  })();

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption text-muted-foreground">{item.invoiceNumber}</p>
        <p className="mt-0.5 text-body-sm text-foreground">{headline}</p>
      </div>
      <Button asChild variant="ghost" size="sm" className="shrink-0">
        <Link href={href}>{actionLabel}</Link>
      </Button>
    </li>
  );
}
