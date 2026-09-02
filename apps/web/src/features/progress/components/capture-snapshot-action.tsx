'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, DatePicker, useToast } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { usePermissions } from '@/features/auth/permissions/can';

import { PROGRESS_PERMISSIONS } from '../permissions';
import { useCaptureProgressSnapshot } from '../hooks/use-progress';

/** Today as YYYY-MM-DD, in UTC to match how the API stores calendar dates. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CaptureSnapshotActionProps {
  projectId: string;
  /** `default` for the view header, `outline` when offered from an empty state. */
  variant?: 'default' | 'outline';
  /** Show the inline date field. When false, captures for today. */
  allowDateChoice?: boolean;
}

/**
 * The "Record progress snapshot" primary. Freezes the live physical/verified/cost numbers at a
 * period-end date (today by default). Permission-gated on `manage:project` — the same gate the
 * rest of the progress write chain uses — so a viewer never sees a control the API would refuse.
 *
 * A `409` (a snapshot already exists for that period) is a normal, expected outcome, not a crash:
 * it surfaces as a plain "already recorded" toast. Any other failure surfaces as an error toast.
 */
export function CaptureSnapshotAction({
  projectId,
  variant = 'default',
  allowDateChoice = false,
}: CaptureSnapshotActionProps) {
  const t = useTranslations('progress');
  const { can } = usePermissions();
  const { toast } = useToast();
  const capture = useCaptureProgressSnapshot(projectId);
  const [periodEndDate, setPeriodEndDate] = useState<string>(todayIso());

  // Honesty: no disabled stub for a user who cannot capture — the control simply is not there.
  if (!can(PROGRESS_PERMISSIONS.manage)) return null;

  function onCapture() {
    capture.mutate(
      { periodEndDate: periodEndDate || todayIso() },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('curve.capture.recorded') });
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            toast({ tone: 'info', title: t('curve.capture.alreadyRecorded') });
            return;
          }
          toast({ tone: 'error', title: t('curve.capture.failed') });
        },
      },
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {allowDateChoice ? (
        <label className="flex flex-col gap-1 text-caption text-muted-foreground">
          <span>{t('curve.capture.periodEndDate')}</span>
          <DatePicker
            id="snapshot-period-end"
            value={periodEndDate}
            max={todayIso()}
            onChange={(value) => setPeriodEndDate(value)}
          />
        </label>
      ) : null}
      <Button variant={variant} onClick={onCapture} disabled={capture.isPending}>
        {t('curve.capture.action')}
      </Button>
    </div>
  );
}
