'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatMoney } from '@/lib/format';
import type { Ipc } from '@/features/ipc/types';

import { useIpcs } from '../hooks/use-ipc';
import { IpcSupersessionDrawer } from './ipc-supersession-drawer';

interface IpcListPanelProps {
  applicationId: string;
  contractId: string;
  currency: string;
}

/** A cert is a candidate for supersession when it is non-effective, non-superseded, and not rejected. */
function isSupersessionCandidate(cert: Ipc): boolean {
  return !cert.isEffective && !cert.supersededAt && cert.status !== 'REJECTED';
}

export function IpcListPanel({ applicationId, contractId, currency }: IpcListPanelProps) {
  const t = useTranslations('platform.ipc');
  const tList = useTranslations('platform.ipc.list');
  const locale = useLocale() as 'en' | 'ar';

  const { data: certs, isPending, isError } = useIpcs(applicationId);

  const [pendingSupersession, setPendingSupersession] = useState<Ipc | null>(null);

  const effectiveCert = (certs ?? []).find((c) => c.isEffective) ?? null;
  const hasEffectiveCert = effectiveCert !== null;

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
                {/* Actions column — only rendered when at least one cert can be superseded */}
                {hasEffectiveCert ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}
              </TableRow>
            </TableHeader>

            <TableBody>
              {(certs ?? []).map((cert) => (
                <TableRow key={cert.id}>
                  {/* Ref + status badges */}
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

                  {/* Lifecycle status */}
                  <TableCell>
                    <StatusBadge status={cert.status} label={t(`status.${cert.status}`)} />
                  </TableCell>

                  {/* Gross certified (netCertified only on the detail response) */}
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

                  {/* Supersession action — only shown for candidate certs */}
                  {hasEffectiveCert ? (
                    <TableCell className="w-36 text-end">
                      {isSupersessionCandidate(cert) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={tList('makeEffectiveAriaLabel', {
                            ref: cert.certificateRef ?? `#${cert.certificateNumber}`,
                          })}
                          onClick={() => setPendingSupersession(cert)}
                        >
                          {tList('makeEffective')}
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {pendingSupersession ? (
        <IpcSupersessionDrawer
          open
          applicationId={applicationId}
          newCert={pendingSupersession}
          effectiveCert={effectiveCert}
          onClose={() => setPendingSupersession(null)}
        />
      ) : null}
    </section>
  );
}
