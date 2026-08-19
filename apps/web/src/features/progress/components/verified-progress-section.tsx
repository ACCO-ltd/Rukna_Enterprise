'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatNumber } from '@/lib/format';

import { useProjectProgress } from '../hooks/use-progress';

/** Verified physical progress per BOQ leaf (approved DPRs only). Read-only. */
export function VerifiedProgressSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useProjectProgress(projectId);

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

  if (data.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t('verified.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
                <TableCell className="whitespace-nowrap font-mono text-xs">{line.code}</TableCell>
                <TableCell>{line.description}</TableCell>
                <TableCell numeric className="whitespace-nowrap tabular-nums">
                  {formatNumber(line.measurableQuantity, locale, 3)}
                </TableCell>
                <TableCell numeric className="whitespace-nowrap tabular-nums">
                  {formatNumber(line.verifiedToDate, locale, 3)}
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
    </div>
  );
}
