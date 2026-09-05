'use client';

import * as React from 'react';
import { FilePlus2, GitBranch, TriangleAlert } from 'lucide-react';
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
import type { CommercialSummaryResponse, VariationOrderListItem } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import { useVariations } from '../hooks/use-commercial';
import { summariseVariations, variationClientApproval, variationKind } from '../variations-summary';
import { variationStatusTone } from '../presentation';
import { PositionBand, type PositionFigure } from './contract-position';
import { errorText } from './commercial-workspace';
import { VariationCreateSheet } from './variation-create-sheet';
import { VariationDetailSheet } from './variation-detail-sheet';
import { ExtensionOfTimeSection } from './extension-of-time-section';
import { CertifiedInvoicedByVariationSection } from './certified-invoiced-by-variation-section';

/**
 * Variations (ADR-026 Phases 1–5).
 *
 * The governing rule the whole view is shaped around: **a variation changes the contract value
 * only when the client has approved it** (CONST-VAR-005). So the summary band reports pending
 * separately from approved and never adds them, the list keeps the internal workflow state and
 * the client's approval in different columns, and at-risk work — sanctioned early under
 * CONST-VAR-011 — is marked as the exposure it is rather than blending into approved scope.
 *
 * Time is the second rule: a proposed `+N days` is justification, not effect. The contractual
 * completion date moves only through an Extension of Time, which is its own audited command and
 * its own section below.
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
  const { can } = usePermissions();

  const contract = summary.mainContract;
  const variationsQuery = useVariations(contract?.id);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  if (!contract) {
    return <EmptyState variant="page" title={t('noContractTitle')} description={t('noContractHint')} />;
  }

  const canManage = can('manage:contract');
  const currency = summary.currency ?? contract.currency;
  const variations = variationsQuery.data?.variations ?? [];

  return (
    <div className="space-y-4">
      <VariationSummaryBand
        variations={variations}
        currency={currency}
        pendingValue={summary.contractValue?.pendingVariations ?? null}
        approvedValue={summary.contractValue?.approvedVariationsTotal ?? null}
        financialsVisible={summary.financialsVisible}
        loading={variationsQuery.isPending}
      />

      <p className="text-caption text-muted-foreground">{t('contractValue.rule')}</p>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">{t('listTitle')}</h3>
          {canManage ? (
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={() => setCreateOpen(true)}
            >
              <FilePlus2 size={15} aria-hidden="true" />
              {t('new')}
            </Button>
          ) : null}
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
            action={
              canManage ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <FilePlus2 size={15} aria-hidden="true" />
                  {t('new')}
                </Button>
              ) : undefined
            }
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
                    <TableHead>{t('col.internalStatus')}</TableHead>
                    <TableHead>{t('col.clientApproval')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variations.map((vo) => (
                    <VariationRow
                      key={vo.id}
                      vo={vo}
                      currency={currency}
                      locale={locale}
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

      <VariationCreateSheet
        projectId={projectId}
        contractId={contract.id}
        currency={currency}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setDetailId(id)}
      />

      <VariationDetailSheet
        variationId={detailId}
        contractId={contract.id}
        projectId={projectId}
        currency={currency}
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />
    </div>
  );
}

/**
 * Pending · Approved · Omissions · At-risk exposure.
 *
 * Four figures that must never be added together, so they are presented as four answers to four
 * questions rather than a total. Approved is the only one inside the contract value; pending is
 * management information (CONST-VAR-006a); omissions are a signed subset of approved, shown
 * because a reader asking "what has been taken out" should not have to filter the list; at-risk
 * exposure is money ACCO has put at risk and the client has not yet agreed to at all.
 */
function VariationSummaryBand({
  variations,
  currency,
  pendingValue,
  approvedValue,
  financialsVisible,
  loading,
}: {
  variations: VariationOrderListItem[];
  currency: string | null;
  pendingValue: string | null;
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
          label: t('pending'),
          value: money(pendingValue),
          blank,
          support: t('count', { n: totals.pendingCount }),
          small: true,
        },
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
        {
          label: t('atRisk'),
          value: money(totals.atRiskExposure),
          blank,
          support:
            totals.atRiskCount > 0 ? t('atRiskCount', { n: totals.atRiskCount }) : t('atRiskNone'),
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
  onOpen,
}: {
  vo: VariationOrderListItem;
  currency: string | null;
  locale: 'en' | 'ar';
  onOpen: () => void;
}) {
  const t = useTranslations('commercial.variations');
  const approval = variationClientApproval(vo);
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
      <TableCell className="font-medium text-foreground">
        <span className="flex flex-wrap items-center gap-1.5">
          {vo.title}
          {/* At-risk work is sanctioned but unapproved. Marking it in the list is the whole
              point of CONST-VAR-011 — it must never look like ordinary approved scope. */}
          {vo.atRiskAuthorisationCount > 0 ? (
            <Badge tone="warning">
              <TriangleAlert size={11} className="me-1" aria-hidden="true" />
              {t('atRiskBadge')}
            </Badge>
          ) : null}
        </span>
      </TableCell>
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
      <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
        {t(`clientApproval.${approval}`)}
      </TableCell>
    </TableRow>
  );
}
