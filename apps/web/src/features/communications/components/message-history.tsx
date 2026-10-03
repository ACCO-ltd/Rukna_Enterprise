'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, StatusPill, useToast } from '@erp/ui';
import type { OutboundMessageView } from '@erp/types';

import { formatDateTime } from '@/lib/format';
import { formatPhone } from '@/lib/phone';

import type { CommunicationResourceType } from '../api';
import { useCommunications, useCommunicationsFor, useResolveCommunication } from '../hooks';
import { MESSAGE_STATUS_TONE, statusTime } from '../message-status';

export interface MessageHistoryProps {
  /** One kind of record, or several kept for the same id (an invoice: sends + reminders). */
  resourceType: CommunicationResourceType | readonly CommunicationResourceType[];
  resourceId: string;
  /** May the viewer settle an UNKNOWN message (manage:receivable)? */
  canResolve: boolean;
  /** Other queries to refresh after a resolve (the record, which may become Sent). */
  invalidateOnResolve?: ReadonlyArray<readonly unknown[]>;
  /** Hidden while there is nothing to show (e.g. a record never sent). Defaults to showing the empty line. */
  hideWhenEmpty?: boolean;
  /** Off when the surrounding panel already says "Messages". */
  showTitle?: boolean;
}

/**
 * "Messages" — what Rukna sent the client about this record and how far each got (ADR-042):
 * Sending → Sent → Delivered → Read, or Failed / Unknown. New ticks appear while the list is open
 * (polled for a few minutes after a send). An Unknown message — WhatsApp never confirmed it —
 * offers "Mark as sent" / "Mark as not sent" once the user has checked with the client.
 */
export function MessageHistory({ resourceType, ...rest }: MessageHistoryProps) {
  return typeof resourceType === 'string' ? (
    <SingleHistory resourceType={resourceType} {...rest} />
  ) : (
    <MergedHistory resourceTypes={resourceType} {...rest} />
  );
}

type HistoryViewProps = Omit<MessageHistoryProps, 'resourceType'>;

function SingleHistory({
  resourceType,
  ...rest
}: HistoryViewProps & { resourceType: CommunicationResourceType }) {
  const messages = useCommunications(resourceType, rest.resourceId);
  return <HistoryList messages={messages} showPurpose={false} {...rest} />;
}

/** Several kinds kept for the same record (an invoice: sends + reminders), merged newest first. */
function MergedHistory({
  resourceTypes,
  ...rest
}: HistoryViewProps & { resourceTypes: readonly CommunicationResourceType[] }) {
  const messages = useCommunicationsFor(resourceTypes, rest.resourceId);
  // Listed together, each row says what it was (Invoice / Payment reminder …).
  return <HistoryList messages={messages} showPurpose={resourceTypes.length > 1} {...rest} />;
}

function HistoryList({
  messages,
  showPurpose,
  canResolve,
  invalidateOnResolve,
  hideWhenEmpty = false,
  showTitle = true,
}: HistoryViewProps & {
  messages: { isPending: boolean; isError: boolean; data?: OutboundMessageView[] };
  showPurpose: boolean;
}) {
  const t = useTranslations('common.messaging.history');

  if (messages.isPending) return null;
  if (messages.isError || !messages.data) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }
  const data = messages.data;
  if (hideWhenEmpty && data.length === 0) return null;

  return (
    <section aria-label={t('title')} className="space-y-3">
      {showTitle ? (
        <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
      ) : null}
      {data.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-panel border border-border">
          {data.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              canResolve={canResolve}
              invalidateOnResolve={invalidateOnResolve}
              showPurpose={showPurpose}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MessageRow({
  message,
  canResolve,
  invalidateOnResolve,
  showPurpose = false,
}: {
  message: OutboundMessageView;
  canResolve: boolean;
  invalidateOnResolve?: ReadonlyArray<readonly unknown[]>;
  showPurpose?: boolean;
}) {
  const t = useTranslations('common.messaging.history');
  const locale = useLocale() as 'en';
  const { toast } = useToast();
  const resolve = useResolveCommunication(invalidateOnResolve);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<'SENT' | 'FAILED' | null>(null);

  function settle(outcome: 'SENT' | 'FAILED') {
    if (resolve.isPending) return;
    setChoice(outcome);
    setError(null);
    resolve.mutate(
      { id: message.id, body: { outcome } },
      {
        onSuccess: () =>
          toast({
            title: outcome === 'SENT' ? t('resolvedSent') : t('resolvedFailed'),
            tone: 'success',
          }),
        onError: (err) =>
          setError(err instanceof Error && err.message ? err.message : t('resolveFailed')),
      },
    );
  }

  const number = formatPhone(message.recipient) ?? message.recipient;
  const showError = message.status === 'FAILED' && message.errorMessage;

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-sm text-foreground">
            {showPurpose ? (
              <span className="font-medium">{t(`purpose.${message.purpose}`)} · </span>
            ) : null}
            {t('via', { number })}
          </p>
          <p className="text-caption text-muted-foreground">
            {formatDateTime(statusTime(message), locale)}
          </p>
        </div>
        <StatusPill tone={MESSAGE_STATUS_TONE[message.status]}>
          {t(`status.${message.status}`)}
        </StatusPill>
      </div>
      {showError ? <p className="text-caption text-danger">{message.errorMessage}</p> : null}
      {message.status === 'UNKNOWN' ? (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">{t('unknownHint')}</p>
          {canResolve ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={resolve.isPending && choice === 'SENT'}
                disabled={resolve.isPending}
                onClick={() => settle('SENT')}
              >
                {t('markSent')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={resolve.isPending && choice === 'FAILED'}
                disabled={resolve.isPending}
                onClick={() => settle('FAILED')}
              >
                {t('markFailed')}
              </Button>
            </div>
          ) : null}
          {error ? <Alert variant="error" messages={[error]} /> : null}
        </div>
      ) : null}
    </li>
  );
}
