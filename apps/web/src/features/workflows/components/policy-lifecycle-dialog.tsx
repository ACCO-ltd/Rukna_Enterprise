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
import { useTransitionApprovalPolicy } from '../hooks/use-approval-policies';

export type LifecycleAction = 'submit-review' | 'schedule' | 'activate' | 'retire';

/**
 * The four governed lifecycle transitions, unchanged from the retired builder sheet:
 * `submit-review` (DRAFT → IN_REVIEW), `schedule` (IN_REVIEW → SCHEDULED, needs an effective
 * date and a second administrator), `activate` (SCHEDULED → ACTIVE) and `retire` (ACTIVE →
 * RETIRED). Each requires a decision reason; `needsDate` transitions also require an effective
 * date. The four-eyes rule (the submitter cannot schedule their own draft) is enforced by the
 * API, which answers 409 — surfaced here verbatim via `ApiError.messages`.
 */
export const LIFECYCLE_COPY: Record<
  LifecycleAction,
  { title: string; description: string; button: string; needsDate: boolean }
> = {
  'submit-review': {
    title: 'Submit policy for review',
    description: 'The draft becomes read-only and must pass validation.',
    button: 'Submit for review',
    needsDate: false,
  },
  schedule: {
    title: 'Schedule policy',
    description:
      'A second administrator is required — the submitter cannot schedule their own draft. Select a future effective date.',
    button: 'Schedule policy',
    needsDate: true,
  },
  activate: {
    title: 'Activate policy',
    description: 'Confirm the policy is due and ready to govern transactions.',
    button: 'Activate policy',
    needsDate: true,
  },
  retire: {
    title: 'Retire policy',
    description: 'This policy will stop applying to new evaluations.',
    button: 'Retire policy',
    needsDate: false,
  },
};

export function PolicyLifecycleDialog({
  policyId,
  action,
  onOpenChange,
}: {
  policyId: string;
  /** The active transition, or null when the dialog is closed. */
  action: LifecycleAction | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.workflows.policies.builder');
  const transition = useTransitionApprovalPolicy();
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    transition.mutate(
      { id: policyId, action, reason, effectiveFrom: effectiveFrom || undefined },
      {
        onSuccess: () => {
          setReason('');
          setEffectiveFrom('');
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          setEffectiveFrom('');
          onOpenChange(false);
        }
      }}
    >
      <DialogContent>
        {action ? (
          <form onSubmit={submit}>
            <DialogTitle>{LIFECYCLE_COPY[action].title}</DialogTitle>
            <DialogDescription>{LIFECYCLE_COPY[action].description}</DialogDescription>
            <div className="mt-4 space-y-3">
              <FormField htmlFor="lifecycle-reason" label={t('decisionReason')} required>
                <Input
                  id="lifecycle-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={3}
                />
              </FormField>
              {LIFECYCLE_COPY[action].needsDate ? (
                <FormField htmlFor="lifecycle-effective" label={t('effectiveDate')} required>
                  <Input
                    id="lifecycle-effective"
                    type="datetime-local"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                    required
                  />
                </FormField>
              ) : null}
              {transition.error ? (
                <Alert
                  variant="error"
                  messages={
                    transition.error instanceof ApiError && transition.error.messages.length > 0
                      ? transition.error.messages
                      : [t('transitionFailed')]
                  }
                />
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={transition.isPending}>
                {LIFECYCLE_COPY[action].button}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
