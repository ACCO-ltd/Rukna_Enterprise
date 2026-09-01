'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { formatDate, relativeTime } from '@/lib/format';
import { useApprovalPolicyHistory } from '../hooks/use-approval-policies';
import { humanizePolicyAction } from '../policy-history';

/**
 * Read-only governance history for a policy version.
 *
 * Consumes `useApprovalPolicyHistory` → `GET /workflows/policies/:id/history`. Newest first
 * (the server orders by `createdAt desc`). Each entry shows the human-readable action, the
 * decision reason where one was captured, the actor id, and both an absolute and relative
 * timestamp. Purely informational — no affordances.
 */
export function PolicyHistoryTimeline({ policyId }: { policyId: string }) {
  const t = useTranslations('platform.workflows.policies.history');
  const history = useApprovalPolicyHistory(policyId);

  if (history.isPending) {
    return <div className="h-24 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />;
  }

  if (history.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const entries = history.data ?? [];
  if (entries.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          {/* connector spine; hidden on the last node */}
          {index < entries.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute start-[3.5px] top-3 h-full w-px bg-border"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="relative mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium text-foreground">
                {humanizePolicyAction(entry.action)}
              </span>
              <span className="text-caption tabular-nums text-muted-foreground">
                {formatDate(entry.createdAt) ?? '—'}
                {relativeTime(entry.createdAt) ? ` · ${relativeTime(entry.createdAt)}` : ''}
              </span>
            </div>
            {entry.reason ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{entry.reason}</p>
            ) : null}
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('actor')}: <span className="font-mono">{entry.userId}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
