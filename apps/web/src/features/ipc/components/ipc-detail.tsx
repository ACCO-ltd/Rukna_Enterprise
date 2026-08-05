'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';

import { StatusBadge } from '@/components/status-badge';
import { useContract } from '@/features/contracts/hooks/use-contracts';
import { useIpa } from '@/features/ipa/hooks/use-ipa';
import { useBoqTree } from '@/features/boq/hooks/use-boq';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import type { BoqTreeNode, IpcItem } from '@/lib/api-types';

import { useIpc } from '../hooks/use-ipc';

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
  const tIpc = useTranslations('platform.ipc');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const ipc = useIpc(ipcId);
  const ipa = useIpa(ipaId);
  const contract = useContract(contractId);

  const projectId = contract.data?.projectId ?? '';
  const boqVersionId = contract.data?.boqVersionId ?? null;
  const boqTree = useBoqTree(projectId, boqVersionId);

  // id → IpaItem (for boqNodeId lookup)
  const ipaItemMap = useMemo(
    () => Object.fromEntries((ipa.data?.items ?? []).map((i) => [i.id, i])),
    [ipa.data],
  );

  // boqNodeId → BoqTreeNode
  const nodeMap = useMemo(
    () => (boqTree.data ? flattenTree(boqTree.data) : {}),
    [boqTree.data],
  );

  if (ipc.isPending || contract.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (ipc.isError || contract.isError) {
    const notFound = ipc.error instanceof ApiError && ipc.error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Link
          href={`/contracts/${contractId}/applications/${ipaId}`}
          className="text-sm text-brand-primary underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>
      </div>
    );
  }

  const cert = ipc.data;
  const currency = cert.currency;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href={`/contracts/${contractId}/applications/${ipaId}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {cert.certificateRef ?? `#${cert.certificateNumber}`}
            </span>
            <StatusBadge status={cert.status} label={tIpc(`status.${cert.status}`)} />
            {cert.isEffective ? (
              <Badge tone="live">{tIpc('effective')}</Badge>
            ) : null}
            {cert.supersededAt ? (
              <Badge tone="neutral" className="opacity-60">
                {tIpc('superseded')}
              </Badge>
            ) : null}
          </div>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            <bdi>{formatMoney(cert.netCertified, currency, locale)}</bdi>
          </h1>
          <p className="text-sm text-muted-foreground">{t('netLabel')}</p>
        </div>
      </div>

      {/* Summary card */}
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('grossLabel')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(cert.certifiedTotal, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('deductionsLabel')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(cert.totalDeductions, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('currencyLabel')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">{currency}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('issuedLabel')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {cert.issuedAt ? formatDate(cert.issuedAt, locale) : '—'}
            </dd>
          </div>

          {cert.supersessionReason ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('supersessionReasonLabel')}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{cert.supersessionReason}</dd>
            </div>
          ) : null}

          {cert.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t('notesLabel')}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{cert.notes}</dd>
            </div>
          ) : null}

          {cert.exchangeRateValue ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t('exchangeRateLabel')}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {cert.exchangeRateCurrency} → {cert.exchangeRateBase} @ {cert.exchangeRateValue}
                {cert.exchangeRateDate
                  ? ` (${formatDate(cert.exchangeRateDate, locale)})`
                  : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Payment status note */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">{t('paymentHeading')}</h2>
        <Alert variant="info" messages={[t('paymentNote')]} />
      </section>

      {/* Items table */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">{t('itemsHeading')}</h2>

        {cert.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('itemsNone')}</p>
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
                {cert.items.map((item) => (
                  <IpcItemRow
                    key={item.id}
                    item={item}
                    ipaItemMap={ipaItemMap}
                    nodeMap={nodeMap}
                    locale={locale}
                    currency={currency}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      {/* Deductions table */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">{t('deductionsHeading')}</h2>

        {cert.deductions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('deductionsNone')}</p>
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
                {cert.deductions.map((deduction) => (
                  <TableRow key={deduction.id}>
                    <TableCell>
                      <span className="text-sm">{deduction.deductionType}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{deduction.basis}</span>
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
    </div>
  );
}

// ─── Item row ──────────────────────────────────────────────────────────────────

interface IpcItemRowProps {
  item: IpcItem;
  ipaItemMap: Record<string, { boqNodeId: string; currencySnapshot: string }>;
  nodeMap: Record<string, BoqTreeNode>;
  locale: 'en' | 'ar';
  currency: string;
  t: ReturnType<typeof useTranslations>;
}

function IpcItemRow({ item, ipaItemMap, nodeMap, locale, currency, t }: IpcItemRowProps) {
  const ipaItem = ipaItemMap[item.applicationItemId];
  const node = ipaItem ? nodeMap[ipaItem.boqNodeId] : undefined;

  const description =
    locale === 'ar'
      ? (node?.descriptionAr ?? node?.description ?? node?.code)
      : (node?.description ?? node?.code);

  // Fall back to a shortened applicationItemId when BOQ tree hasn't loaded yet
  const label = description ?? item.applicationItemId.slice(-8);

  const varianceNegative = parseFloat(item.varianceQuantity) < 0;

  return (
    <>
      <TableRow>
        <TableCell className="min-w-[160px] max-w-[240px]">
          <span className="line-clamp-2 text-sm">{label}</span>
        </TableCell>
        <TableCell numeric>
          <bdi className="tabular-nums">{item.certifiedQuantity}</bdi>
        </TableCell>
        <TableCell numeric>
          <bdi className="tabular-nums">
            {formatMoney(item.certifiedAmount, currency, locale)}
          </bdi>
        </TableCell>
        <TableCell numeric>
          <bdi
            className={varianceNegative ? 'tabular-nums text-danger' : 'tabular-nums text-muted-foreground'}
          >
            {item.varianceQuantity}
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
    </>
  );
}
