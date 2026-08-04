'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { useContract } from '@/features/contracts/hooks/use-contracts';
import { fractionToPercent } from '@/features/contracts/contract-terms';
import { fromMinorUnits } from '@/features/receipts/allocation';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

import { useCertificatePaymentStatus, useIpc } from '../hooks/use-ipc';
import { grossDisagreementMinor, settlementFor } from '../settlement';
import { IpcEffectiveBadge, IpcStatusBadge, SettlementBadge } from './ipc-status-badge';

interface IpcDetailProps {
  contractId: string;
  ipaId: string;
  ipcId: string;
}

export function IpcDetail({ contractId, ipaId, ipcId }: IpcDetailProps) {
  const t = useTranslations('platform.ipc.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const certificate = useIpc(ipcId);
  // The contract carries the currency. The certificate has its own `currency` field, but the
  // contract is the authority on what this money is denominated in and is already cached.
  const contract = useContract(contractId);
  // Deliberately not blocking the page: a certificate is readable whether or not we can say
  // what has been paid against it. See `useCertificatePaymentStatus`.
  const payment = useCertificatePaymentStatus(ipcId);

  const backHref = `/contracts/${contractId}/applications/${ipaId}`;

  if (certificate.isPending || contract.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (certificate.isError || contract.isError) {
    const notFound = certificate.error instanceof ApiError && certificate.error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href={backHref}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const ipc = certificate.data;
  const currency = contract.data.currency;
  const reference = ipc.certificateRef ?? `#${ipc.certificateNumber}`;

  const settlement = settlementFor(ipc.netCertified, payment.data?.totalAllocated ?? null);
  const disagreement = grossDisagreementMinor(ipc.certifiedTotal, ipc.totalCertifiedAmount);

  return (
    <div className="space-y-8">
      <div>
        {/* See the note on the same link in `ipa-detail.tsx` — a standalone navigation link
            is a touch target and must clear 44px. */}
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>

        <div className="mt-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{reference}</span>
            <IpcStatusBadge status={ipc.status} />
            <IpcEffectiveBadge isEffective={ipc.isEffective} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            <bdi>{formatMoney(ipc.netCertified, currency, locale)}</bdi>
          </h1>
          <p className="text-sm text-muted-foreground">{t('netHeading')}</p>
        </div>
      </div>

      {/* A superseded certificate is history. Money must not be applied to it, and the
          allocation picker already excludes it — this says why, on the document itself. */}
      {!ipc.isEffective ? (
        <Alert
          variant="warning"
          messages={[
            ipc.supersessionReason
              ? t('supersededWithReason', {
                  date: formatDate(ipc.supersededAt, locale) ?? '',
                  reason: ipc.supersessionReason,
                })
              : t('superseded', { date: formatDate(ipc.supersededAt, locale) ?? '' }),
          ]}
        />
      ) : null}

      {/* The header total and the certificate's own lines disagree. Nothing on the server
          reconciles them (C1, #12), so the disagreement is shown rather than resolved. */}
      {disagreement !== null ? (
        <Alert
          variant="warning"
          messages={[
            t('grossMismatch', {
              stated: formatMoney(ipc.certifiedTotal, currency, locale) ?? ipc.certifiedTotal,
              summed:
                formatMoney(ipc.totalCertifiedAmount, currency, locale) ?? ipc.totalCertifiedAmount,
            }),
          ]}
        />
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('grossHeading')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(ipc.totalCertifiedAmount, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('deductionsHeading')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(ipc.totalDeductions, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('issued')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(ipc.issuedAt, locale) ?? t('notIssued')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('application')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              <Link
                href={backHref}
                className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
              >
                {t('openApplication')}
              </Link>
            </dd>
          </div>
        </dl>
      </section>

      <SettlementSection
        settlement={settlement}
        currency={currency}
        isPending={payment.isPending}
        isError={payment.isError}
      />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('itemsHeading')}</h2>

        {ipc.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
            <p className="text-sm font-medium text-foreground">{t('noItems')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {ipc.items.map((item) => {
              const cut = Number(item.varianceQuantity) < 0;

              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
                    <div className="min-w-0 flex-1">
                      {/* The API returns `applicationItemId` and nothing describing the line
                          — no BOQ code, no description (C15 on the application side). The
                          last segment is shown so two rows can be told apart. */}
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.applicationItemId.slice(-8)}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">
                        <bdi>{formatNumber(item.certifiedQuantity, locale)}</bdi>{' '}
                        <span className="text-muted-foreground">{t('certifiedQuantity')}</span>
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      <bdi>{formatMoney(item.certifiedAmount, currency, locale)}</bdi>
                    </p>
                  </div>

                  {/* A variance is the certifier disagreeing with the claim, and the reason is
                      the whole substance of that disagreement. It is required by the API
                      whenever they differ, so showing the variance without it would hide the
                      only explanation that exists. */}
                  {cut || item.varianceReason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <bdi>
                        {t('variance', {
                          quantity:
                            formatNumber(item.varianceQuantity, locale) ?? item.varianceQuantity,
                        })}
                      </bdi>
                      {item.varianceReason ? ` — ${item.varianceReason}` : null}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('deductionsHeading')}</h2>

        {ipc.deductions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
            <p className="text-sm font-medium text-foreground">{t('noDeductions')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noDeductionsHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {ipc.deductions.map((deduction) => (
              <li
                key={deduction.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{deduction.deductionType}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <bdi>{formatMoney(deduction.basis, currency, locale)}</bdi>
                    {deduction.rate ? (
                      <>
                        {' × '}
                        <bdi>{fractionToPercent(deduction.rate)}%</bdi>
                      </>
                    ) : null}
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  <bdi>{formatMoney(deduction.amount, currency, locale)}</bdi>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettlementSection({
  settlement,
  currency,
  isPending,
  isError,
}: {
  settlement: ReturnType<typeof settlementFor>;
  currency: string;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('platform.ipc.settlement');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-20 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        // The certificate is still fully readable — only what has been paid is unknown.
        <Alert variant="info" messages={[t('unavailable')]} />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SettlementBadge state={settlement.state} />
            {settlement.state === 'OVER_ALLOCATED' ? (
              <p className="text-xs text-danger">{t('overAllocatedHint')}</p>
            ) : null}
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t('allocated')}</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">
                <bdi>
                  {formatMoney(fromMinorUnits(settlement.allocatedMinor), currency, locale)}
                </bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('outstanding')}</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">
                <bdi>
                  {formatMoney(fromMinorUnits(settlement.outstandingMinor), currency, locale)}
                </bdi>
              </dd>
            </div>
          </dl>

          {/* Why this figure is derived here rather than taken from the endpoint that exists
              to report it. Stated on the screen because a finance officer comparing this to
              the API would otherwise find an unexplained difference. */}
          <p className="mt-4 text-xs text-muted-foreground">{t('derivedNote')}</p>
        </div>
      )}
    </section>
  );
}
