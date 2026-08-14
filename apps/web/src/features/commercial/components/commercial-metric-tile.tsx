'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { StatTile } from '@erp/ui';
import type { CommercialMetric } from '@erp/types';

import { formatMoney } from '@/lib/format';
import { metricDisplay } from '../presentation';

/**
 * A single commercial figure. Renders the server's metric state faithfully: a genuine zero
 * shows `0.00`; restricted / unavailable / failed show an em-dash with a reason, never a 0.
 * When the metric carries a `drillTo`, the tile becomes a link to the breakdown.
 */
export function CommercialMetricTile({
  label,
  metric,
}: {
  label: string;
  metric: CommercialMetric;
}) {
  const t = useTranslations('commercial.metricState');
  const locale = useLocale() as 'en' | 'ar';
  const display = metricDisplay(metric);

  if (display.kind === 'value') {
    return (
      <StatTile
        label={label}
        value={formatMoney(display.amount, display.currency, locale) ?? '—'}
        unit={display.currency ?? undefined}
        {...(metric.drillTo
          ? {
              href: metric.drillTo,
              renderLink: ({ href, className, children }) => (
                <Link href={href} className={className}>
                  {children}
                </Link>
              ),
            }
          : {})}
      />
    );
  }

  return <StatTile label={label} value={null} unavailableReason={t(display.reasonKey)} />;
}
