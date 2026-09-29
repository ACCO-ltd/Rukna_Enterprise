'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAccountingGuide } from '@/features/finance/hooks/use-accounting-guide';

const GUIDE_HREF = '/finance/accounting/guide';
const READY_HREF = '/finance/accounting/journals';

/**
 * The accounting module's landing decision (flow plan).
 *
 * While setup is incomplete (`ready === false`) the module lands on the "Get started" hub, so a
 * new tenant is guided rather than dropped onto an empty journal list. Once the ledger can post
 * (`ready === true`) it lands on the daily workspace — the hub stays reachable from the nav and
 * the cycle strip, never a modal or a wall in front of an experienced user.
 *
 * The choice needs the live guide, which is a client read gated on `view:accounting`, so this
 * runs on the client and shows a brief loading frame first. It replaces (not pushes) the history
 * entry so Back does not bounce the user through this decider.
 */
export function AccountingLanding() {
  const t = useTranslations('accounting.guide');
  const router = useRouter();
  const guide = useAccountingGuide();

  useEffect(() => {
    if (guide.data) {
      router.replace(guide.data.ready ? READY_HREF : GUIDE_HREF);
    } else if (guide.isError) {
      // Guidance is unavailable — do not strand the user; the daily workspace is the safe default.
      router.replace(READY_HREF);
    }
  }, [guide.data, guide.isError, router]);

  return (
    <div role="status" aria-live="polite" className="w-full max-w-4xl space-y-4">
      <span className="sr-only">{t('title')}</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
