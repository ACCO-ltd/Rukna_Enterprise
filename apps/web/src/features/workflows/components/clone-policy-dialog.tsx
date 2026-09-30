'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import type { ApprovalPolicySummary } from '../api/workflows-api';
import {
  useApprovalPolicyComparison,
  useApprovalPolicyVersions,
  useCloneApprovalPolicy,
} from '../hooks/use-approval-policies';
import { PolicyComparisonDiff } from './policy-comparison-diff';

/**
 * Clones an existing policy version into a new DRAFT — the rollback / edit-an-active-version path.
 *
 * Consumes `useCloneApprovalPolicy` → `POST /workflows/policies/:id/clone`. A reason is required
 * (the server records it on the audit entry). On success the new draft summary is handed back to
 * `onCloned`, which lets the caller open it straight into the rule builder.
 *
 * **Rollback preview.** A clone is how an older version is rolled back into force. Before the
 * administrator confirms, this dialog shows what activating that rollback would change: the diff
 * `compare(base = currently ACTIVE version, target = the version being cloned)`. The version list is
 * fetched by policyKey to locate the active version. Three honest edge cases:
 *
 *  - the version being cloned **is** the active version → nothing to preview (a plain re-clone);
 *  - there is **no** active version → we say so rather than hide the control;
 *  - the preview read fails or is loading → its own state, and it never blocks the clone action.
 *
 * A `FormDialog` (ADR-039), size `xl`: one field plus a rules diff.
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

  // Locate the currently active version of this policyKey to preview the rollback impact against.
  const history = useApprovalPolicyVersions(open && policy ? policy.policyKey : null);
  const activeVersion = history.data?.versions.find((version) => version.status === 'ACTIVE') ?? null;
  const rollbackToSelf = Boolean(policy && activeVersion && activeVersion.id === policy.id);

  const preview = useApprovalPolicyComparison(
    !rollbackToSelf && activeVersion ? activeVersion.id : null,
    !rollbackToSelf && policy ? policy.id : null,
  );

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
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
      size="xl"
      title={t('title')}
      subtitle={
        policy
          ? t('description', { policyKey: policy.policyKey, version: policy.version })
          : t('descriptionGeneric')
      }
      dirty={reason.trim() !== ''}
      busy={clone.isPending}
      onSubmit={submit}
    >
      <FormDialogBody className="space-y-4">
        {/* Rollback impact preview — active version vs the version being cloned. */}
        {policy ? (
          <section aria-label={t('previewHeading')}>
            <h3 className="text-sm font-semibold text-foreground">{t('previewHeading')}</h3>
            {history.isPending ? (
              <div
                className="mt-3 h-24 animate-pulse rounded-panel border border-border bg-muted"
                aria-hidden="true"
              />
            ) : history.isError ? (
              <Alert className="mt-3" variant="error" messages={[t('previewLoadFailed')]} />
            ) : !activeVersion ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('previewNoActive')}</p>
            ) : rollbackToSelf ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('previewIsActive')}</p>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('previewIntro', { active: activeVersion.version, target: policy.version })}
                </p>
                {preview.isPending ? (
                  <div
                    className="h-24 animate-pulse rounded-panel border border-border bg-muted"
                    aria-hidden="true"
                  />
                ) : preview.isError ? (
                  <Alert variant="error" messages={[t('previewLoadFailed')]} />
                ) : preview.data ? (
                  <PolicyComparisonDiff comparison={preview.data} />
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        <FormField htmlFor="clone-reason" label={t('reason')} hint={t('reasonHint')} required>
          <Input
            id="clone-reason"
            data-autofocus=""
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={240}
            required
          />
        </FormField>
        {cloneError ? <Alert variant="error" messages={cloneError} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={clone.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" disabled={clone.isPending || reason.trim().length < 3}>
          {clone.isPending ? t('cloning') : t('confirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
