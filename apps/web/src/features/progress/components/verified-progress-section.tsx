'use client';

import { useTranslations } from 'next-intl';
import { Alert, SectionHeader } from '@erp/ui';
import { ClipboardCheck } from 'lucide-react';
import type { ProgressPeriodComparisonResponse } from '@erp/types';

import { formatDate, formatNumber } from '@/lib/format';

import { useProgressPeriodComparison, useProjectProgress } from '../hooks/use-progress';
import {
  RefButton,
  RefCard,
  RefCardBody,
  RefCardHeader,
  RefEmpty,
  RefTable,
  RefTableScroll,
  RefTbody,
  RefTd,
  RefTh,
  RefThead,
  RefTr,
} from './ref-ui';

/** Verified physical progress per BOQ leaf (approved DPRs only), plus a period-over-period summary. */
export function VerifiedProgressSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const { data, isPending, isError, refetch, isFetching } = useProjectProgress(projectId);
  const comparisonQuery = useProgressPeriodComparison(projectId);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-48 animate-pulse rounded-xl bg-gray-100" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <RefButton variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {t('actions.retry')}
          </RefButton>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {/* Overall period-over-period comparison (BE-1 is overall-only; per-leaf deltas are BE-2). */}
      <PeriodComparison query={comparisonQuery} />

      <RefCard>
        <RefCardHeader
          icon={<ClipboardCheck size={17} strokeWidth={1.9} />}
          iconTone="green"
          title={t('verified.title')}
          subtitle={data.length > 0 ? t('verified.subtitle') : undefined}
          divider
        />
        <RefCardBody className="pt-4">
          {data.length === 0 ? (
            <RefEmpty title={t('verified.empty')} />
          ) : (
            <RefTableScroll aria-label={t('verified.title')}>
              <RefTable>
                <RefThead>
                  <RefTr>
                    <RefTh>{t('verified.col.code')}</RefTh>
                    <RefTh>{t('verified.col.description')}</RefTh>
                    <RefTh numeric>{t('verified.col.measurable')}</RefTh>
                    <RefTh numeric>{t('verified.col.verified')}</RefTh>
                    <RefTh numeric>{t('verified.col.percent')}</RefTh>
                  </RefTr>
                </RefThead>
                <RefTbody>
                  {data.map((line) => (
                    <RefTr key={line.boqNodeId}>
                      <RefTd className="whitespace-nowrap font-mono text-xs">{line.code}</RefTd>
                      <RefTd>{line.description}</RefTd>
                      <RefTd numeric className="whitespace-nowrap tabular-nums">
                        {formatNumber(line.measurableQuantity, 'en', 3)}
                      </RefTd>
                      <RefTd numeric className="whitespace-nowrap tabular-nums">
                        {formatNumber(line.verifiedToDate, 'en', 3)}
                      </RefTd>
                      <RefTd numeric className="whitespace-nowrap font-medium tabular-nums">
                        {line.percentComplete === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          `${line.percentComplete}%`
                        )}
                      </RefTd>
                    </RefTr>
                  ))}
                </RefTbody>
              </RefTable>
            </RefTableScroll>
          )}
        </RefCardBody>
      </RefCard>
    </div>
  );
}

/**
 * Overall this-period-vs-previous physical and verified %, with the Δ. The Δ may use an up/down
 * status colour (it *is* a directional status). When fewer than two snapshots exist, `physical`
 * and `verified` are null — we say so plainly rather than inventing a delta.
 */
function PeriodComparison({
  query,
}: {
  query: ReturnType<typeof useProgressPeriodComparison>;
}) {
  const t = useTranslations('progress');

  // A failed/loading comparison must not block the verified table below it — omit quietly.
  if (query.isPending || query.isError || !query.data) return null;

  const c = query.data;

  return (
    <div className="space-y-3">
      <SectionHeader title={t('comparison.title')} />
      {c.physical === null && c.verified === null ? (
        <p className="text-sm text-gray-500">{t('comparison.insufficient')}</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {t('comparison.range', {
              previous: formatDate(c.previousPeriodEndDate) ?? '—',
              current: formatDate(c.currentPeriodEndDate) ?? '—',
            })}
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComparisonRow label={t('comparison.physical')} metric={c.physical} />
            <ComparisonRow label={t('comparison.verified')} metric={c.verified} />
          </dl>
        </>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  metric,
}: {
  label: string;
  metric: ProgressPeriodComparisonResponse['physical'];
}) {
  const t = useTranslations('progress');

  if (metric === null) {
    return (
      <div className="border-y border-gray-100 py-3">
        <dt className="text-xs uppercase text-gray-500">{label}</dt>
        <dd className="mt-1 text-gray-400">—</dd>
      </div>
    );
  }

  const { previous, current, delta } = metric;
  // Δ direction is a status: up is good (progress rose), flat/down is neutral/attention.
  const deltaTone = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-500';
  const deltaLabel = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`;

  return (
    <div className="border-y border-gray-100 py-3">
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-sm text-gray-500 tabular-nums">
          {t('comparison.previousToCurrent', { previous: `${previous}%`, current: `${current}%` })}
        </span>
        <span className={`text-sm font-medium tabular-nums ${deltaTone}`}>{deltaLabel}</span>
      </dd>
    </div>
  );
}
