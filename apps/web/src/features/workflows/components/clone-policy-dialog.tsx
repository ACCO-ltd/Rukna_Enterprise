'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import type { ApprovalPolicySummary } from '../api/workflows-api';
import { useCloneApprovalPolicy } from '../hooks/use-approval-policies';

/**
 * Clones an existing policy version into a new DRAFT — the rollback / edit-an-active-version path.
 *
 * Consumes `useCloneApprovalPolicy` → `POST /workflows/policies/:id/clone`. A reason is required
 * (the server records it on the audit entry). On success the new draft summary is handed back to
 * `onCloned`, which lets the caller open it straight into the rule builder.
 */
export function ClonePolicyDialog({
  policy,
  open,
  onOpenChange,
  onCloned,
}: {
  policy: ApprovalPolicySummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (draft: ApprovalPolicySummary) => void;
}) {
  const t = useTranslations('platform.workflows.policies.clone');
  const clone = useCloneApprovalPolicy();
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || reason.trim().length < 3) return;
    clone.mutate(
      { id: policy.id, reason: reason.trim() },
      {
        onSuccess: (draft) => {
          setReason('');
          onOpenChange(false);
          onCloned(draft);
        },
      },
    );
  }

  const cloneError =
    clone.error instanceof ApiError && clone.error.messages.length > 0
      ? clone.error.messages
      : clone.isError
        ? [t('failed')]
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {policy ? t('description', { policyKey: policy.policyKey, version: policy.version }) : t('descriptionGeneric')}
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <FormField htmlFor="clone-reason" label={t('reason')} hint={t('reasonHint')} required>
            <Input
              id="clone-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={240}
              required
            />
          </FormField>
          {cloneError ? <Alert variant="error" messages={cloneError} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={clone.isPending || reason.trim().length < 3}>
              {clone.isPending ? t('cloning') : t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
