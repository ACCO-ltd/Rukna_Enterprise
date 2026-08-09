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
import {
  Alert,
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
import { CommitmentStageTag } from './procurement-badges';

const STAGES: CommitmentStage[] = ['COMMITTED', 'ACCRUED', 'ACTUAL'];

// ─── Project Command Center card (§12.9) ─────────────────────────────────────────

/**
 * Rendered on the project page. Hidden entirely without `view:commitment-ledger` —
 * §12.9 is explicit that this is hidden rather than shown empty, because an empty
 * commitments card reads as "this project has committed nothing".
 */
export function ProjectCommitmentsCard({
  projectId,
  currencyCode,
}: {
  projectId: string;
  currencyCode: string | null;
}) {
  const t = useTranslations('procurement.commitments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const allowed = can(PROCUREMENT_PERMISSIONS.viewCommitments);
  const summary = useProjectCommitmentSummary(projectId, { enabled: allowed });

  if (!allowed) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{t('cardTitle')}</h3>

      {summary.isPending ? (
        <div className="mt-3 h-20 animate-pulse rounded bg-muted" aria-hidden="true" />
      ) : summary.isError ? (
        <p className="mt-2 text-sm text-muted-foreground">{tc('loadFailed')}</p>
      ) : (
        <>
          <dl className="mt-3 space-y-2">
            {(
              [
                ['committed', summary.data?.committed],
                ['accrued', summary.data?.accrued],
                ['actual', summary.data?.actual],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground" title={t(`${key}Hint`)}>
                  {t(key)}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {formatMoney(value, currencyCode, locale) ?? tc('notAvailable')}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-xs text-muted-foreground">{t('accuracyNotice')}</p>

          <Link
            href={`/procurement/commitments?projectId=${projectId}`}
            className="mt-3 inline-block text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('viewLedger')} →
          </Link>
        </>
      )}
    </section>
  );
}

// ─── Ledger screen ───────────────────────────────────────────────────────────────

export function CommitmentLedger({ initialProjectId }: { initialProjectId?: string }) {
  const t = useTranslations('procurement.commitments');
  const tc = useTranslations('procurement.common');
  const tSource = useTranslations('procurement.commitments.sourceType');
  const locale = useLocale() as 'en' | 'ar';

  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [stage, setStage] = useState<CommitmentStage | ''>('');

  const projects = useProjects();
  const entries = useProjectCommitments(projectId, stage ? { stage } : undefined);

  const project = projects.data?.find((p) => p.id === projectId) ?? null;

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Alert variant="warning" messages={[t('accuracyNotice')]} />

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <label
            htmlFor="ledger-project"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            {tc('project')}
          </label>
          <select
            id="ledger-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{t('selectProject')}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">{t('selectProjectHint')}</p>
        </div>
      </div>

      {/* Stage tabs. Radio group rather than links, because the filter is a query
          parameter on the same screen and each option is one of a set. */}
      <fieldset>
        <legend className="sr-only">{t('stage')}</legend>
        <div className="flex flex-wrap gap-2">
          {([''] as (CommitmentStage | '')[]).concat(STAGES).map((value) => (
            <label
              key={value || 'all'}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm ${
                stage === value
                  ? 'border-brand-primary bg-brand-primary/10 font-medium text-brand-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              <input
                type="radio"
                name="stage"
                className="sr-only"
                checked={stage === value}
                onChange={() => setStage(value)}
              />
              {value === '' ? tc('all') : t(value.toLowerCase() as 'committed' | 'accrued' | 'actual')}
            </label>
          ))}
        </div>
      </fieldset>

      {projectId === '' ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('selectProject')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('selectProjectHint')}
          </p>
        </div>
      ) : entries.isError ? (
        <Alert variant="error" messages={[tc('loadFailed')]} />
      ) : (
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
                      <bdi>{formatDate(entry.accountingDate, locale) ?? tc('notAvailable')}</bdi>
                    </TableCell>
                    <TableCell className="text-sm">{entry.eventType}</TableCell>
                    <TableCell>
                      <CommitmentStageTag stage={entry.stage} />
                    </TableCell>
                    <TableCell className="text-end">
                      <span className="block font-medium tabular-nums">
                        {formatMoney(entry.reportingAmount, project?.currency ?? null, locale)}
                      </span>
                      {/* The transaction currency is only shown when it differs from the
                          reporting currency — otherwise it is the same number twice. */}
                      {entry.currencyCode !== (project?.currency ?? entry.currencyCode) ? (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {formatMoney(entry.amount, entry.currencyCode, locale)}
                        </span>
                      ) : null}
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
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </div>
  );
}
