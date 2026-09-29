'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Notice } from '@erp/ui';
import { X } from 'lucide-react';
import type { GuideCycleKey } from '@erp/types';

import { findCycle, useAccountingGuide } from '@/features/finance/hooks/use-accounting-guide';
import { isStepQuiet } from '../guide/guide-status';
import { dismissGuideHint, useGuideHintDismissed } from '../guide/hint-dismissal';

/**
 * A lightweight, dismissible callout that surfaces one guide step on the screen that performs it
 * — "3 invoices need action", "This is your next step". Reads the shared guide data and renders
 * nothing when the step is finished (DONE/NA), unknown, or already dismissed this browser.
 *
 * A hint is guidance, not a blocker: it never gates the screen and it disappears the moment the
 * work is done, so it cannot become stale nagging. Dismissal is per screen, kept in localStorage.
 *
 * `stepKey` may name several candidates (e.g. a periods screen where the relevant next step
 * progresses lock → close): the first one that is live and actionable here wins, so the hint
 * follows the sequence without the caller re-wiring it.
 */
export function GuideHint({
  cycleKey,
  stepKey,
}: {
  cycleKey: GuideCycleKey;
  stepKey: string | string[];
}) {
  const t = useTranslations('accounting.guide');
  const guide = useAccountingGuide();

  const keys = Array.isArray(stepKey) ? stepKey : [stepKey];
  const dismissId = `${cycleKey}:${keys.join(',')}`;
  const dismissed = useGuideHintDismissed(dismissId);

  const cycle = findCycle(guide.data, cycleKey);
  // A step is worth a hint only when it is actionable on this screen: not quiet, not restricted,
  // and it carries a link. The hub already explains who does the restricted ones.
  const step = keys
    .map((k) => cycle?.steps.find((s) => s.key === k))
    .find((s) => s && !isStepQuiet(s.status) && s.status !== 'RESTRICTED' && s.href !== null);

  if (!step || !step.href) return null;
  if (dismissed) return null;

  const isAttention = step.status === 'ATTENTION';
  const message = isAttention ? t('hint.attention', { count: step.count ?? 0 }) : t('hint.next');

  return (
    <Notice
      tone={isAttention ? 'attention' : 'info'}
      className="mb-4"
      action={
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link href={step.href}>{step.label}</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => dismissGuideHint(dismissId)}
            aria-label={t('hint.dismiss')}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      }
    >
      {message} {step.detail}
    </Notice>
  );
}
