'use client';

import type { CommercialActivityItem } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';

import { relativeTime } from '@/lib/format';

import { SectionCard } from './commercial-ui';

/**
 * Recent commercial activity.
 *
 * An audit trail, not a social feed. Each row says who did what to which record and when —
 * no avatars beyond an initial, no verbs like "shared", no engagement furniture. On a
 * contract worth twelve million the question this answers is "who certified that, and when",
 * which is an evidence question.
 *
 * The event text comes from `sourceCommand` where the backend recorded one (`contract.execute`,
 * `ipc.issue`) because that names the business command rather than the CRUD verb; `action`
 * is the fallback.
 */
export function CommercialActivity({ items }: { items: CommercialActivityItem[] }) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <SectionCard title={t('overview.recentActivity')} bodyClassName="px-0 py-0">
      {items.length === 0 ? (
        <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">
          {t('overview.noActivity')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-micro font-semibold uppercase text-muted-foreground"
              >
                {initial(event.actor.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-foreground">
                  <span className="font-medium">{event.actor.name}</span>{' '}
                  <span className="text-muted-foreground">
                    {describe(event, t as (key: string) => string)}
                  </span>
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {relativeTime(event.occurredAt, locale)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * A readable sentence for the event.
 *
 * `sourceCommand` values are dotted business commands. Where a translation exists it wins;
 * otherwise the raw command is shown rather than an invented phrase — a made-up description
 * of an audited event is exactly the wrong thing to put in an audit trail.
 */
function describe(event: CommercialActivityItem, t: (key: string) => string): string {
  const key = event.sourceCommand ?? event.action;
  const translated = t(`activity.${key}`);
  return translated === `commercial.activity.${key}` ? key : translated;
}

function initial(name: string): string {
  return name.trim().charAt(0) || '?';
}
