'use client';

/**
 * A single governed action, driven through the ADR-011/015 approval gate.
 *
 * Wraps one command (PO submit, bill submit, payment approve). Behaviour depends on whether a
 * DOA binding is configured for the transition:
 *
 *   • No binding  → the command runs and succeeds on the first click; `onDone` fires. The button
 *                   is indistinguishable from a plain action, so this is safe to use everywhere.
 *   • Binding set → the first click returns `409` carrying an `approvalInstanceId` (the server
 *                   opened an approval instead of transitioning). We hold that id, render the
 *                   {@link ApprovalPanel} for it, and offer a "Complete" button. Once approvers
 *                   act and the instance is APPROVED, "Complete" re-drives the command: the gate
 *                   consumes the approval and the transition proceeds.
 *
 * The re-drive is deliberate rather than automatic — nothing pushes approval state to the
 * browser, and the `ApprovalPanel`'s own role check is advisory (#45). "Complete" is honest: it
 * asks the server, and if the chain is still pending it simply gates again and waits.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { useGatedCommand } from '../use-gated-command';
import type { WorkflowTransactionType } from '../types';
import { ApprovalPanel } from './approval-panel';

export function GatedActionButton({
  command,
  transactionType,
  label,
  disabled = false,
  variant = 'default',
  onDone,
}: {
  /** The governed mutation. Should reject with the raw `ApiError` on failure. */
  command: () => Promise<unknown>;
  /** Which chain the resulting approval belongs to — passed through to the panel. */
  transactionType: WorkflowTransactionType;
  /** The action's label, e.g. "Submit". */
  label: string;
  disabled?: boolean;
  variant?: 'default' | 'outline';
  /** Called when the command ultimately succeeds (immediately, or after the re-drive). */
  onDone?: () => void;
}) {
  const t = useTranslations('platform.approval');
  const { run, approvalInstanceId, pending, error } = useGatedCommand(command);

  const handleRun = useCallback(async () => {
    try {
      const { gated } = await run();
      if (!gated) onDone?.();
    } catch {
      // A non-gate failure is already surfaced through `error`; the button stays put.
    }
  }, [run, onDone]);

  // Ungated: a plain action button. This is the whole life of the control when no binding exists.
  if (!approvalInstanceId) {
    return (
      <div className="space-y-2">
        <Button type="button" variant={variant} disabled={disabled || pending} onClick={handleRun}>
          {label}
        </Button>
        {error ? <Alert variant="error" messages={[error]} /> : null}
      </div>
    );
  }

  // Gated: the approval chain, plus the re-drive.
  return (
    <div className="space-y-3">
      <Alert variant="info" messages={[t('gate.awaiting')]} />

      <ApprovalPanel instanceId={approvalInstanceId} transactionType={transactionType} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
        <Button type="button" variant={variant} disabled={pending} onClick={handleRun}>
          {t('gate.complete')}
        </Button>
        <span className="text-sm text-muted-foreground">{t('gate.completeHint')}</span>
      </div>

      {error ? <Alert variant="error" messages={[error]} /> : null}
    </div>
  );
}
