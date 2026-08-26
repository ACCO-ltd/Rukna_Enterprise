'use client';

import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { ProgressPeriodComparisonResponse } from '@erp/types';

import { formatDate, formatNumber } from '@/lib/format';

import { useProgressPeriodComparison, useProjectProgress } from '../hooks/use-progress';

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
        <div className="h-48 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {t('actions.retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall period-over-period comparison (BE-1 is overall-only; per-leaf deltas are BE-2). */}
      <PeriodComparison query={comparisonQuery} />

      <div className="space-y-3">
        <SectionHeader title={t('verified.title')} />
        {data.length === 0 ? (
          <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t('verified.empty')}</p>
          </div>
        ) : (
          <>
            <p className="text-body-sm text-muted-foreground">{t('verified.subtitle')}</p>
            <TableScroll aria-label={t('verified.title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('verified.col.code')}</TableHead>
                    <TableHead>{t('verified.col.description')}</TableHead>
                    <TableHead numeric>{t('verified.col.measurable')}</TableHead>
                    <TableHead numeric>{t('verified.col.verified')}</TableHead>
                    <TableHead numeric>{t('verified.col.percent')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((line) => (
                    <TableRow key={line.boqNodeId}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {line.code}
                      </TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell numeric className="whitespace-nowrap tabular-nums">
                        {formatNumber(line.measurableQuantity, 'en', 3)}
                      </TableCell>
                      <TableCell numeric className="whitespace-nowrap tabular-nums">
                        {formatNumber(line.verifiedToDate, 'en', 3)}
                      </TableCell>
                      <TableCell numeric className="whitespace-nowrap font-medium tabular-nums">
                        {line.percentComplete === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          `${line.percentComplete}%`
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </>
        )}
      </div>
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
        <p className="text-body-sm text-muted-foreground">{t('comparison.insufficient')}</p>
      ) : (
        <>
          <p className="text-caption text-muted-foreground">
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
      <div className="border-y border-border py-3">
        <dt className="text-micro uppercase text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-muted-foreground">—</dd>
      </div>
    );
  }

  const { previous, current, delta } = metric;
  // Δ direction is a status: up is good (progress rose), flat/down is neutral/attention.
  const deltaTone =
    delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted-foreground';
  const deltaLabel = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`;

  return (
    <div className="border-y border-border py-3">
      <dt className="text-micro uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-body-sm text-muted-foreground tabular-nums">
          {t('comparison.previousToCurrent', { previous: `${previous}%`, current: `${current}%` })}
        </span>
        <span className={`text-body-sm font-medium tabular-nums ${deltaTone}`}>{deltaLabel}</span>
      </dd>
    </div>
  );
}
