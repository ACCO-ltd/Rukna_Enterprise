'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FilePlus2,
  FileText,
  PackageCheck,
  Receipt,
  ShoppingCart,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
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
  ProjectProcurementPipelineStage,
} from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

import { useProjectProcurementOverview } from '../../hooks/use-project-procurement';
import { CostPositionBand } from './cost-position-band';
import { CostByAreaChart, ShareRing, topSlices } from './cost-charts';
import { SectionPanel } from './section-panel';

/**
 * The project's procurement control page.
 *
 * Composition over figures Cost & Commitments already proves: the same read model, the same
 * ledger rows. Nothing here recomputes a number, and nothing presents a supplier document as
 * project-owned — purchase orders, receipts and bills appear as the source of a cost, with a
 * link out to the workspace that operates them.
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
      {/* Full width: five figures across is the whole point of the band, and squeezing it into
          half a row wrapped every label onto three lines. */}
      <CostPositionBand
        position={data.position}
        canManageBudget={data.capabilities.canManageBudget}
      />

      <CountTiles data={data} onGoTo={onGoTo} />

      {/* The pipeline is a left-to-right sequence of five stages; at half width the last two
          scrolled out of sight, which defeats the one thing it exists to show. */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <PipelinePanel data={data} />
        <AttentionPanel data={data} onGoTo={onGoTo} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <CostByAreaPanel data={data} onGoTo={onGoTo} />
        <SupplierSharePanel data={data} onGoTo={onGoTo} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ActivityPanel data={data} />
        <ActionsPanel data={data} onGoTo={onGoTo} />
      </div>
    </div>
  );
}

// ─── Counts ─────────────────────────────────────────────────────────────────────

/** Three workload counts. Not money — that is the band beside them. */
function CountTiles({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const locale = useLocale() as 'en' | 'ar';

  const tiles = [
    {
      key: 'openRequirements',
      value: data.openRequirementCount,
      support: t('awaitingProcurement', { n: data.requirementsAwaitingProcurement }),
      icon: <ClipboardList size={16} strokeWidth={1.9} />,
      tone: 'neutral' as const,
      onClick: () => onGoTo('requirements'),
    },
    {
      // `PurchaseOrder.status = OPEN` — named for the state it filters on, never "active",
      // which would blur the header state into the revision lifecycle.
      key: 'openPos',
      value: data.openPoCount,
      support:
        data.openPoValue === null
          ? t('poValueRestricted')
          : t('poValue', {
              amount: formatMoney(data.openPoValue, data.position.currency, locale) ?? '—',
            }),
      icon: <ShoppingCart size={16} strokeWidth={1.9} />,
      tone: 'neutral' as const,
      onClick: () => onGoTo('cost'),
    },
    {
      key: 'openExceptions',
      value: data.openExceptionCount,
      support: t('exceptionsSupport'),
      icon: <TriangleAlert size={16} strokeWidth={1.9} />,
      tone: data.openExceptionCount > 0 ? ('danger' as const) : ('neutral' as const),
      onClick: undefined,
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-control',
                  tile.tone === 'danger'
                    ? 'bg-danger-subtle text-danger'
                    : 'bg-brand-primary-subtle text-brand-primary',
                )}
                aria-hidden="true"
              >
                {tile.icon}
              </span>
              <span className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t(`tile.${tile.key}`)}
              </span>
            </span>
            <span className="mt-2 block text-h1 font-bold tabular-nums text-foreground">
              {tile.value}
            </span>
            <span className="mt-1 block text-caption text-muted-foreground">{tile.support}</span>
          </>
        );

        const shell = 'min-w-0 rounded-panel border border-border bg-surface p-4 text-start';
        return tile.onClick ? (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            className={cn(
              shell,
              'transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
            )}
          >
            {body}
          </button>
        ) : (
          <div key={tile.key} className={shell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

// ─── Pipeline ───────────────────────────────────────────────────────────────────

const STAGE_ICON: Record<ProjectProcurementPipelineStage['stage'], React.ReactNode> = {
  REQUIREMENTS: <FileText size={15} strokeWidth={1.9} />,
  PURCHASE_ORDERS: <ShoppingCart size={15} strokeWidth={1.9} />,
  GOODS_RECEIVED: <PackageCheck size={15} strokeWidth={1.9} />,
  SUPPLIER_BILLS: <Receipt size={15} strokeWidth={1.9} />,
  PAYMENTS: <Wallet size={15} strokeWidth={1.9} />,
};

/**
 * Requirement → payment, read left to right.
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
      {/* Scrolls inside itself at 375px rather than wrapping into a shape that stops reading
          as a sequence. */}
      <ol className="flex items-start gap-1 overflow-x-auto pb-1">
        {data.pipeline.map((stage, index) => (
          <li key={stage.stage} className="flex min-w-0 shrink-0 items-start gap-1">
            <div className="min-w-24 text-center">
              <span
                className="mx-auto flex size-9 items-center justify-center rounded-full border border-border bg-surface-subtle text-brand-primary"
                aria-hidden="true"
              >
                {STAGE_ICON[stage.stage]}
              </span>
              <p className="mt-1.5 text-caption font-medium text-foreground">
                {t(`stage.${stage.stage}`)}
              </p>
              <p className="text-h3 font-bold tabular-nums text-foreground">{stage.count}</p>
              <p className="text-caption leading-tight text-muted-foreground">
                {t(`stageUnit.${stage.stage}`, { n: stage.count })}
              </p>
              {stage.amount !== null ? (
                <p className="text-caption leading-tight text-muted-foreground">
                  {formatMoney(stage.amount, data.position.currency, locale) ?? ''}{' '}
                  {t(`stageBasis.${stage.stage}`)}
                </p>
              ) : null}
              {stage.qualifierCount !== null && stage.qualifierCount > 0 ? (
                <p className="mt-0.5 text-caption font-medium leading-tight text-warning">
                  {t('approvedNotOrdered', { n: stage.qualifierCount })}
                </p>
              ) : null}
            </div>
            {index < data.pipeline.length - 1 ? (
              <ChevronRight
                size={14}
                className="mt-3 shrink-0 text-border-strong rtl:rotate-180"
                aria-hidden="true"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </SectionPanel>
  );
}

// ─── Attention ──────────────────────────────────────────────────────────────────

const TIER_ACCENT: Record<ProcurementAttentionItem['tier'], string> = {
  SITE_BLOCKING: 'bg-danger-subtle text-danger',
  COST_RECOGNITION: 'bg-warning-subtle text-warning',
  FINANCIAL_CONTROL: 'bg-warning-subtle text-warning',
  ROUTINE: 'bg-muted text-muted-foreground',
};

/**
 * What needs doing, in the order it actually matters.
 *
 * The ordering is the server's — site continuity, then cost recognition, then financial control,
 * then hygiene — so every surface agrees and the browser invents no severity of its own.
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
    <SectionPanel
      title={t('attention')}
      bodyClassName={data.attention.length ? 'px-0 py-0' : undefined}
    >
      {data.attention.length === 0 ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('attentionNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.attention.map((item) => {
            const inWorkspace = item.actionUrl?.endsWith('/requirements');
            const Row = (
              <>
                <span
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control',
                    TIER_ACCENT[item.tier],
                  )}
                  aria-hidden="true"
                >
                  <AlertTriangle size={15} />
                </span>
                <span className="min-w-0 flex-1">
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
                <Badge tone={item.tier === 'SITE_BLOCKING' ? 'danger' : 'warning'}>
                  {item.count}
                </Badge>
                {item.actionUrl ? (
                  <ChevronRight
                    size={15}
                    className="shrink-0 text-muted-foreground rtl:rotate-180"
                    aria-hidden="true"
                  />
                ) : null}
              </>
            );

            const rowClass =
              'flex w-full min-h-11 items-center gap-3 px-4 py-3 text-start sm:px-5';

            // `actionUrl` is null server-side when the caller cannot act, so a dead control is
            // never rendered. In-workspace destinations switch view rather than navigate away.
            if (!item.actionUrl) {
              return (
                <li key={item.kind} className={rowClass}>
                  {Row}
                </li>
              );
            }
            return (
              <li key={item.kind}>
                {inWorkspace ? (
                  <button
                    type="button"
                    onClick={() => onGoTo('requirements')}
                    className={cn(rowClass, 'hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary')}
                  >
                    {Row}
                  </button>
                ) : (
                  <Link
                    href={item.actionUrl}
                    className={cn(rowClass, 'hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary')}
                  >
                    {Row}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionPanel>
  );
}

// ─── Charts ─────────────────────────────────────────────────────────────────────

function CostByAreaPanel({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const groups = data.costByBoq
    .map((row) => ({
      label: row.kind === 'PROJECT_LEVEL' ? t('projectLevelShort') : row.description,
      committed: Number(row.committed ?? 0),
      accrued: Number(row.accrued ?? 0),
      actual: Number(row.actual ?? 0),
    }))
    .filter((g) => g.committed > 0 || g.accrued > 0 || g.actual > 0);

  return (
    <SectionPanel
      title={t('costByArea')}
      description={t('costByAreaHint')}
      action={<ViewDetails label={t('viewDetails')} onClick={() => onGoTo('cost')} />}
    >
      {groups.length === 0 ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('noCostYet')}</p>
      ) : (
        <CostByAreaChart groups={groups} />
      )}
    </SectionPanel>
  );
}

function SupplierSharePanel({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');
  const tCost = useTranslations('procurement.project.cost');

  const slices = topSlices(
    data.committedBySupplier.map((row) => ({
      label: row.supplierName,
      value: Number(row.committed ?? 0),
      amount: row.committed,
    })),
    5,
    tCost('others'),
  );
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <SectionPanel
      title={t('supplierExposure')}
      description={t('supplierExposureHint')}
      action={<ViewDetails label={t('viewDetails')} onClick={() => onGoTo('cost')} />}
    >
      <ShareRing
        slices={slices}
        total={total}
        centreLabel={tCost('col.committed')}
        currency={data.position.currency}
      />
    </SectionPanel>
  );
}

function ViewDetails({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
    >
      {label}
      <ArrowRight size={13} className="rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}

// ─── Activity & actions ─────────────────────────────────────────────────────────

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
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tCost('col.date')}</TableHead>
                <TableHead>{tCost('col.document')}</TableHead>
                <TableHead>{tCost('col.reference')}</TableHead>
                <TableHead>{tCost('col.stage')}</TableHead>
                <TableHead className="text-end">{tCost('col.amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentActivity.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(entry.occurredAt, locale) ?? '—'}
                  </TableCell>
                  <TableCell className="text-caption text-muted-foreground">
                    {tCost(`documentType.${entry.documentType}`)}
                  </TableCell>
                  <TableCell className="font-mono text-caption text-foreground">
                    {entry.reference ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge tone={entry.stage === 'ACTUAL' ? 'live' : 'info'}>
                      {tCost(`stage.${entry.stage}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    <LtrValue>
                      {entry.amount === null
                        ? '—'
                        : (formatMoney(entry.amount, entry.currency, locale) ?? '—')}
                    </LtrValue>
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

/**
 * What a reader can do from here.
 *
 * Exactly one primary — raise a requirement — because that is the only act the project genuinely
 * owns. The rest navigate: buying, receiving and billing belong to the buyer's workspace, and
 * the link says so rather than implying this screen could do them.
 */
function ActionsPanel({
  data,
  onGoTo,
}: {
  data: ProjectProcurementOverviewResponse;
  onGoTo: (view: 'requirements' | 'cost') => void;
}) {
  const t = useTranslations('procurement.project.overview');

  return (
    <SectionPanel title={t('actions')} bodyClassName="px-0 py-0">
      <ul className="divide-y divide-border">
        {data.capabilities.canRaiseRequirement ? (
          <li>
            <Link
              href="/procurement/requests/new"
              className="flex min-h-11 items-center gap-3 bg-brand-primary px-4 py-3 text-brand-on-primary hover:bg-brand-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:px-5"
            >
              <FilePlus2 size={16} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold">{t('raiseRequirement')}</span>
                <span className="block text-caption opacity-90">{t('raiseRequirementHint')}</span>
              </span>
              <ChevronRight size={15} className="rtl:rotate-180" aria-hidden="true" />
            </Link>
          </li>
        ) : null}

        <ActionRow
          icon={<ClipboardList size={16} aria-hidden="true" />}
          title={t('viewRequirements')}
          hint={t('viewRequirementsHint')}
          onClick={() => onGoTo('requirements')}
        />
        <ActionRow
          icon={<Wallet size={16} aria-hidden="true" />}
          title={t('viewCost')}
          hint={t('viewCostHint')}
          onClick={() => onGoTo('cost')}
        />
        {/* The buyer's workspace. Named as somewhere else, not as another view of this one. */}
        <li>
          <Link
            href="/procurement/orders"
            className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:px-5"
          >
            <span className="text-muted-foreground" aria-hidden="true">
              <ShoppingCart size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm font-medium text-foreground">
                {t('openProcurement')}
              </span>
              <span className="block text-caption text-muted-foreground">
                {t('openProcurementHint')}
              </span>
            </span>
            <ExternalLink size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </SectionPanel>
  );
}

function ActionRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:px-5"
      >
        <span className="text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-medium text-foreground">{title}</span>
          <span className="block text-caption text-muted-foreground">{hint}</span>
        </span>
        <ChevronRight
          size={15}
          className="shrink-0 text-muted-foreground rtl:rotate-180"
          aria-hidden="true"
        />
      </button>
    </li>
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
