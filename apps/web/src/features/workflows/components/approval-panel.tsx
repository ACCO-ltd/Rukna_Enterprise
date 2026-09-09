'use client';

/** Decisions use the server's organization-scoped role and segregation-of-duties checks. */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';

import { approvalBlockReason, canActOnStep, stepPosition } from '../approval-actions';
import { useApprovalStep, useApprovalAction } from '../hooks/use-approval';
import { useWorkflowDefinition } from '../hooks/use-workflow-definition';
import type { WorkflowTransactionType } from '../types';

export function ApprovalPanel({
  instanceId,
  transactionType,
}: {
  /** From the document payload. Null when the document has not been submitted for approval. */
  instanceId: string | null;
  transactionType?: WorkflowTransactionType;
}) {
  const t = useTranslations('platform.approval');
  const tCommon = useTranslations('common');

  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);

  const { user } = useSession();
  const step = useApprovalStep(instanceId);
  const definition = useWorkflowDefinition(transactionType);
  const action = useApprovalAction(instanceId ?? '', () => setPending(null));

  // Nothing to show on a document that was never routed for approval.
  if (!instanceId) return null;

  if (step.isPending) {
    return (
      <section className="rounded-panel border border-border bg-surface p-4" aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-16 animate-pulse rounded bg-muted" aria-hidden="true" />
      </section>
    );
  }

  if (step.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const current = step.data ?? null;
  const roles = user?.roles ?? [];
  const blocked = approvalBlockReason(current, roles);
  const position = stepPosition(current, definition.data?.steps ?? []);

  return (
    <>
      <section className="space-y-4 rounded-panel border border-brand-primary/20 bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {current
                ? position
                  ? t('pendingWithPosition', {
                      role: current.roleRequired,
                      position: position.position,
                      total: position.total,
                    })
                  : t('pending', { role: current.roleRequired })
                : t('noPendingStep')}
            </p>
          </div>

          {current ? (
            <Badge tone={canActOnStep(current, roles) ? 'live' : 'neutral'}>
              {current.roleRequired}
            </Badge>
          ) : null}
        </div>

        {blocked === 'wrong-role' ? (
          <Alert variant="info" messages={[t('wrongRole', { role: current!.roleRequired })]} />
        ) : null}

        {action.error instanceof ApiError ? (
          <Alert variant="error" messages={[action.error.message]} />
        ) : null}

        {current ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              disabled={blocked !== null || action.isPending}
              onClick={() => setPending('approve')}
            >
              {t('approve')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={blocked !== null || action.isPending}
              onClick={() => setPending('reject')}
            >
              {t('reject')}
            </Button>
          </div>
        ) : null}
      </section>

      {pending ? (
        <ConfirmActionDialog
          title={t(`${pending}Title`)}
          description={t(`${pending}Body`)}
          confirmLabel={t(pending)}
          // Notes are optional on both endpoints. Required on reject, because a rejection
          // nobody explained is a document that stops with no way to learn why — nothing
          // returns an instance to PENDING.
          reason={{
            label: t('notes'),
            required: pending === 'reject',
            hint: pending === 'reject' ? t('rejectNotesHint') : t('approveNotesHint'),
          }}
          isPending={action.isPending}
          errorMessage={
            action.error instanceof ApiError ? action.error.message : undefined
          }
          onConfirm={(notes) =>
            action.mutate({
              decision: pending,
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            })
          }
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
