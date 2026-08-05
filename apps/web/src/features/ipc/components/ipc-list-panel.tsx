'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatMoney } from '@/lib/format';

import { useIpcs } from '../hooks/use-ipc';

interface IpcListPanelProps {
  applicationId: string;
  contractId: string;
  currency: string;
}

export function IpcListPanel({ applicationId, contractId, currency }: IpcListPanelProps) {
  const t = useTranslations('platform.ipc');
  const tList = useTranslations('platform.ipc.list');
  const locale = useLocale() as 'en' | 'ar';

  const { data: certs, isPending, isError } = useIpcs(applicationId);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{tList('heading')}</h2>

      {isError ? <Alert variant="error" messages={[tList('loadFailed')]} /> : null}

      {isPending ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
      ) : (certs ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">{tList('none')}</p>
        </div>
      ) : (
        <TableScroll aria-label={tList('heading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tList('colRef')}</TableHead>
                <TableHead>{tList('colStatus')}</TableHead>
                <TableHead numeric>{tList('colNet')}</TableHead>
                <TableHead>{tList('colIssued')}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {(certs ?? []).map((cert) => (
                <TableRow key={cert.id}>
                  {/* Ref + isEffective badge */}
                  <TableCell>
                    <Link
                      href={`/contracts/${contractId}/applications/${applicationId}/certificates/${cert.id}`}
                      className="font-medium text-brand-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                    >
                      {cert.certificateRef ?? `#${cert.certificateNumber}`}
                    </Link>
                    {cert.isEffective ? (
                      <Badge tone="live" className="ms-2 text-xs">
                        {t('effective')}
                      </Badge>
                    ) : null}
                    {cert.supersededAt ? (
                      <Badge tone="neutral" className="ms-2 text-xs opacity-60">
                        {t('superseded')}
                      </Badge>
                    ) : null}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <StatusBadge
                      status={cert.status}
                      label={t(`status.${cert.status}`)}
                    />
                  </TableCell>

                  {/* Net certified — comes from the detail endpoint only, so show gross from list */}
                  <TableCell numeric>
                    <bdi className="tabular-nums">
                      {formatMoney(cert.certifiedTotal, currency, locale)}
                    </bdi>
                  </TableCell>

                  {/* Issued date */}
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {cert.issuedAt ? formatDate(cert.issuedAt, locale) : '—'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </section>
  );
}
