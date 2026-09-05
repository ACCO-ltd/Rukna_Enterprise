'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, ExternalLink, FilePlus2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  LtrValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import type {
  ProcurementAttentionItem,
  ProjectProcurementOverviewResponse,
} from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

import { useProjectProcurementOverview } from '../../hooks/use-project-procurement';
import { CostPositionBand } from './cost-position-band';
import { SectionPanel } from './section-panel';

/**
 * The project's procurement control page.
 *
 * Composition over figures Cost & Commitments already proves: the same read model, the same
 * ledger rows. Nothing here recomputes a number, and nothing presents a supplier document as
 * project-owned — purchase orders, receipts and bills appear as the source of a cost, with a link
 * out to the workspace that operates them.
 */
export function ProcurementOverviewView({
  projectId,
  onGoTo,
}: {
  projectId: string;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const query = useProjectProcurementOverview(projectId);

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[t('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const data = query.data;

  return (
    <div className="space-y-4">
      <CostPositionBand
        position={data.position}
        canManageBudget={data.capabilities.canManageBudget}
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <PipelinePanel data={data} />
        <AttentionPanel data={data} onGoTo={onGoTo} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <SupplierExposurePanel data={data} onGoTo={onGoTo} />
        <ActivityPanel data={data} />
      </div>
    </div>
  );
}

// ─── Pipeline ───────────────────────────────────────────────────────────────────

/**
 * Requirement → payment.
 *
 * The first four stages carry a cost figure because they are cost stages. **Payment does not.**
 * Settling a bill moves cash, not cost, and it is not in the commitment ledger at all — so that
 * stage shows a count and says what the count is, rather than borrowing `ACTUAL` and reporting
 * money as paid that nobody has paid.
 */
function PipelinePanel({ data }: { data: ProjectProcurementOverviewResponse }) {
  const t = useTranslations('procurement.project.overview');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <SectionPanel title={t('pipeline')} description={t('pipelineHint')}>
      <ol className="space-y-2.5">
        {data.pipeline.map((stage, index) => (
          <li key={stage.stage} className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-micro font-semibold',
                'border-border-strong bg-surface text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-body-sm font-medium text-foreground">
                  {t(`stage.${stage.stage}`)}
                </span>
                <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
                  {stage.count}
                </LtrValue>
              </span>
              <span className="mt-0.5 block text-caption text-muted-foreground">
                {/* Every stage says what its number means. "8" alone is not a fact. */}
                {t(`stageUnit.${stage.stage}`, { n: stage.count })}
                {stage.amount !== null
                  ? ` · ${formatMoney(stage.amount, data.position.currency, locale) ?? ''} ${t(
                      `stageBasis.${stage.stage}`,
                    )}`
                  : ''}
                {stage.qualifierCount !== null && stage.qualifierCount > 0
                  ? ` · ${t('approvedNotOrdered', { n: stage.qualifierCount })}`
                  : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </SectionPanel>
  );
}

// ─── Attention ──────────────────────────────────────────────────────────────────

const TIER_ACCENT: Record<ProcurementAttentionItem['tier'], string> = {
  SITE_BLOCKING: 'text-danger',
  COST_RECOGNITION: 'text-warning',
  FINANCIAL_CONTROL: 'text-warning',
  ROUTINE: 'text-muted-foreground',
};

/**
 * What needs doing, in the order it actually matters.
 *
 * The ordering is the server's — site continuity, then cost recognition, then financial control,
 * then hygiene — so every surface agrees and the browser invents no severity of its own. Tier
 * headings appear only when there is enough to group; with three items they would be noise.
 */
function AttentionPanel({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <SectionPanel title={t('attention')} bodyClassName={data.attention.length ? 'px-0 py-0' : undefined}>
      {data.attention.length === 0 ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('attentionNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.attention.map((item) => (
            <li
              key={item.kind}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <AlertTriangle
                  size={16}
                  className={cn('mt-0.5 shrink-0', TIER_ACCENT[item.tier])}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-body-sm font-medium text-foreground">
                    {t(`attentionKind.${item.kind}.title`)}
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {t(`attentionKind.${item.kind}.impact`)}
                    {item.amount
                      ? ` · ${formatMoney(item.amount, data.position.currency, locale) ?? ''}`
                      : ''}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                <Badge tone={item.tier === 'SITE_BLOCKING' ? 'danger' : 'warning'}>
                  {item.count}
                </Badge>
                {/* `actionUrl` is null server-side when the caller cannot act, so a dead control
                    is never rendered. In-workspace destinations switch view rather than navigate. */}
                {item.actionUrl?.endsWith('/requirements') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    onClick={() => onGoTo('requirements')}
                  >
                    {t('view')}
                  </Button>
                ) : item.actionUrl ? (
                  <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
                    <Link href={item.actionUrl}>
                      {t('view')}
                      <ExternalLink size={13} aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

// ─── Supplier exposure ──────────────────────────────────────────────────────────

function SupplierExposurePanel({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const locale = useLocale() as 'en' | 'ar';
  const top = data.committedBySupplier.slice(0, 5);

  return (
    <SectionPanel
      title={t('supplierExposure')}
      description={t('supplierExposureHint')}
      action={
        data.committedBySupplier.length > 0 ? (
          <button
            type="button"
            onClick={() => onGoTo('cost')}
            className="inline-flex min-h-11 items-center gap-1 text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
          >
            {t('viewAllSuppliers')}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        ) : null
      }
      bodyClassName={top.length ? 'px-0 py-0' : undefined}
    >
      {top.length === 0 ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('noSuppliers')}</p>
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.supplier')}</TableHead>
                <TableHead className="text-end">{t('col.committed')}</TableHead>
                <TableHead className="text-end">{t('col.actual')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((row) => (
                <TableRow key={row.supplierId ?? 'unattributed'}>
                  <TableCell className="font-medium text-foreground">{row.supplierName}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(row.committed, data.position.currency, locale) ?? '—'}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {formatMoney(row.actual, data.position.currency, locale) ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </SectionPanel>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────────

function ActivityPanel({ data }: { data: ProjectProcurementOverviewResponse }) {
  const t = useTranslations('procurement.project.overview');
  const tCost = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <SectionPanel
      title={t('activity')}
      bodyClassName={data.recentActivity.length ? 'px-0 py-0' : undefined}
    >
      {data.recentActivity.length === 0 ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('noActivity')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.recentActivity.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline justify-between gap-3 px-4 py-2.5 sm:px-5"
            >
              <span className="min-w-0">
                <span className="block truncate text-body-sm text-foreground">
                  {tCost(`documentType.${entry.documentType}`)}
                  {entry.reference ? (
                    <LtrValue className="ms-1.5 font-mono text-caption text-muted-foreground">
                      {entry.reference}
                    </LtrValue>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-caption text-muted-foreground">
                  {formatDate(entry.occurredAt, locale) ?? '—'} · {tCost(`stage.${entry.stage}`)}
                </span>
              </span>
              <LtrValue className="shrink-0 text-body-sm font-medium tabular-nums text-foreground">
                {entry.amount === null
                  ? '—'
                  : (formatMoney(entry.amount, entry.currency, locale) ?? '—')}
              </LtrValue>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

/** The one action the project genuinely owns. Buying is the buyer's job, in their workspace. */
export function RaiseRequirementButton({ canRaise }: { canRaise: boolean }) {
  const t = useTranslations('procurement.project.overview');
  if (!canRaise) return null;
  return (
    <Button asChild size="sm" className="min-h-11 sm:min-h-0">
      <Link href="/procurement/requests/new">
        <FilePlus2 size={15} aria-hidden="true" />
        {t('raiseRequirement')}
      </Link>
    </Button>
  );
}
