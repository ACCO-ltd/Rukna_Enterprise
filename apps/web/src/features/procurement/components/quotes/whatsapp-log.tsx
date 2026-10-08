'use client';

/**
 * ADR-044 phase 2 — the WhatsApp alerts sent about a quotation request, compact: who, which alert,
 * when, and how far it got ("Fadumo · 10:42 · Delivered"). The server masks numbers to the last 3
 * digits and sends no message text and no amounts. Renders nothing when there are none (alerts
 * off, nobody opted in, or a server that predates the log).
 */

import { useTranslations } from 'next-intl';
import { StatusText, type StatusTone } from '@erp/ui';
import { Check, CheckCheck, Clock, MessageCircle, TriangleAlert } from 'lucide-react';

import type { StaffAlertLogEntry } from '@erp/types';

import { formatDateTime } from '@/lib/format';

const TONE: Record<StaffAlertLogEntry['status'], StatusTone> = {
  QUEUED: 'neutral',
  UNKNOWN: 'attention',
  SENT: 'progress',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'danger',
};

function StatusIcon({ status }: { status: StaffAlertLogEntry['status'] }) {
  const cls = 'size-3.5 shrink-0';
  if (status === 'QUEUED') return <Clock className={cls} aria-hidden="true" />;
  if (status === 'SENT') return <Check className={cls} aria-hidden="true" />;
  if (status === 'DELIVERED' || status === 'READ') return <CheckCheck className={cls} aria-hidden="true" />;
  return <TriangleAlert className={cls} aria-hidden="true" />;
}

/** The time a row shows: when it got furthest (read → delivered → sent), else when it queued. */
function shownAt(m: StaffAlertLogEntry): string {
  return m.readAt ?? m.deliveredAt ?? m.sentAt ?? m.failedAt ?? m.queuedAt;
}

export function WhatsAppLog({ messages }: { messages: StaffAlertLogEntry[] | undefined }) {
  const t = useTranslations('procurement.quotes.whatsappLog');
  if (!messages || messages.length === 0) return null;
  // Newest first: the latest alert is the one a reader is usually checking.
  const rows = [...messages].reverse();
  return (
    <section aria-labelledby="quote-whatsapp-log" className="rounded-panel border border-border bg-surface p-4">
      <h2 id="quote-whatsapp-log" className="flex items-center gap-1.5 text-body-sm font-semibold text-foreground">
        <MessageCircle className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('title')}
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="min-w-0">
              <span className="text-muted-foreground">{t(`purpose.${m.purpose}`)}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-medium text-foreground">{m.recipientName}</span>
              <span className="text-caption text-muted-foreground"> {m.recipientPhoneMasked}</span>
            </span>
            <span className="flex items-center gap-2">
              <time dateTime={shownAt(m)} className="tabular-nums text-caption text-muted-foreground">
                {formatDateTime(shownAt(m))}
              </time>
              <StatusText tone={TONE[m.status]} className="inline-flex items-center gap-1 text-caption font-medium">
                {/* StatusText wraps children in a plain inline span, where a block-level svg
                    would stack above the label — keep icon and label on one line. */}
                <span className="inline-flex items-center gap-1">
                  <StatusIcon status={m.status} />
                  {t(`status.${m.status}`)}
                </span>
              </StatusText>
            </span>
            {m.failureReason && (m.status === 'FAILED' || m.status === 'UNKNOWN' || m.status === 'QUEUED') ? (
              <span className="basis-full text-caption text-muted-foreground">{m.failureReason}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
