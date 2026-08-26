'use client';

import type { CommercialApplicationRow, CommercialSummaryResponse } from '@erp/types';
import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
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
import { useCommercialApplications } from '../hooks/use-commercial';
import { errorText } from './commercial-workspace';

/** Quantity-surveyor workspace: application and certification, without AR settlement noise. */
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
  if (query.isError)
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
  const data = query.data;
  if (!data.contractId)
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
      />
    );
  const contractId = data.contractId;
  if (data.applications.length === 0)
    return (
      <EmptyState
        icon={<FilePlus2 size={24} aria-hidden="true" />}
        variant="page"
        title={t('applications.emptyTitle')}
        description={t('applications.emptyHint')}
        action={
          data.capabilities.canCreateApplication && data.contractId ? (
            <Button asChild>
              <Link href={`/contracts/${data.contractId}/applications/new`}>
                {t('applications.create')}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );

  const money = (value: string | null) =>
    value === null
      ? summary.financialsVisible
        ? t('states.notSet')
        : t('metricState.restricted')
      : formatMoney(value, summary.currency, locale);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-h3 font-semibold text-foreground">{t('applications.title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('applications.subtitle')}</p>
      </div>
      <dl className="grid overflow-hidden rounded-panel border border-border bg-surface shadow-e1 sm:grid-cols-3">
        <Count
          label={t('applications.summary.open')}
          value={data.applications.filter((row) => !row.ipcId).length}
        />
        <Count
          label={t('applications.summary.submitted')}
          value={summary.certification.applicationsSubmitted}
        />
        <Count
          label={t('applications.summary.certified')}
          value={summary.certification.effectiveCertificates}
        />
      </dl>
      <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('applications.col.application')}</TableHead>
                <TableHead>{t('applications.col.period')}</TableHead>
                <TableHead className="text-end">{t('applications.col.claimed')}</TableHead>
                <TableHead>{t('applications.col.certificate')}</TableHead>
                <TableHead className="text-end">{t('applications.col.certified')}</TableHead>
                <TableHead className="text-end">{t('applications.col.deductions')}</TableHead>
                <TableHead className="text-end">{t('applications.col.net')}</TableHead>
                <TableHead>{t('applications.col.nextAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.applications.map((row) => (
                <ApplicationRow
                  key={row.ipaId}
                  contractId={contractId}
                  row={row}
                  money={money}
                  t={t}
                  locale={locale}
                />
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0 sm:border-b-0 sm:not-last:border-e">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-h2 font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function ApplicationRow({
  contractId,
  row,
  money,
  t,
  locale,
}: {
  contractId: string;
  row: CommercialApplicationRow;
  money: (value: string | null) => string | null;
  t: (key: string) => string;
  locale: 'en' | 'ar';
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.applicationRef ?? `#${row.applicationNumber ?? '-'}`}
      </TableCell>
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        {row.periodFrom ? formatDate(row.periodFrom, locale) : '-'}
        {row.periodTo ? ` - ${formatDate(row.periodTo, locale)}` : ''}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(row.claimedAmount)}</TableCell>
      {/*
        A1: the read model returns the effective certificate's raw cuid (`ipcId`) and no human
        reference — the applications read model carries no `certificateRef`/`certificateNumber`
        (unlike the per-contract IPC list, which does). Rendering `ipcId` leaked a database id
        into the CERTIFICATE column. Until the read model exposes a human ref, show the
        certificate's lifecycle state as its human value when one exists, and `—` when none does
        — never the cuid (ux-doctrine §3).
      */}
      <TableCell>
        {row.ipcId && row.ipcStatus ? t(`applications.certificate.${row.ipcStatus}`) : '—'}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(row.certifiedGross)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.deductions)}</TableCell>
      <TableCell className="text-end font-medium tabular-nums">{money(row.certifiedNet)}</TableCell>
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/contracts/${contractId}/applications/${row.ipaId}`}>
            {row.nextAction === 'NONE' ? t('actions.open') : t(`nextAction.${row.nextAction}`)}
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
