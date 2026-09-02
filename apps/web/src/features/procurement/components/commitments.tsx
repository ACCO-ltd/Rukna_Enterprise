'use client';

/**
 * Commitment ledger (§12.9) — the project card and the full ledger screen.
 *
 * These are the figures Sprint 5 exists to produce, and two server defects make them
 * overstate committed cost in ordinary use:
 *
 *  - Cancelling a purchase order writes no reversal, so its commitments stand forever
 *    (P12).
 *  - Superseding a revision reverses the full original value rather than the uncommitted
 *    balance, so a revision received against before revision drives COMMITTED negative
 *    (P11).
 *
 * Neither is correctable from here — the ledger is append-only and has no write endpoint.
 * Both surfaces therefore carry a note. A note is not a fix, and it is the only thing a
 * consumer of wrong numbers can honestly do.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { HandCoins, Receipt, TrendUp, WarningCircle } from '@phosphor-icons/react';
import {
  Alert,
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

// ─── Project card (§12.9) ─────────────────────────────────────────────────────

/**
 * Rendered on the project page. Hidden entirely without `view:commitment-ledger` —
 * §12.9 is explicit that this is hidden rather than shown empty, because an empty
 * commitments card reads as "this project has committed nothing".
 */
export function ProjectCommitmentsCard({
  projectId,
  currencyCode,
  embedded = false,
}: {
  projectId: string;
  currencyCode: string | null;
  embedded?: boolean;
}) {
  const t = useTranslations('procurement.commitments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const allowed = can(PROCUREMENT_PERMISSIONS.viewCommitments);
  const summary = useProjectCommitmentSummary(projectId, { enabled: allowed });

  if (!allowed) return null;

  return (
    <section
      className={
        embedded ? '' : 'overflow-hidden rounded-panel border border-border bg-surface shadow-e1'
      }
    >
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
            {(
              [
                ['committed', summary.data?.committed],
                ['accrued', summary.data?.accrued],
                ['actual', summary.data?.actual],
              ] as const
            ).map(([key, value], index) => {
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
            <p className="flex items-start gap-2 text-caption leading-5 text-muted-foreground">
              <WarningCircle
                size={17}
                className="mt-0.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              {t('accuracyNotice')}
            </p>
            <Link
              href={`/procurement/commitments?projectId=${projectId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary underline-offset-2 hover:underline"
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

          {/* ── Accuracy notice — below the data it qualifies ─────────────── */}
          <Alert variant="warning" messages={[t('accuracyNotice')]} />
        </>
      )}
    </div>
  );
}
