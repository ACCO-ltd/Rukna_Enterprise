'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate } from '@/lib/format';

import { useAuditLogs } from '../hooks/use-audit-logs';

export function AuditLogsList() {
  const t = useTranslations('platform.auditLogs');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useAuditLogs();

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void refetch(); }}
            disabled={isFetching}
          >
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
      </div>
    );
  }

  return (
    <TableScroll aria-label={t('title')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colTime')}</TableHead>
            <TableHead>{t('colUser')}</TableHead>
            <TableHead>{t('colAction')}</TableHead>
            <TableHead>{t('colResource')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableEmpty colSpan={4}>
              <p>{t('empty')}</p>
            </TableEmpty>
          ) : (
            data.map((entry) => {
              const displayUser = entry.user
                ? `${entry.user.firstName} ${entry.user.lastName}`
                : entry.userId;

              return (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(entry.createdAt, locale) ?? entry.createdAt}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{displayUser}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs uppercase">{entry.action}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{entry.resource}</span>
                    <span className="ms-1 text-xs text-muted-foreground">{entry.resourceId}</span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableScroll>
  );
}
