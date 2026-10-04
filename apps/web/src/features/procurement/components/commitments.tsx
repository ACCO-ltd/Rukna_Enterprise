'use client';

/**
 * Commitment ledger (§12.9) — the project cost position and the full ledger screen.
 *
 * Both surfaces used to carry a standing accuracy warning: cancelling a purchase order wrote
 * no reversal (P12), and superseding a revision reversed the full original value rather than
 * the uncommitted balance (P11), so COMMITTED overstated in ordinary use and could go
 * negative. A note was the only honest thing a consumer of wrong numbers could do.
 *
 * **Both are fixed on the server** — `PurchaseOrderService` writes a `PO_CANCELLED` reversal
 * for each active line on cancel, and supersede reverses only the net COMMITTED balance summed
 * per line (`frontend-blockers.md` P11/P12, both marked fixed). The warning came down with
 * them: a permanent notice about a defect that no longer exists trains people to distrust
 * figures that are now correct, which costs more than it ever bought.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Coins, HandCoins, Receipt, TrendingUp } from 'lucide-react';
import {
  Alert,
  cn,
  Combobox,
  EmptyState,
  RecordPanel,
  StatusText,
  ViewSwitcher,
  type StatusTone,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { MetricStrip } from '@/components/widget/metric-strip';
import { MONEY_SCALE, fromMinorUnits, sumMinorUnits } from '@/lib/money';

import { formatDate, formatMoney } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';

import { useProjectCommitmentSummary, useProjectCommitments } from '../hooks/use-procurement';
import type { CommitmentLedgerEntry, CommitmentStage } from '../types';

// ─── Project cost position (§12.9) ────────────────────────────

/**
 * Committed → accrued → actual for one project.
 *
 * Rendered in two shapes. `panel` is what the Procurement tab wants beside its other widgets;
 * `overview` is the project Overview's version — the same bounded surface every region there
 * uses, with the three stages as a metric strip rather than a stack of labelled rows
 * (`ux-doctrine.md` §2.2).
 *
 * Hidden entirely without `view:commitment-ledger` — §12.9 is explicit that this is hidden
 * rather than shown empty, because an empty commitments card reads as "this project has
 * committed nothing".
 */
export function ProjectCommitmentsCard({
  projectId,
  currencyCode,
  presentation = 'panel',
}: {
  projectId: string;
  currencyCode: string | null;
  presentation?: 'panel' | 'overview';
}) {
  const t = useTranslations('procurement.commitments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const allowed = can(PROCUREMENT_PERMISSIONS.viewCommitments);
  const summary = useProjectCommitmentSummary(projectId, { enabled: allowed });

  if (!allowed) return null;

  const stages = [
    { key: 'committed', value: summary.data?.committed },
    { key: 'accrued', value: summary.data?.accrued },
    { key: 'actual', value: summary.data?.actual },
  ] as const;

  if (presentation === 'overview') {
    return (
      <RecordPanel
        title={t('projectSectionTitle')}
        meta={t('projectSectionHint')}
        icon={<Coins size={17} />}
        action={
          <Link
            href={`/projects/${projectId}/procurement`}
            className="text-caption font-medium text-brand-primary hover:underline"
          >
            {t('openProcurement')}
          </Link>
        }
      >
        {summary.isPending ? (
          <div className="h-20 animate-pulse rounded-control bg-muted" aria-hidden="true" />
        ) : summary.isError ? (
          <p className="text-caption text-muted-foreground">{tc('loadFailed')}</p>
        ) : (
          // A metric strip, not three cards inside a card: committed → accrued → actual is one
          // sentence read left to right, and boxing each step made them look like three
          // measurements of unrelated things.
          <dl className="grid gap-y-5 sm:grid-cols-3 sm:gap-y-0 sm:divide-x sm:divide-border">
            {stages.map(({ key, value }, index) => (
              <div key={key} className={cn('min-w-0', index > 0 && 'sm:ps-5')}>
                <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t(key)}
                </dt>
                {/* `text-h1` rather than body weight: doctrine §2.2 puts a metric strip's
                    value at the top of the type scale precisely so it reads as a measurement
                    rather than as another row of a definition list. */}
                <dd className="mt-1.5 text-h1 font-semibold tabular-nums text-foreground">
                  {formatMoney(value, currencyCode, locale) ?? tc('notAvailable')}
                </dd>
                <dd className="mt-1 text-caption leading-4 text-muted-foreground">
                  {t(`${key}Hint`)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </RecordPanel>
    );
  }

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      <div className="border-b border-border px-5 py-3 sm:px-6">
        <h3 className="text-body-sm font-semibold text-foreground">{t('cardTitle')}</h3>
      </div>

      {summary.isPending ? (
        <div className="px-5 py-4 sm:px-6">
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" aria-hidden="true" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      ) : summary.isError ? (
        <p className="px-5 py-4 text-sm text-muted-foreground sm:px-6">{tc('loadFailed')}</p>
      ) : (
        <>
          <dl className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
            {stages.map(({ key, value }, index) => {
              const MetricIcon = [HandCoins, TrendingUp, Receipt][index];
              return (
                <div key={key} className="p-4 sm:p-5">
                  <dt
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
                    title={t(`${key}Hint`)}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-control bg-surface-subtle text-muted-foreground">
                      <MetricIcon size={17} aria-hidden="true" />
                    </span>
                    {t(key)}
                  </dt>
                  <dd className="mt-3 text-lg font-semibold tabular-nums text-foreground">
                    {formatMoney(value, currencyCode, locale) ?? tc('notAvailable')}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="border-t border-border px-5 py-3 sm:px-6">
            <Link
              href={`/procurement/commitments?projectId=${projectId}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary underline-offset-2 hover:underline"
            >
              {t('viewLedger')} →
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Ledger screen ────────────────────────────────────────────────────────────

type StageView = 'ALL' | CommitmentStage;

const STAGE_VIEWS: StageView[] = ['ALL', 'COMMITTED', 'ACCRUED', 'ACTUAL'];

const STAGE_TEXT_TONE: Record<CommitmentStage, StatusTone> = {
  COMMITTED: 'progress',
  ACCRUED: 'attention',
  ACTUAL: 'success',
};

/** A signed amount: negatives in parentheses, the accounting convention. */
function signedMoney(value: string, currency: string | null): string {
  const negative = value.trim().startsWith('-');
  const formatted = formatMoney(negative ? value.trim().slice(1) : value, currency) ?? value;
  return negative ? `(${formatted})` : formatted;
}

function documentHref(entry: CommitmentLedgerEntry): string | null {
  if (entry.sourceDocumentType === 'GOODS_RECEIPT') return `/procurement/grn/${entry.sourceDocumentId}`;
  if (entry.sourceDocumentType === 'SUPPLIER_BILL') return `/finance/accounting/bills/${entry.sourceDocumentId}`;
  return entry.purchaseOrderId ? `/procurement/orders/${entry.purchaseOrderId}` : null;
}

/**
 * The commitment ledger for one project: what is ordered, received and billed, and every entry
 * behind those figures. Ordered/Received/Billed are the plain names for the COMMITTED/ACCRUED/
 * ACTUAL stages. The whole screen is money, so a viewer without `view:commitment-ledger` sees
 * one hidden state rather than a page of blanks.
 */
export function CommitmentLedger({ initialProjectId }: { initialProjectId?: string }) {
  const t = useTranslations('procurement.commitments.ledger');
  const tc = useTranslations('procurement.common');
  const tSource = useTranslations('procurement.commitments.sourceType');
  const { can } = usePermissions();
  const allowed = can(PROCUREMENT_PERMISSIONS.viewCommitments);

  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [view, setView] = useState<StageView>('ALL');

  const projects = useProjects();
  const ledgerProject = allowed ? projectId : '';
  const entries = useProjectCommitments(ledgerProject, view === 'ALL' ? undefined : { stage: view });
  const summary = useProjectCommitmentSummary(ledgerProject, { enabled: Boolean(ledgerProject) });

  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  const currency = project?.currency ?? 'USD';

  const projectOptions = useMemo(
    () => (projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
    [projects.data],
  );

  if (!allowed) {
    return <EmptyState title={t('hiddenTitle')} description={t('hiddenBody')} />;
  }

  const total =
    summary.data !== undefined
      ? fromMinorUnits(
          sumMinorUnits([summary.data.committed, summary.data.accrued, summary.data.actual], MONEY_SCALE),
          MONEY_SCALE,
        )
      : null;
  const money = (value: string | null | undefined) =>
    value === null || value === undefined ? null : formatMoney(value, currency);

  const columns: GridColumn<CommitmentLedgerEntry>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      sortable: true,
      card: 'meta',
      plainValue: (entry) => entry.accountingDate,
      render: (entry, ctx) => formatDate(entry.accountingDate, ctx.locale) ?? tc('notAvailable'),
    },
    {
      key: 'document',
      header: t('columns.document'),
      sticky: true,
      card: 'title',
      plainValue: (entry) => entry.documentNumber ?? tSource(entry.sourceDocumentType),
      render: (entry) => {
        const href = documentHref(entry);
        const label = entry.documentNumber ?? tSource(entry.sourceDocumentType);
        return (
          <span className="block min-w-0">
            {href ? (
              <Link href={href} className="font-medium text-brand-primary underline-offset-2 hover:underline">
                {label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{label}</span>
            )}
            {entry.supplierName ? (
              <span className="block truncate text-caption text-muted-foreground">{entry.supplierName}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'chargedTo',
      header: t('columns.chargedTo'),
      card: 'subtitle',
      plainValue: (entry) => (entry.boqNode ? `${entry.boqNode.code} ${entry.boqNode.name}` : t('overhead')),
      render: (entry) =>
        entry.boqNode ? (
          <span className="block min-w-0">
            <span className="font-mono text-caption text-muted-foreground">{entry.boqNode.code}</span>{' '}
            <span className="text-foreground">{entry.boqNode.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('overhead')}</span>
        ),
    },
    {
      key: 'stage',
      header: t('columns.stage'),
      card: 'status',
      render: (entry) => (
        <span className="block">
          <StatusText tone={STAGE_TEXT_TONE[entry.stage]}>{t(`stage.${entry.stage}`)}</StatusText>
          {entry.stage === 'COMMITTED' &&
          entry.sourceDocumentType === 'GOODS_RECEIPT' &&
          entry.reportingAmount.trim().startsWith('-') ? (
            <span className="block text-caption text-muted-foreground">{t('releasedOnReceipt')}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (entry) => Number(entry.reportingAmount),
      render: (entry) => <span className="tabular-nums">{signedMoney(entry.reportingAmount, currency)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-80">
          <label htmlFor="ledger-project" className="mb-1 block text-caption font-medium text-muted-foreground">
            {t('project')}
          </label>
          <Combobox
            id="ledger-project"
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            placeholder={t('projectPlaceholder')}
            searchPlaceholder={t('projectSearch')}
            emptyLabel={t('projectEmpty')}
            loading={projects.isPending}
          />
        </div>
        {projectId ? (
          <ViewSwitcher
            aria-label={t('stageLabel')}
            appearance="segmented"
            value={view}
            onValueChange={(next) => setView(next as StageView)}
            items={STAGE_VIEWS.map((value) => ({ value, label: t(`view.${value}`) }))}
          />
        ) : null}
      </div>

      {projectId === '' ? (
        <EmptyState title={t('noProjectTitle')} description={t('noProjectBody')} />
      ) : (
        <>
          {summary.isError ? (
            <Alert variant="error" messages={[tc('loadFailed')]} />
          ) : (
            <MetricStrip
              aria-label={t('summaryLabel')}
              columns={4}
              metrics={[
                { label: t('view.COMMITTED'), value: money(summary.data?.committed), sublabel: t('orderedHint') },
                { label: t('view.ACCRUED'), value: money(summary.data?.accrued), sublabel: t('receivedHint') },
                { label: t('view.ACTUAL'), value: money(summary.data?.actual), sublabel: t('billedHint') },
                { label: t('total'), value: money(total), sublabel: t('totalHint') },
              ]}
            />
          )}

          <PlatformDataGrid
            columns={columns}
            data={entries.data ?? []}
            rowKey={(entry) => entry.id}
            label={t('entries')}
            isLoading={entries.isPending}
            isError={entries.isError}
            errorMessage={tc('loadFailed')}
            onRetry={() => void entries.refetch()}
            toolbar={false}
            pagination={{ defaultPageSize: 25 }}
            defaultSort={{ key: 'date', direction: 'desc' }}
            emptyState={<EmptyState variant="inline" title={t('emptyTitle')} description={t('emptyBody')} />}
          />
        </>
      )}
    </div>
  );
}
