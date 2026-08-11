'use client';

/**
 * The approval panel: the pending step of a document's DOA chain, and the decision on it.
 *
 * Hangs off a document detail page rather than standing alone, because **an approval inbox is
 * not buildable**. No endpoint lists approval instances — not by approver, not at all — so an
 * `instanceId` can only be discovered by already looking at the document that owns it.
 * `approvalInstanceId` is a scalar on `MaterialRequest` and `PurchaseOrder`, and both
 * repositories `include` without `select`, so it arrives on the payload.
 *
 * ─── This panel offers a control the server does not have ───────────────────────
 *
 * `WorkflowStep.roleRequired` names the role a step is reserved for. `approval.service.ts`
 * never reads it: it checks the instance is PENDING, records the action, and advances. The
 * controller documents a `403 Actor is not authorized` that the service cannot produce
 * ([#45](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/45)). The lookup is not
 * organization-scoped either.
 *
 * So the panel checks `roleRequired` itself, and says plainly that the check is its own. An
 * approval screen that looked authoritative would be worse than one that admits what it is —
 * the endpoint is callable directly by anyone with a token.
 */

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
  transactionType: WorkflowTransactionType;
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
      <section className="rounded-lg border border-border bg-surface p-4" aria-busy="true">
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
      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
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

        {/* #45. Said at the point of the decision, not in a footnote: the role check above is
            the frontend's own, and the endpoint behind these buttons enforces nothing. */}
        <Alert variant="warning" messages={[t('advisoryNotice')]} />

        {blocked === 'wrong-role' ? (
          <Alert variant="info" messages={[t('wrongRole', { role: current!.roleRequired })]} />
        ) : null}

        {action.error instanceof ApiError ? (
          <Alert variant="error" messages={[action.error.message]} />
        ) : null}

        {current ? (
          <div className="flex flex-wrap gap-2">
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
