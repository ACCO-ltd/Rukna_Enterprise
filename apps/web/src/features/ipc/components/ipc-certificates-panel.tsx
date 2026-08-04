'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { useIpcs } from '../hooks/use-ipc';
import { IpcEffectiveBadge, IpcStatusBadge } from './ipc-status-badge';

/**
 * Whether this build can issue a certificate.
 *
 * `POST /ipc` requires the client to compute `certifiedTotal` and every deduction amount,
 * and stores whatever it is sent without checking it against the items it just priced. That
 * is C1, issue #12, and until it is settled the frontend will not author contract
 * valuation — a wrong retention figure is money, taken from a real person, on a document
 * they pay against.
 *
 * The consequence is that no certificate can be created through this application at all, so
 * the empty state below says so. Flipping this to `true` when issuance ships removes that
 * sentence and nothing else; it is a constant rather than an inline condition so it cannot
 * be half-removed.
 */
export const ISSUANCE_AVAILABLE = false;

interface IpcCertificatesPanelProps {
  contractId: string;
  ipaId: string;
  currency: string;
}

export function IpcCertificatesPanel({ contractId, ipaId, currency }: IpcCertificatesPanelProps) {
  const t = useTranslations('platform.ipc.panel');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const certificates = useIpcs(ipaId);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>

      {certificates.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-24 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : certificates.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : certificates.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          {/* "Not certified yet" is a real state of an application, and on its own it implies
              a certificate could arrive through normal use. It cannot — nothing in this
              application can create one. Saying only the first half would leave someone
              waiting for something that is not coming. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {ISSUANCE_AVAILABLE ? t('noneHint') : t('issuanceUnavailable')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {certificates.data.map((certificate) => (
            <li key={certificate.id}>
              {/* Fills the row so the whole thing is a touch target, not just the text —
                  a certificate reference is a handful of characters inside a 45px row. */}
              <Link
                href={`/contracts/${contractId}/applications/${ipaId}/certificates/${certificate.id}`}
                className="flex flex-col gap-2 px-4 py-3 hover:bg-muted sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium text-foreground">
                      {certificate.certificateRef ?? `#${certificate.certificateNumber}`}
                    </span>
                    <IpcStatusBadge status={certificate.status} />
                    <IpcEffectiveBadge isEffective={certificate.isEffective} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {certificate.issuedAt
                      ? t('issuedOn', { date: formatDate(certificate.issuedAt, locale) ?? '' })
                      : t('notIssued')}
                  </p>
                </div>
                {/* The gross figure, labelled as gross. The net is on the detail page, where
                    the deductions that produce it are visible beside it — a bare number here
                    would be read as what the client owes, and it is not. */}
                <div className="text-start sm:text-end">
                  <p className="text-sm font-semibold text-foreground">
                    <bdi>{formatMoney(certificate.certifiedTotal, currency, locale)}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">{t('grossLabel')}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
