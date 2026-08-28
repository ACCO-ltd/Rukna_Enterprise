'use client';

import * as React from 'react';
import { FilePlus2, GitBranch } from 'lucide-react';
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
import type {
  CommercialContractValue,
  CommercialSummaryResponse,
  VariationOrderListItem,
} from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import { useVariations } from '../hooks/use-commercial';
import { variationStatusTone } from '../presentation';
import { errorText } from './commercial-workspace';
import { VariationCreateSheet } from './variation-create-sheet';
import { VariationDetailSheet } from './variation-detail-sheet';
import { ExtensionOfTimeSection } from './extension-of-time-section';

/**
 * The Variations view (ADR-026 Phases 1 + 4). Variations are contract-scoped, so this tab reads
 * the project's MAIN contract from the commercial summary and works against it. With no main
 * contract there is nothing to raise a variation against, so it shows the same empty state the
 * other commercial tabs use.
 *
 * Only backend figures render: the contract-value header uses the summary's derived
 * `contractValue` (Original / Approved / Governing / Pending), and the VO list shows each VO's
 * server-derived net price and status. Nothing here re-implements a rule (ADR-017).
 *
 * P3 (per-VO certified/invoiced trace column) and P5 (at-risk authorisation) are deliberately
 * absent — their backends do not exist yet.
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
    return (
      <EmptyState
        variant="page"
        title={t('noContractTitle')}
        description={t('noContractHint')}
      />
    );
  }

  const canManage = can('manage:contract');
  const currency = summary.currency ?? contract.currency;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h3 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ContractValueHeader
        value={summary.contractValue}
        currency={currency}
        financialsVisible={summary.financialsVisible}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">{t('listTitle')}</h3>
          {canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
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
        ) : variationsQuery.data.variations.length === 0 ? (
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
          <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col.ref')}</TableHead>
                    <TableHead>{t('col.title')}</TableHead>
                    <TableHead className="text-end">{t('col.netPrice')}</TableHead>
                    <TableHead>{t('col.status')}</TableHead>
                    <TableHead className="text-end">{t('col.timeImpact')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variationsQuery.data.variations.map((vo) => (
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

      <ExtensionOfTimeSection
        contractId={contract.id}
        projectId={projectId}
        variations={variationsQuery.data?.variations ?? []}
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
 * Original → Approved → Governing, with Pending as a badge/note beside the governing figure.
 * The copy states the rule the figures obey: the contract value only moves when a variation is
 * client-approved (CONST-VAR-005). Pending is management information (CONST-VAR-006a), never
 * folded into governing.
 */
function ContractValueHeader({
  value,
  currency,
  financialsVisible,
}: {
  value: CommercialContractValue | null;
  currency: string | null;
  financialsVisible: boolean;
}) {
  const t = useTranslations('commercial.variations.contractValue');
  const locale = useLocale() as 'en' | 'ar';

  const money = (raw: string | null) => {
    if (raw === null) return financialsVisible ? t('notSet') : t('restricted');
    return formatMoney(raw, currency, locale) ?? t('notSet');
  };

  const pending = value?.pendingVariations ?? null;

  return (
    <section className="rounded-panel border border-border bg-surface shadow-e1">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ValueCell label={t('original')} value={money(value?.originalContractValue ?? null)} />
        <ValueCell label={t('approved')} value={money(value?.approvedVariationsTotal ?? null)} />
        <ValueCell
          label={t('governing')}
          value={money(value?.governingContractValue ?? null)}
          emphasis
          badge={
            pending !== null && pending !== '0.00' && pending !== '0' ? (
              <Badge tone="warning">{t('pendingBadge', { amount: money(pending) })}</Badge>
            ) : null
          }
        />
      </div>
      <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
        {t('rule')}
      </p>
    </section>
  );
}

function ValueCell({
  label,
  value,
  emphasis,
  badge,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <span className="text-micro font-semibold uppercase text-muted-foreground">{label}</span>
      <p
        className={`mt-1 tabular-nums ${
          emphasis ? 'text-h2 font-bold text-foreground' : 'text-h3 font-semibold text-foreground'
        }`}
      >
        {value}
      </p>
      {badge ? <div className="mt-1.5">{badge}</div> : null}
    </div>
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
      <TableCell className="font-mono text-caption text-muted-foreground">{vo.reference}</TableCell>
      <TableCell className="font-medium text-foreground">{vo.title}</TableCell>
      {/* Net price is neutral tabular — signed, not heat-mapped. An omission reads negative on
          its own; colouring it red would imply "bad", which a legitimate omission is not. */}
      <TableCell className="text-end tabular-nums">
        {formatMoney(vo.netPrice, currency, locale) ?? '—'}
      </TableCell>
      <TableCell>
        <Badge tone={variationStatusTone(vo.status)}>{t(`status.${vo.status}`)}</Badge>
      </TableCell>
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {vo.proposedTimeImpactDays === null
          ? '—'
          : t('daysShort', { n: vo.proposedTimeImpactDays })}
      </TableCell>
    </TableRow>
  );
}
