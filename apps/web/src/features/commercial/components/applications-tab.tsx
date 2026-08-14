'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';
import type { CommercialApplicationRow, CommercialSummaryResponse } from '@erp/types';

import { useCommercialApplications } from '../hooks/use-commercial';
import { settlementTone } from '../presentation';
import { errorText } from './commercial-workspace';

/** C3 — Applications & Certificates: the consolidated IPA → IPC → invoice → settlement chain. */
export function ApplicationsTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const query = useCommercialApplications(projectId);

  if (query.isPending) return <Skeleton className="h-72 w-full" />;

  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[errorText(query.error, t('states.loadFailedHint'))]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const data = query.data;

  if (!data.contractId) {
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
      />
    );
  }

  if (data.applications.length === 0) {
    return (
      <EmptyState variant="page" title={t('applications.emptyTitle')} description={t('applications.emptyHint')} />
    );
  }

  const money = (v: string | null) =>
    v === null
      ? summary.financialsVisible
        ? '—'
        : t('metricState.restrictedShort')
      : formatMoney(v, summary.currency, locale);

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('applications.col.application')}</TableHead>
            <TableHead>{t('applications.col.period')}</TableHead>
            <TableHead className="text-end">{t('applications.col.claimed')}</TableHead>
            <TableHead className="text-end">{t('applications.col.certified')}</TableHead>
            <TableHead className="text-end">{t('applications.col.deductions')}</TableHead>
            <TableHead className="text-end">{t('applications.col.net')}</TableHead>
            <TableHead>{t('applications.col.invoice')}</TableHead>
            <TableHead className="text-end">{t('applications.col.received')}</TableHead>
            <TableHead className="text-end">{t('applications.col.outstanding')}</TableHead>
            <TableHead>{t('applications.col.settlement')}</TableHead>
            <TableHead>{t('applications.col.nextAction')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.applications.map((row) => (
            <Row key={row.ipaId} row={row} money={money} t={t} locale={locale} />
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

function Row({
  row,
  money,
  t,
  locale,
}: {
  row: CommercialApplicationRow;
  money: (v: string | null) => string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: 'en' | 'ar';
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.applicationRef ?? `#${row.applicationNumber ?? '—'}`}
        {row.supersededCertificateCount > 0 ? (
          <span className="ms-1 text-caption text-muted-foreground">
            ({t('applications.superseded', { count: row.supersededCertificateCount })})
          </span>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        {row.periodFrom ? formatDate(row.periodFrom, locale) : '—'}
        {row.periodTo ? ` – ${formatDate(row.periodTo, locale)}` : ''}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(row.claimedAmount)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.certifiedGross)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.deductions)}</TableCell>
      <TableCell className="text-end font-medium tabular-nums">{money(row.certifiedNet)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {row.invoiceNumber ?? (row.invoiceId ? t('applications.draftInvoice') : '—')}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(row.receivedAmount)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.outstandingAmount)}</TableCell>
      <TableCell>
        <Badge tone={settlementTone(row.settlement)}>{t(`settlement.${row.settlement}`)}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        {row.nextAction === 'NONE' ? '—' : t(`nextAction.${row.nextAction}`)}
      </TableCell>
    </TableRow>
  );
}
