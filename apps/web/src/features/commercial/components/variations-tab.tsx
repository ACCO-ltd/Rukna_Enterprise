'use client';

import * as React from 'react';
import { GitBranch } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';
import type { CommercialSummaryResponse, VariationOrderListItem } from '@erp/types';

import { formatMoney } from '@/lib/format';

import { useBillingPackages, useVariations } from '../hooks/use-commercial';
import { summariseVariations, variationKind } from '../variations-summary';
import { variationStatusTone } from '../presentation';
import { PositionBand, type PositionFigure } from './contract-position';
import { errorText } from './commercial-workspace';
import { VariationDetailSheet } from './variation-detail-sheet';
import { ExtensionOfTimeSection } from './extension-of-time-section';
import { CertifiedInvoicedByVariationSection } from './certified-invoiced-by-variation-section';
import {
  VariationBillingChip,
  type VariationBilling,
  type VariationBillingLookup,
} from './variation-billing-chip';

/**
 * Variations (ADR-026 · variation-collapse).
 *
 * variation-collapse: variations are now created ONLY via the BOQ "Add Extra Work" drawer, which
 * raises AND adopts the VO in one step — so this tab is a **read-only ledger**. There is no "New
 * variation" entry point here anymore. The summary band still reports pending separately from
 * approved (pending stays as a figure for any historical/in-flight rows), and the list keeps the
 * internal workflow state and the client's approval in different columns. A raised variation is
 * immediately client-approved and adopted; the only mutation the reader can make is to **reverse**
 * an unbilled one, from the detail sheet.
 *
 * Time is a separate rule: a proposed `+N days` is justification, not effect. The contractual
 * completion date moves only through an Extension of Time, its own audited command and section below.
 */
export function VariationsTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.variations');
  const locale = useLocale() as 'en' | 'ar';

  const contract = summary.mainContract;
  const variationsQuery = useVariations(contract?.id);
  const packagesQuery = useBillingPackages(projectId, contract?.id);

  const [detailId, setDetailId] = React.useState<string | null>(null);

  // The per-VO billing lookup (S-VB-12): a VO appears in at most one package line (its single
  // allocation), so flattening every package's lines yields one entry per variation.
  const billingLookup = React.useMemo<VariationBillingLookup>(() => {
    const map = new Map<string, VariationBilling>();
    for (const line of (packagesQuery.data?.packages ?? []).flatMap((p) => p.variationLines)) {
      map.set(line.variationId, { treatment: line.treatment, invoice: line.invoice });
    }
    return map;
  }, [packagesQuery.data]);

  if (!contract) {
    return <EmptyState variant="page" title={t('noContractTitle')} description={t('noContractHint')} />;
  }

  const canReverse = summary.capabilities?.canReverseVariation ?? false;
  const currency = summary.currency ?? contract.currency;
  const variations = variationsQuery.data?.variations ?? [];

  return (
    <div className="space-y-4">
      <VariationSummaryBand
        variations={variations}
        currency={currency}
        approvedValue={summary.contractValue?.approvedVariationsTotal ?? null}
        financialsVisible={summary.financialsVisible}
        loading={variationsQuery.isPending}
      />

      <p className="text-caption text-muted-foreground">{t('contractValue.rule')}</p>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">{t('listTitle')}</h3>
        </div>

        {variationsQuery.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : variationsQuery.isError ? (
          <Alert
            variant="error"
            title={t('loadFailed')}
            messages={[errorText(variationsQuery.error, t('loadFailedHint'))]}
          >
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => variationsQuery.refetch()}
            >
              {t('retry')}
            </Button>
          </Alert>
        ) : variations.length === 0 ? (
          <EmptyState
            icon={<GitBranch size={22} aria-hidden="true" />}
            variant="page"
            title={t('emptyTitle')}
            description={t('emptyHint')}
          />
        ) : (
          <div className="overflow-hidden rounded-panel border border-border bg-surface">
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col.ref')}</TableHead>
                    <TableHead>{t('col.title')}</TableHead>
                    <TableHead>{t('col.type')}</TableHead>
                    <TableHead className="text-end">{t('col.netPrice')}</TableHead>
                    <TableHead className="text-end">{t('col.timeImpact')}</TableHead>
                    <TableHead>{t('col.status')}</TableHead>
                    <TableHead>{t('col.billing')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variations.map((vo) => (
                    <VariationRow
                      key={vo.id}
                      vo={vo}
                      currency={currency}
                      locale={locale}
                      billing={billingLookup.get(vo.id) ?? null}
                      onOpen={() => setDetailId(vo.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </div>
        )}
      </section>

      <CertifiedInvoicedByVariationSection contractId={contract.id} />

      <ExtensionOfTimeSection
        contractId={contract.id}
        projectId={projectId}
        variations={variations}
      />

      <VariationDetailSheet
        variationId={detailId}
        contractId={contract.id}
        projectId={projectId}
        currency={currency}
        billing={detailId ? (billingLookup.get(detailId) ?? null) : null}
        canReverse={canReverse}
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />
    </div>
  );
}

/**
 * Approved · Omissions.
 *
 * Two figures that must never be added together, so they are stated as two answers rather than a
 * total. Approved is the variations value inside the contract; omissions are a signed subset of
 * it, shown because a reader asking "what has been taken out" should not have to filter the list.
 * (Under variation-collapse a raised variation is client-approved immediately, so there is no
 * "pending" bucket and no at-risk exposure to report.)
 */
function VariationSummaryBand({
  variations,
  currency,
  approvedValue,
  financialsVisible,
  loading,
}: {
  variations: VariationOrderListItem[];
  currency: string | null;
  approvedValue: string | null;
  financialsVisible: boolean;
  loading: boolean;
}) {
  const t = useTranslations('commercial.variations.summary');
  const locale = useLocale() as 'en' | 'ar';

  if (loading) return <Skeleton className="h-28 w-full" />;

  const totals = summariseVariations(variations);
  const money = (value: string | null): PositionFigure['value'] =>
    !financialsVisible || value === null ? null : (formatMoney(value, currency, locale) ?? null);
  const blank: PositionFigure['blank'] = financialsVisible ? 'unavailable' : 'restricted';

  return (
    <PositionBand
      title={t('title')}
      currency={currency}
      figures={[
        {
          label: t('approved'),
          value: money(approvedValue),
          blank,
          support: t('count', { n: totals.approvedCount }),
          small: true,
        },
        {
          label: t('omissions'),
          value: money(totals.omissionsTotal),
          blank,
          support: t('count', { n: totals.omissionCount }),
          small: true,
        },
      ]}
    />
  );
}

function VariationRow({
  vo,
  currency,
  locale,
  billing,
  onOpen,
}: {
  vo: VariationOrderListItem;
  currency: string | null;
  locale: 'en' | 'ar';
  billing: VariationBilling | null;
  onOpen: () => void;
}) {
  const t = useTranslations('commercial.variations');
  const kind = variationKind(vo);

  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell className="whitespace-nowrap font-mono text-caption text-muted-foreground">
        {vo.reference}
      </TableCell>
      <TableCell className="font-medium text-foreground">{vo.title}</TableCell>
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        {t(`kind.${kind}`)}
      </TableCell>
      {/* Signed and neutral, never heat-mapped: an omission reads negative on its own, and
          colouring it red would imply "bad", which a legitimate omission is not. */}
      <TableCell className="text-end tabular-nums">
        {formatMoney(vo.netPrice, currency, locale) ?? '—'}
      </TableCell>
      {/* Proposed only. It never moves the contractual completion date (CONST-VAR-003). */}
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {vo.proposedTimeImpactDays === null ? '—' : t('daysShort', { n: vo.proposedTimeImpactDays })}
      </TableCell>
      <TableCell>
        <Badge tone={variationStatusTone(vo.status)}>{t(`status.${vo.status}`)}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <VariationBillingChip status={vo.status} billing={billing} />
      </TableCell>
    </TableRow>
  );
}
