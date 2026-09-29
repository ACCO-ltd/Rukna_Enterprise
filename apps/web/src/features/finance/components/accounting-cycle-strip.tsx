'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { StatusText, cn } from '@erp/ui';
import { ArrowUpRight } from 'lucide-react';

import { statusTone } from '@/lib/status-registry';

import { awaitingCount, useAccountingGuide } from '../hooks/use-accounting-guide';

const GUIDE_HREF = '/finance/accounting/guide';

/**
 * The slim status strip shown across every accounting screen: the current fiscal period and its
 * status, and how many items across the daily cycle are waiting on the user. Compact and
 * non-intrusive — one line, no actions except a quiet link back to the guide.
 *
 * Renders nothing on the guide hub (redundant there) and nothing while the guide is unknown or
 * the reader cannot view accounting (the hook stays idle). It is honest about a missing period:
 * "No open period" reads differently from a clear queue.
 */
export function AccountingCycleStrip() {
  const t = useTranslations('accounting.guide.strip');
  const pathname = usePathname();
  const guide = useAccountingGuide();

  // The hub already is the guidance; a strip above it would repeat the same period and count.
  if (pathname === GUIDE_HREF) return null;
  if (!guide.data) return null;

  const { currentPeriod } = guide.data;
  const awaiting = awaitingCount(guide.data);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-panel border border-border bg-surface-subtle px-4 py-2 text-body-sm">
      <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {t('label')}
      </span>

      {currentPeriod ? (
        <StatusText tone={statusTone(currentPeriod.status, 'fiscalPeriod')} axis={t('period')}>
          {currentPeriod.name}
        </StatusText>
      ) : (
        <StatusText tone="attention">{t('noPeriod')}</StatusText>
      )}

      <span
        className={cn(
          'inline-flex items-center gap-1.5',
          awaiting > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {awaiting > 0 ? t('awaiting', { count: awaiting }) : t('clear')}
      </span>

      <Link
        href={GUIDE_HREF}
        className="ms-auto inline-flex items-center gap-1 text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        {t('openGuide')}
        <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
