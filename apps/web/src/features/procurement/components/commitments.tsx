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

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Coins, HandCoins, Receipt, TrendUp } from '@phosphor-icons/react';
import {
  Alert,
  cn,
  RecordPanel,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';

import { useProjectCommitmentSummary, useProjectCommitments } from '../hooks/use-procurement';
import type { CommitmentStage } from '../types';
import { ClassificationChips } from './classification-chips';
import { CommitmentStageTag } from './procurement-badges';

const STAGES: CommitmentStage[] = ['COMMITTED', 'ACCRUED', 'ACTUAL'];

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
              const MetricIcon = [HandCoins, TrendUp, Receipt][index];
              return (
                <div key={key} className="p-4 sm:p-5">
                  <dt
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
                    title={t(`${key}Hint`)}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-control bg-surface-subtle text-muted-foreground">
                      <MetricIcon size={17} weight="duotone" aria-hidden="true" />
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

export function CommitmentLedger({ initialProjectId }: { initialProjectId?: string }) {
  const t = useTranslations('procurement.commitments');
  const tc = useTranslations('procurement.common');
  const tSource = useTranslations('procurement.commitments.sourceType');
  const locale = useLocale() as 'en' | 'ar';

  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [stage, setStage] = useState<CommitmentStage | ''>('');

  const projects = useProjects();
  const entries = useProjectCommitments(projectId, stage ? { stage } : undefined);
  const summary = useProjectCommitmentSummary(projectId, { enabled: Boolean(projectId) });

  const project = projects.data?.find((p) => p.id === projectId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* ── Project + stage filters ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <label
            htmlFor="ledger-project"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            {tc('project')}
          </label>
          <Select
            id="ledger-project"
            value={projectId}
            onChange={(value) => setProjectId(value)}
          >
            <option value="">{t('selectProject')}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{t('selectProjectHint')}</p>
        </div>
      </div>

      {/* ── Stage filter pills ────────────────────────────────────────────── */}
      <fieldset>
        <legend className="sr-only">{t('stage')}</legend>
        <div className="flex flex-wrap gap-2">
          {([''] as (CommitmentStage | '')[]).concat(STAGES).map((value) => (
            <label
              key={value || 'all'}
              className={`inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 text-sm transition-colors ${
                stage === value
                  ? 'border-brand-primary bg-brand-primary/10 font-medium text-brand-primary'
                  : 'border-border text-muted-foreground hover:border-brand-primary/40 hover:text-foreground'
              }`}
            >
              <input
                type="radio"
                name="stage"
                className="sr-only"
                checked={stage === value}
                onChange={() => setStage(value)}
              />
              {value === ''
                ? tc('all')
                : t(value.toLowerCase() as 'committed' | 'accrued' | 'actual')}
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── No project selected ────────────────────────────────────────────── */}
      {projectId === '' ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center shadow-[var(--shadow-panel)]">
          <p className="text-sm font-medium text-foreground">{t('selectProject')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('selectProjectHint')}
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary tiles (when project is selected) ─────────────────── */}
          {summary.data ? (
            <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-3">
              {(
                [
                  ['committed', summary.data.committed, t('committedHint')],
                  ['accrued', summary.data.accrued, t('accruedHint')],
                  ['actual', summary.data.actual, t('actualHint')],
                ] as const
              ).map(([key, value, hint]) => (
                <div key={key} className="bg-surface px-5 py-4">
                  <dt className="text-xs font-medium text-muted-foreground" title={hint}>
                    {t(key)}
                  </dt>
                  <dd className="mt-1.5 text-sm font-semibold tabular-nums text-foreground">
                    {formatMoney(value, project?.currency ?? null, locale) ?? tc('notAvailable')}
                  </dd>
                </div>
              ))}
            </dl>
          ) : summary.isPending ? (
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-surface px-5 py-4" aria-hidden="true">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-4 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : null}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {entries.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

          {/* ── Ledger table ─────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
            <div className="border-b border-border px-5 py-3 sm:px-6">
              <h2 className="text-[13px] font-semibold text-foreground">{t('title')}</h2>
            </div>

            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tc('date')}</TableHead>
                    <TableHead>{t('eventType')}</TableHead>
                    <TableHead>{t('stage')}</TableHead>
                    <TableHead className="text-end">{t('reportingAmount')}</TableHead>
                    <TableHead>{t('sourceDoc')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(entries.data ?? []).length === 0 ? (
                    <TableEmpty colSpan={5}>{t('empty')}</TableEmpty>
                  ) : (
                    (entries.data ?? []).map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          <bdi>
                            {formatDate(entry.accountingDate, locale) ?? tc('notAvailable')}
                          </bdi>
                        </TableCell>
                        <TableCell className="text-sm">{entry.eventType}</TableCell>
                        <TableCell>
                          <CommitmentStageTag stage={entry.stage} />
                        </TableCell>
                        <TableCell className="text-end">
                          <span className="block font-medium tabular-nums">
                            {formatMoney(entry.reportingAmount, project?.currency ?? null, locale)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.sourceDocumentType === 'PURCHASE_ORDER_REVISION' &&
                          entry.purchaseOrderId ? (
                            <Link
                              href={`/procurement/orders/${entry.purchaseOrderId}`}
                              className="font-medium text-brand-primary underline-offset-2 hover:underline"
                            >
                              {tSource(entry.sourceDocumentType)}
                            </Link>
                          ) : entry.sourceDocumentType === 'GOODS_RECEIPT' ? (
                            <Link
                              href={`/procurement/grn/${entry.sourceDocumentId}`}
                              className="font-medium text-brand-primary underline-offset-2 hover:underline"
                            >
                              {tSource(entry.sourceDocumentType)}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {tSource(entry.sourceDocumentType)}
                            </span>
                          )}
                          {/* Read-only cost-target chip (D7). A commitment entry carries a
                              boqNodeId when it is attributed to a cost target; only the id is
                              sent, so the chip states a target is set without naming it. The
                              spendCategoryId is likewise id-only, so no spend-category chip is
                              faked here. */}
                          <ClassificationChips
                            className="mt-1.5 flex flex-wrap items-center gap-1.5"
                            hasCostTarget={Boolean(entry.boqNodeId)}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableScroll>
          </section>
        </>
      )}
    </div>
  );
}
