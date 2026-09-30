'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ActivityTimeline, Alert, type ActivityTimelineEntry } from '@erp/ui';

import { formatDateTime } from '@/lib/format';
import { useApprovalPolicyHistory } from '../hooks/use-approval-policies';
import { humanizePolicyAction } from '../policy-history';

/**
 * Read-only governance history for a policy version, on the shared `ActivityTimeline`.
 *
 * Consumes `useApprovalPolicyHistory` → `GET /workflows/policies/:id/history`. Newest first
 * (the server orders by `createdAt desc`). Each entry is one sentence — **who** did what to the
 * policy — with the decision reason where one was captured, and the time underneath. Purely
 * informational — no affordances.
 */
export function PolicyHistoryTimeline({ policyId }: { policyId: string }) {
  const t = useTranslations('platform.workflows.policies.history');
  const locale = useLocale() as 'en' | 'ar';
  const history = useApprovalPolicyHistory(policyId);

  if (history.isPending) {
    return <div className="h-24 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />;
  }

  if (history.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const entries: ActivityTimelineEntry[] = (history.data ?? []).map((entry) => ({
    id: entry.id,
    actor: entry.actorName ?? t('unknownActor'),
    action: entry.reason ? (
      <>
        {humanizePolicyAction(entry.action)}
        <span className="text-muted-foreground"> — {entry.reason}</span>
      </>
    ) : (
      humanizePolicyAction(entry.action)
    ),
    at: formatDateTime(entry.createdAt, locale) ?? '',
    dateTime: entry.createdAt,
  }));

  return (
    <ActivityTimeline
      label={t('title')}
      entries={entries}
      empty={
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      }
    />
  );
}
