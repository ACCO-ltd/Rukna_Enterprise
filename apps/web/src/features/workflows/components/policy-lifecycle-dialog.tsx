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
 *
 * Copy is not stored here — every title/description/button routes through the i18n catalogue
 * (`platform.workflows.policies.builder.lifecycle`). This map carries only structural config:
 * which transition needs an effective date, and its key prefix.
 */
const LIFECYCLE_CONFIG: Record<
  LifecycleAction,
  { keyPrefix: 'submitReview' | 'schedule' | 'activate' | 'retire'; needsDate: boolean }
> = {
  'submit-review': { keyPrefix: 'submitReview', needsDate: false },
  schedule: { keyPrefix: 'schedule', needsDate: true },
  activate: { keyPrefix: 'activate', needsDate: true },
  retire: { keyPrefix: 'retire', needsDate: false },
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

  const config = action ? LIFECYCLE_CONFIG[action] : null;

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
        {action && config ? (
          <form onSubmit={submit}>
            <DialogTitle>{t(`lifecycle.${config.keyPrefix}Title`)}</DialogTitle>
            <DialogDescription>{t(`lifecycle.${config.keyPrefix}Description`)}</DialogDescription>
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
              {config.needsDate ? (
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
                {t(`lifecycle.${config.keyPrefix}Button`)}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
