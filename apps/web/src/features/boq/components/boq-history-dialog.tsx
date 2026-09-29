'use client';

import type { BoqTimelineEntry, BoqTimelineResponse } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  LtrValue,
  Notice,
  Skeleton,
  type ActivityTimelineEntry,
} from '@erp/ui';

import { formatDateTime, formatMoney } from '@/lib/format';

/**
 * The BOQ's history (R11 concept D, on demand) — a read-only `FormDialog` (ADR-039) drawing
 * `BoqTimelineResponse` with `ActivityTimeline`, newest first: the commit, each variation-adopt
 * snapshot, and notable per-line change events, in plain language with no version numbers
 * (Decision 9).
 *
 * It was a right-docked `Sheet`. The caller still mount-gates it (`{timelineOpen ? … : null}`):
 * `open` stays true for the component's life and every dismissal calls `onClose`.
 */
export function BoqHistoryDialog({
  data,
  currency,
  canViewMargin,
  isPending,
  isError,
  onClose,
}: {
  data: BoqTimelineResponse | undefined;
  currency: string;
  /** Contract-scale amounts are `canViewMargin`; line amounts are `canViewCost`. */
  canViewMargin: boolean;
  isPending: boolean;
  isError: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.timeline');
  const locale = useLocale() as 'en' | 'ar';

  const entries: ActivityTimelineEntry[] = (data?.entries ?? []).map((entry) =>
    toTimelineEntry(entry, {
      unknownActor: t('unknownActor'),
      at: formatDateTime(entry.occurredAt, locale) ?? '',
      amount: canViewMargin ? formatMoney(entry.amount, currency, locale) : null,
    }),
  );

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('heading')}
      subtitle={t('subtitle')}
      size="md"
      initialFocus="dialog"
      closeLabel={t('close')}
    >
      <FormDialogBody>
        {isPending ? (
          <div className="space-y-3" role="status" aria-label={t('loading')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <Notice tone="danger">{t('loadFailed')}</Notice>
        ) : (
          <ActivityTimeline
            label={t('heading')}
            entries={entries}
            empty={<p className="py-4 text-body-sm text-muted-foreground">{t('empty')}</p>}
          />
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button">{t('closeAction')}</Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
  );
}

/**
 * One timeline entry as an `ActivityTimeline` sentence: **Actor** label · amount.
 *
 * The server's labels are sentence-case phrases ("Committed to contract", "Absorbed internal
 * scope 2.3 …"); after a name they read as a verb phrase, so a leading capital is lowered — but
 * only on an ordinary word, never on a reference such as "VO-003".
 */
function toTimelineEntry(
  entry: BoqTimelineEntry,
  { unknownActor, at, amount }: { unknownActor: string; at: string; amount: string | null },
): ActivityTimelineEntry {
  return {
    id: entry.id,
    actor: entry.actorName ?? unknownActor,
    action: /^[A-Z][a-z]/.test(entry.label) ? entry.label[0]!.toLowerCase() + entry.label.slice(1) : entry.label,
    ...(amount ? { target: <LtrValue className="tabular-nums">{amount}</LtrValue> } : {}),
    at,
    dateTime: entry.occurredAt,
  };
}
