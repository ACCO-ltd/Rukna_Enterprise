'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  RadioGroup,
  Textarea,
  type RadioOption,
} from '@erp/ui';
import { Mail, MessageCircle, MoreHorizontal, Printer } from 'lucide-react';

import { getIssuedInvoiceDocument, recordPackageDelivery } from '../api/commercial-api';
import { commercialInvoiceKeys } from '../hooks/use-commercial-invoice';

type DeliveryMethod = 'WHATSAPP' | 'EMAIL' | 'PHYSICAL' | 'OTHER';

export interface SendInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Delivery is recorded per billing package, which is keyed by its installment. */
  installmentId: string;
  /** The invoice the dialog was opened from — its PDF link goes into a WhatsApp message. */
  invoiceId: string;
  invoiceNumber: string | null;
  onSent?: () => void;
}

/**
 * Record that an issued invoice reached the client (decision D9: a Dialog, not a sheet).
 *
 * The invoice is already numbered and posted; this only records how it was delivered, via
 * `POST …/installments/:installmentId/package-deliveries`, which stamps every invoice of the
 * stage's package. For WhatsApp the dialog can also open a chat with the PDF link — the user
 * still confirms the send, because opening a chat is not proof it was sent.
 *
 * A `FormDialog` (ADR-039), size `md`.
 */
export function SendInvoiceDialog({
  open,
  onClose,
  projectId,
  installmentId,
  invoiceId,
  invoiceNumber,
  onSent,
}: SendInvoiceDialogProps) {
  const t = useTranslations('commercial.send');
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<DeliveryMethod | ''>('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMethod('');
    setRecipient('');
    setNote('');
    setError(null);
    setPending(false);
    setOpening(false);
  }

  function close() {
    if (pending) return;
    reset();
    onClose();
  }

  const phone = recipient.replace(/[^0-9]/g, '');
  const canOpenWhatsApp = method === 'WHATSAPP' && phone.length >= 7 && !opening;

  async function openWhatsApp() {
    if (!canOpenWhatsApp) return;
    // Opened synchronously so the browser treats it as the user's click, then pointed at the
    // chat once the short-lived PDF link is back.
    const popup = window.open('', '_blank');
    setOpening(true);
    setError(null);
    try {
      const { url } = await getIssuedInvoiceDocument(invoiceId);
      const text = t('whatsappMessage', { number: invoiceNumber ?? '', url });
      const href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      if (popup) {
        popup.opener = null;
        popup.location.href = href;
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      popup?.close();
      setError(err instanceof Error && err.message ? err.message : t('whatsappFailed'));
    } finally {
      setOpening(false);
    }
  }

  async function markSent() {
    if (!method) return;
    setPending(true);
    setError(null);
    try {
      await recordPackageDelivery(projectId, installmentId, {
        method,
        sentAt: new Date().toISOString(),
        recipient: recipient.trim() || undefined,
        note: note.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: commercialInvoiceKeys.all(projectId) });
      setPending(false);
      reset();
      onSent?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('failed'));
      setPending(false);
    }
  }

  const options: RadioOption<DeliveryMethod>[] = [
    { value: 'WHATSAPP', label: <IconLabel icon={<MessageCircle size={16} aria-hidden="true" />}>{t('method.WHATSAPP')}</IconLabel> },
    { value: 'EMAIL', label: <IconLabel icon={<Mail size={16} aria-hidden="true" />}>{t('method.EMAIL')}</IconLabel> },
    { value: 'PHYSICAL', label: <IconLabel icon={<Printer size={16} aria-hidden="true" />}>{t('method.PHYSICAL')}</IconLabel> },
    { value: 'OTHER', label: <IconLabel icon={<MoreHorizontal size={16} aria-hidden="true" />}>{t('method.OTHER')}</IconLabel> },
  ];

  const dirty = method !== '' || recipient !== '' || note !== '';

  const recipientLabel = method ? t(`recipientLabel.${method}`) : t('recipientLabel.OTHER');

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (!next ? close() : undefined)}
      title={t('title')}
      subtitle={invoiceNumber ? t('description', { number: invoiceNumber }) : t('descriptionNoNumber')}
      size="md"
      dirty={dirty}
      busy={pending}
    >
      <FormDialogBody>
        {error ? <Alert variant="error" messages={[error]} /> : null}

        <RadioGroup
          label={t('methodLabel')}
          name="send-method"
          value={method}
          onChange={(value) => setMethod(value)}
          options={options}
          variant="card"
          compact
          required
        />

        <FormField htmlFor="send-recipient" label={recipientLabel}>
          <Input
            id="send-recipient"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={method === 'WHATSAPP' ? t('whatsappPlaceholder') : undefined}
            inputMode={method === 'WHATSAPP' ? 'tel' : undefined}
            disabled={pending}
          />
        </FormField>

        <FormField htmlFor="send-note" label={t('note')}>
          <Textarea
            id="send-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={pending}
          />
        </FormField>

        {method === 'WHATSAPP' ? (
          <div className="space-y-2">
            <p className="text-body-sm text-muted-foreground">{t('whatsappHint')}</p>
            {canOpenWhatsApp || opening ? (
              <Button type="button" variant="outline" onClick={openWhatsApp} disabled={opening}>
                <MessageCircle size={16} aria-hidden="true" />
                {opening ? t('opening') : t('openWhatsApp')}
              </Button>
            ) : (
              <p className="text-caption text-muted-foreground">{t('whatsappNeedsNumber')}</p>
            )}
          </div>
        ) : null}
        {!method ? <p className="text-caption text-muted-foreground">{t('chooseMethod')}</p> : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        {method ? (
          <Button type="button" onClick={markSent} disabled={pending}>
            {pending ? t('saving') : t('markSent')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}

function IconLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      {children}
    </span>
  );
}
