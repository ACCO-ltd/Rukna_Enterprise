'use client';

import type { CommercialActivityItem } from '@erp/types';
import { ActivityTimeline, type ActivityTimelineEntry } from '@erp/ui';
import { useLocale, useTranslations } from 'next-intl';

import { formatDateTime } from '@/lib/format';

import { SectionCard } from './commercial-ui';

/**
 * Recent commercial activity, on the shared `ActivityTimeline`: an initials avatar, one sentence
 * — **who** did what — and the time underneath ("22 Sep 2026, 11:40").
 *
 * An audit trail, not a social feed. On a contract worth twelve million the question this
 * answers is "who certified that, and when", which is an evidence question.
 *
 * The event text comes from `sourceCommand` where the backend recorded one (`contract.execute`,
 * `ipc.issue`) because that names the business command rather than the CRUD verb; `action`
 * is the fallback.
 */
export function CommercialActivity({ items }: { items: CommercialActivityItem[] }) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';

  /**
   * The verb phrase for the event. `sourceCommand` values are dotted business commands;
   * where a translation exists it wins, otherwise the raw command is shown rather than an
   * invented phrase — a made-up description of an audited event is the wrong thing to record.
   * `t.has` is used so an untranslated command degrades gracefully instead of emitting a
   * MISSING_MESSAGE console error.
   */
  const describe = (event: CommercialActivityItem): string => {
    const key = event.sourceCommand ?? event.action;
    return t.has(`activity.${key}`) ? t(`activity.${key}`) : key;
  };

  const entries: ActivityTimelineEntry[] = items.map((event) => ({
    id: event.id,
    actor: event.actor.name,
    action: describe(event),
    at: formatDateTime(event.occurredAt, locale) ?? '',
    dateTime: event.occurredAt,
  }));

  return (
    <SectionCard title={t('overview.recentActivity')} bodyClassName="px-4 py-4 sm:px-5">
      <ActivityTimeline
        label={t('overview.recentActivity')}
        entries={entries}
        empty={<p className="text-body-sm text-muted-foreground">{t('overview.noActivity')}</p>}
      />
    </SectionCard>
  );
}
