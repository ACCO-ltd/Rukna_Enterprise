'use client';

import { useRef, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Notice,
  Select,
  SkeletonRecord,
  useToast,
} from '@erp/ui';
import type {
  OutboundMessageView,
  WhatsAppSendRequest,
  WhatsAppSendBlockedReason,
  WhatsAppSendPreview,
} from '@erp/types';
import { FileText, MessageCircle } from 'lucide-react';

import { PhoneInput } from '@/components/phone-input';
import { ApiError } from '@/lib/api-client';
import { EMPTY_PHONE, formatPhone, isPhoneEmpty, toE164, type PhoneValue } from '@/lib/phone';

import { isReached } from '../message-status';

/** The "Another number" choice in the To list. */
const OTHER = '__other__';

/** Hard blocks: nothing the user can do in this dialog. NO_RECIPIENT is soft (type a number). */
const HARD_BLOCKS: ReadonlySet<WhatsAppSendBlockedReason> = new Set([
  'NOT_POSTED',
  'REVERSED',
  'NOTHING_OUTSTANDING',
  'WHATSAPP_NOT_CONFIGURED',
  'TEMPLATE_NOT_CONFIGURED',
]);

export interface WhatsAppSendDialogProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Send invoice on WhatsApp". */
  title: string;
  /** e.g. "Invoice INV-000042 goes to the client as a PDF." */
  subtitle?: string;
  /** Cache key for the preview — stable per record, e.g. ['whatsapp-preview', 'invoice', id]. */
  previewQueryKey: QueryKey;
  /** Loads what would be sent: recipients, filled message, attachment, blockers. */
  loadPreview: () => Promise<WhatsAppSendPreview>;
  /** Sends; resolves with the message (also when WhatsApp refused it: FAILED / UNKNOWN). */
  send: (body: WhatsAppSendRequest) => Promise<OutboundMessageView>;
  /** After every send that came back with a message (refresh the record and its history). */
  onSent?: (message: OutboundMessageView) => void;
  /**
   * More records sent in the same go, after the main one — e.g. the other invoices of a billing
   * package. Each goes as its own message with its own attachment, one after another, with an
   * idempotency key derived from the dialog's key and the item's `key`; the outcome shows per item.
   */
  extraItems?: WhatsAppSendItem[];
  /** Record-specific wording for a blocker, e.g. NOT_POSTED → "Issue the invoice first." */
  blockedText?: Partial<Record<WhatsAppSendBlockedReason, string>>;
}

/** One more record to send with the main one (see `extraItems`). */
export interface WhatsAppSendItem {
  /** Stable per record (e.g. the invoice id). */
  key: string;
  /** What is attached, e.g. "INV-000043.pdf". */
  label: string;
  send: (body: WhatsAppSendRequest) => Promise<OutboundMessageView>;
}

interface ItemResult {
  message?: OutboundMessageView;
  error?: string;
}

const MAIN = '__main__';

function isUnsettled(message: OutboundMessageView | undefined): boolean {
  return message?.status === 'UNKNOWN' || message?.status === 'QUEUED';
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Send a record (invoice today; receipts and reminders next) to the client on WhatsApp through
 * Rukna (ADR-042). Shows who it goes to, the approved message as the client will read it, and the
 * attachment; the user only picks the number.
 *
 * One idempotency key per opening of the dialog: a double click, or a retry after WhatsApp refused
 * the message, can never send it twice. A blocked send is explained in words, with no Send button.
 *
 * A `FormDialog` (ADR-039), size `md`.
 */
export function WhatsAppSendDialog(props: WhatsAppSendDialogProps) {
  // Remount per opening so every opening starts clean, with a fresh idempotency key.
  return props.open ? <WhatsAppSendDialogBody {...props} /> : null;
}

function WhatsAppSendDialogBody({
  onClose,
  title,
  subtitle,
  previewQueryKey,
  loadPreview,
  send,
  onSent,
  extraItems,
  blockedText,
}: WhatsAppSendDialogProps) {
  const t = useTranslations('common.messaging.whatsapp');
  const { toast } = useToast();
  const preview = useQuery({ queryKey: previewQueryKey, queryFn: loadPreview, staleTime: 0 });

  const idempotencyKey = useRef(newKey());
  const inFlight = useRef(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState<PhoneValue>(EMPTY_PHONE);
  const [otherTouched, setOtherTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Record<string, ItemResult>>({});

  const data = preview.data;
  // Until the user picks, To is the default recipient, else "Another number".
  const selected = choice ?? data?.defaultRecipient ?? OTHER;

  // The server reports one reason, NO_RECIPIENT before the set-up checks; a typed number does not
  // fix a missing template or connection, so those are read from the flags too.
  const hardBlock: WhatsAppSendBlockedReason | null = !data
    ? null
    : data.blockedReason && HARD_BLOCKS.has(data.blockedReason)
      ? data.blockedReason
      : !data.templateConfigured
        ? 'TEMPLATE_NOT_CONFIGURED'
        : !data.whatsappConfigured
          ? 'WHATSAPP_NOT_CONFIGURED'
          : null;
  const usingOther = selected === OTHER;
  const otherNumber = usingOther ? toE164(other) : null;
  const otherError =
    usingOther && otherTouched && !isPhoneEmpty(other) && !otherNumber
      ? t('otherNumberInvalid')
      : undefined;
  const recipient = usingOther ? otherNumber : selected;

  const items: WhatsAppSendItem[] = [
    { key: MAIN, label: data?.filename ?? '', send },
    ...(extraItems ?? []),
  ];
  const multi = items.length > 1;
  // A text-only message (a reminder) has no attachment to list.
  const textOnly = Boolean(data) && !data?.filename && !multi;
  // Settled = WhatsApp took it (reached) or may have (unknown): never sent again from here.
  const isDone = (key: string) => {
    const m = results[key]?.message;
    return Boolean(m && (isReached(m.status) || isUnsettled(m)));
  };
  const remaining = items.filter((item) => !isDone(item.key));
  const outcome = results[MAIN]?.message;
  const error = results[MAIN]?.error ?? null;
  const anyUnsettled = items.some((item) => isUnsettled(results[item.key]?.message));
  const finished = remaining.length === 0;
  const retrying = items.some(
    (item) => results[item.key]?.error || results[item.key]?.message?.status === 'FAILED',
  );
  const canSend = Boolean(data) && !hardBlock && Boolean(recipient) && !finished;

  async function submit() {
    if (!canSend || !recipient || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const next: Record<string, ItemResult> = { ...results };
    try {
      for (const item of remaining) {
        const key =
          item.key === MAIN ? idempotencyKey.current : `${idempotencyKey.current}:${item.key}`;
        try {
          const message = await item.send({ recipient, idempotencyKey: key });
          next[item.key] = { message };
          onSent?.(message);
        } catch (err) {
          next[item.key] = {
            error: err instanceof Error && err.message ? err.message : t('sendFailed'),
          };
          // A bad number fails every item the same way: stop and let the user fix it.
          if (err instanceof ApiError && err.code === 'RECIPIENT_INVALID') {
            if (usingOther) setOtherTouched(true);
            break;
          }
        }
      }
      setResults(next);
      const allReached = items.every((item) => {
        const m = next[item.key]?.message;
        return Boolean(m && isReached(m.status));
      });
      if (allReached) {
        const number = formatPhone(recipient) ?? recipient;
        toast({
          title: multi
            ? t('sentManyToast', { count: items.length, number })
            : t('sentToast', { number }),
          tone: 'success',
        });
        onClose();
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const clearErrors = () =>
    setResults((current) =>
      Object.fromEntries(Object.entries(current).filter(([, r]) => !r.error)),
    );
  const failed = outcome?.status === 'FAILED' ? outcome : null;
  const unsettled = finished && anyUnsettled;
  const dirty = Object.keys(results).length === 0 && (usingOther ? !isPhoneEmpty(other) : false);

  return (
    <FormDialog
      open
      onOpenChange={(next) => (!next && !pending ? onClose() : undefined)}
      title={title}
      subtitle={subtitle}
      icon={<MessageCircle size={18} aria-hidden="true" />}
      size="md"
      dirty={dirty}
      busy={pending}
      onSubmit={() => void submit()}
    >
      <FormDialogBody>
        {preview.isPending ? <SkeletonRecord label={t('loading')} /> : null}
        {preview.isError ? (
          <Alert
            variant="error"
            messages={[
              preview.error instanceof Error && preview.error.message
                ? preview.error.message
                : t('loadFailed'),
            ]}
          />
        ) : null}

        {error ? <Alert variant="error" messages={[error]} /> : null}

        {failed ? (
          <Alert
            variant="error"
            title={t('failedTitle')}
            messages={[failed.errorMessage ?? t('failedFallback')]}
          />
        ) : null}

        {anyUnsettled ? (
          <Notice tone="attention" title={t('unknownTitle')}>
            {t('unknownBody')}
          </Notice>
        ) : null}

        {multi && Object.keys(results).length > 0 ? (
          <ul aria-label={t('results')} className="space-y-1.5 text-body-sm">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="text-muted-foreground">{itemState(results[item.key], t)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {hardBlock ? (
          <Notice tone="attention" title={t('blockedTitle')}>
            {blockedText?.[hardBlock] ?? t(`blocked.${hardBlock}`)}
          </Notice>
        ) : null}

        {data && !hardBlock && !unsettled ? (
          <>
            {data.blockedReason === 'NO_RECIPIENT' ? (
              <p className="text-body-sm text-muted-foreground">
                {blockedText?.NO_RECIPIENT ?? t('blocked.NO_RECIPIENT')}
              </p>
            ) : null}

            {data.recipients.length > 0 ? (
              <FormField htmlFor="wa-to" label={t('to')}>
                <Select
                  id="wa-to"
                  value={selected}
                  onChange={(value) => {
                    if (!value) return;
                    setChoice(value);
                    clearErrors();
                  }}
                  disabled={pending}
                >
                  {data.recipients.map((r) => (
                    <option key={`${r.contactId}-${r.number}`} value={r.number}>
                      {recipientLabel(r, t)}
                    </option>
                  ))}
                  <option value={OTHER}>{t('otherNumber')}</option>
                </Select>
              </FormField>
            ) : null}

            {usingOther ? (
              <FormField htmlFor="wa-other" label={t('otherNumberLabel')} error={otherError}>
                <PhoneInput
                  id="wa-other"
                  value={other}
                  onChange={(next) => {
                    setOther(next);
                    clearErrors();
                  }}
                  onBlur={() => setOtherTouched(true)}
                  invalid={Boolean(otherError)}
                  disabled={pending}
                />
              </FormField>
            ) : null}

            <div className="space-y-1.5">
              <p className="text-body-sm font-medium text-foreground">{t('message')}</p>
              <p
                className="whitespace-pre-line rounded-control border border-border bg-muted/40 p-3 text-body-sm text-foreground"
                aria-label={t('message')}
              >
                {data.message}
              </p>
              <p className="text-caption text-muted-foreground">
                {textOnly ? t('messageHintTextOnly') : t('messageHint')}
              </p>
            </div>

            {textOnly ? null : (
              <div className="space-y-1.5 text-body-sm">
                <span className="text-muted-foreground">
                  {multi ? t('attachmentsMany', { count: items.length }) : t('attachment')}
                </span>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.key}
                      className="flex min-w-0 items-center gap-1.5 font-medium text-foreground"
                    >
                      <FileText size={16} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {hardBlock || unsettled ? t('close') : t('cancel')}
          </Button>
        </FormDialogClose>
        {data && !hardBlock && !unsettled ? (
          <Button type="submit" loading={pending} loadingText={t('sending')} disabled={!canSend}>
            <MessageCircle size={16} aria-hidden="true" />
            {failed || retrying ? t('tryAgain') : t('send')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}

function itemState(
  r: ItemResult | undefined,
  t: ReturnType<typeof useTranslations<'common.messaging.whatsapp'>>,
): string {
  if (!r) return t('itemState.notSent');
  if (r.error) return r.error;
  if (r.message && isReached(r.message.status)) return t('itemState.sent');
  if (r.message?.status === 'FAILED') return r.message.errorMessage ?? t('failedFallback');
  return t('itemState.unknown');
}

function recipientLabel(
  r: WhatsAppSendPreview['recipients'][number],
  t: ReturnType<typeof useTranslations<'common.messaging.whatsapp'>>,
): string {
  const number = formatPhone(r.number) ?? r.number;
  const base = r.role
    ? t('recipientOptionRole', { name: r.name, role: r.role, number })
    : t('recipientOption', { name: r.name, number });
  return r.isPrimary ? `${base} · ${t('primary')}` : base;
}
