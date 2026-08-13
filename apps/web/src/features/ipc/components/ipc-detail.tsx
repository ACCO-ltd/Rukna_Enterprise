'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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

import { useBoqTree } from '@/features/boq/hooks/use-boq';
import { fractionToPercent } from '@/features/contracts/contract-terms';
import { useContract } from '@/features/contracts/hooks/use-contracts';
import { useIpa } from '@/features/ipa/hooks/use-ipa';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { BoqTreeNode, IpcItem } from '@/lib/api-types';

import { useCertificatePaymentStatus, useIpc, useIpcs } from '../hooks/use-ipc';
import { grossDisagreementMinor, settlementFor } from '../settlement';
import { IpcBillingCard } from './ipc-billing-card';
import { IpcEffectiveBadge, IpcStatusBadge, SettlementBadge } from './ipc-status-badge';
import { IpcSupersessionDrawer } from './ipc-supersession-drawer';

interface IpcDetailProps {
  contractId: string;
  ipaId: string;
  ipcId: string;
}

/** Flattens a BOQ tree into an id→node map. */
function flattenTree(nodes: BoqTreeNode[]): Record<string, BoqTreeNode> {
  const map: Record<string, BoqTreeNode> = {};
  const visit = (ns: BoqTreeNode[]) => {
    for (const n of ns) {
      map[n.id] = n;
      if (n.children.length) visit(n.children);
    }
  };
  visit(nodes);
  return map;
}

export function IpcDetail({ contractId, ipaId, ipcId }: IpcDetailProps) {
  const t = useTranslations('platform.ipc.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const certificate = useIpc(ipcId);
  // The contract is the authority on the currency this money is denominated in, and it is
  // already cached from the application page the user arrived from.
  const contract = useContract(contractId);
  // Deliberately not blocking the page: a certificate is readable whether or not we can say
  // what has been paid against it. See `useCertificatePaymentStatus`.
  const payment = useCertificatePaymentStatus(ipcId);

  // The application and the BOQ exist only to put a description on each certified line. The
  // certificate carries a bare `applicationItemId` and nothing else identifying the work
  // (C15), so the label has to be walked back through the application to the BOQ node.
  const ipa = useIpa(ipaId);

  // Only meaningful for a non-effective cert — used to find what it would supersede.
  const allCerts = useIpcs(certificate.data?.applicationId ?? '');

  const [supersessionOpen, setSupersessionOpen] = useState(false);

  const projectId = contract.data?.projectId ?? '';
  const boqVersionId = contract.data?.boqVersionId ?? null;
  const boqTree = useBoqTree(projectId, boqVersionId);

  const ipaItemMap = useMemo(
    () => Object.fromEntries((ipa.data?.items ?? []).map((i) => [i.id, i])),
    [ipa.data],
  );

  const nodeMap = useMemo(() => (boqTree.data ? flattenTree(boqTree.data) : {}), [boqTree.data]);

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

  // Two distinct non-effective states, and they must not both render. A superseded cert is
  // closed history; one that was issued but never made effective is still actionable.
  const isSuperseded = !ipc.isEffective && ipc.supersededAt !== null;
  const isSupersessionCandidate =
    !ipc.isEffective && !ipc.supersededAt && ipc.status !== 'REJECTED';
  const effectiveCert = isSupersessionCandidate
    ? ((allCerts.data ?? []).find((c) => c.isEffective) ?? null)
    : null;

  return (
    <div className="space-y-6">
      {/* ── Back link — outside the header card ─────────────────────────── */}
      <div className="mb-5">
        <Link
          href={backHref}
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:rounded"
        >
          <ChevronStartIcon />
          {t('back')}
        </Link>
      </div>

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 pb-5 sm:px-6 sm:pt-6 sm:pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">{reference}</span>
            <IpcStatusBadge status={ipc.status} />
            <IpcEffectiveBadge isEffective={ipc.isEffective} />
          </div>
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[28px]">
            <bdi>{formatMoney(ipc.netCertified, currency, locale)}</bdi>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('netHeading')}</p>
        </div>
      </div>

      {/* A superseded certificate is history. Money must not be applied to it, and the
          allocation picker already excludes it — this says why, on the document itself. */}
      {isSuperseded ? (
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

      {/* Issued but never made effective — the one non-effective state that can still act. */}
      {isSupersessionCandidate ? (
        <Alert variant="warning" messages={[t('notEffectiveBanner')]}>
          <div className="mt-3">
            <Button size="sm" onClick={() => setSupersessionOpen(true)}>
              {t('makeEffectiveCta')}
            </Button>
          </div>
        </Alert>
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

      {/* ── Summary stats ───────────────────────────────────────────────── */}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('grossHeading')}</dt>
          <dd className="mt-1.5 text-sm font-semibold tabular-nums text-foreground">
            <bdi>{formatMoney(ipc.totalCertifiedAmount, currency, locale)}</bdi>
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('deductionsLabel')}</dt>
          <dd className="mt-1.5 text-sm font-semibold tabular-nums text-foreground">
            <bdi>{formatMoney(ipc.totalDeductions, currency, locale)}</bdi>
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('issued')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {formatDate(ipc.issuedAt, locale) ?? t('notIssued')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('application')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            <Link href={backHref} className="underline-offset-4 hover:underline">
              {t('openApplication')}
            </Link>
          </dd>
        </div>

        {ipc.notes ? (
          <div className="bg-surface px-5 py-4 sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">{t('notesLabel')}</dt>
            <dd className="mt-1.5 text-sm text-foreground">{ipc.notes}</dd>
          </div>
        ) : null}

        {ipc.exchangeRateValue ? (
          <div className="bg-surface px-5 py-4 sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">{t('exchangeRateLabel')}</dt>
            <dd className="mt-1.5 text-sm text-foreground">
              {ipc.exchangeRateCurrency} → {ipc.exchangeRateBase} @ {ipc.exchangeRateValue}
              {ipc.exchangeRateDate ? ` (${formatDate(ipc.exchangeRateDate, locale)})` : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <SettlementSection
        settlement={settlement}
        currency={currency}
        isPending={payment.isPending}
        isError={payment.isError}
      />

      {/* Sprint 4 AR. Renders nothing unless the certificate is effective, which is the only
          state `POST /invoices/from-ipc` accepts. */}
      <IpcBillingCard ipcId={ipc.id} isEffective={ipc.isEffective} currency={currency} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('itemsHeading')}</h2>

        {ipc.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
            <p className="text-sm font-medium text-foreground">{t('noItems')}</p>
          </div>
        ) : (
          <TableScroll aria-label={t('itemsHeading')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">{t('colItem')}</TableHead>
                  <TableHead numeric>{t('colCertifiedQty')}</TableHead>
                  <TableHead numeric>{t('colCertifiedAmount')}</TableHead>
                  <TableHead numeric>{t('colVarianceQty')}</TableHead>
                  <TableHead>{t('colVarianceReason')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ipc.items.map((item) => (
                  <IpcItemRow
                    key={item.id}
                    item={item}
                    ipaItemMap={ipaItemMap}
                    nodeMap={nodeMap}
                    locale={locale}
                    currency={currency}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
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
          <TableScroll aria-label={t('deductionsHeading')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colDeductionType')}</TableHead>
                  <TableHead>{t('colDeductionBasis')}</TableHead>
                  <TableHead numeric>{t('colDeductionAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ipc.deductions.map((deduction) => (
                  <TableRow key={deduction.id}>
                    <TableCell>
                      <span className="text-sm">
                        {t(`deductionType.${deduction.deductionType}` as 'deductionType.RETENTION')}
                      </span>
                    </TableCell>
                    {/* Basis × rate, not just the basis. A retention line reading "500,000"
                        beside an amount of "25,000" is unreadable without the 5% between
                        them, and the rate is the only thing that explains the deduction. */}
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        <bdi>{formatMoney(deduction.basis, currency, locale)}</bdi>
                        {deduction.rate ? (
                          <>
                            {' × '}
                            <bdi>{fractionToPercent(deduction.rate)}%</bdi>
                          </>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      <bdi className="tabular-nums">
                        {formatMoney(deduction.amount, currency, locale)}
                      </bdi>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      {isSupersessionCandidate ? (
        <IpcSupersessionDrawer
          open={supersessionOpen}
          applicationId={ipc.applicationId}
          newCert={ipc}
          effectiveCert={effectiveCert}
          onClose={() => setSupersessionOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Settlement ────────────────────────────────────────────────────────────────

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
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6">
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
                <bdi>{formatMoney(fromMinorUnits(settlement.allocatedMinor, MONEY_SCALE), currency, locale)}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('outstanding')}</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">
                <bdi>
                  {formatMoney(fromMinorUnits(settlement.outstandingMinor, MONEY_SCALE), currency, locale)}
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

// ─── Item row ──────────────────────────────────────────────────────────────────

interface IpcItemRowProps {
  item: IpcItem;
  ipaItemMap: Record<string, { boqNodeId: string }>;
  nodeMap: Record<string, BoqTreeNode>;
  locale: 'en' | 'ar';
  currency: string;
}

function IpcItemRow({ item, ipaItemMap, nodeMap, locale, currency }: IpcItemRowProps) {
  const ipaItem = ipaItemMap[item.applicationItemId];
  const node = ipaItem ? nodeMap[ipaItem.boqNodeId] : undefined;

  const description =
    locale === 'ar'
      ? (node?.descriptionAr ?? node?.description ?? node?.code)
      : (node?.description ?? node?.code);

  // The application or the BOQ may still be loading, or the walk may simply not resolve.
  // The last segment of the id at least tells two rows apart, which is what the branch
  // that had no BOQ lookup showed for every row.
  const label = description ?? item.applicationItemId.slice(-8);

  const varianceNegative = Number(item.varianceQuantity) < 0;

  return (
    <TableRow>
      <TableCell className="min-w-[160px] max-w-[240px]">
        <span className="line-clamp-2 text-sm">{label}</span>
      </TableCell>
      <TableCell numeric>
        <bdi className="tabular-nums">{formatNumber(item.certifiedQuantity, locale)}</bdi>
      </TableCell>
      <TableCell numeric>
        <bdi className="tabular-nums">{formatMoney(item.certifiedAmount, currency, locale)}</bdi>
      </TableCell>
      <TableCell numeric>
        <bdi
          className={
            varianceNegative ? 'tabular-nums text-danger' : 'tabular-nums text-muted-foreground'
          }
        >
          {formatNumber(item.varianceQuantity, locale)}
        </bdi>
      </TableCell>
      <TableCell>
        {item.varianceReason ? (
          <span className="text-sm text-muted-foreground">{item.varianceReason}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
