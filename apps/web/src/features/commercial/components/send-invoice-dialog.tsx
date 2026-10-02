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

import { recordPackageDelivery } from '../api/commercial-api';
import { commercialInvoiceKeys } from '../hooks/use-commercial-invoice';

type DeliveryMethod = 'WHATSAPP' | 'EMAIL' | 'PHYSICAL' | 'OTHER';

export interface SendInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Delivery is recorded per billing package, which is keyed by its installment. */
  installmentId: string;
  invoiceNumber: string | null;
  onSent?: () => void;
  /**
   * WhatsApp is sent through Rukna (ADR-042), not recorded by hand: choosing it hands over to the
   * "Send on WhatsApp" dialog. Without this, the WhatsApp option is not offered.
   */
  onChooseWhatsApp?: () => void;
}

/**
 * Record that an issued invoice reached the client (decision D9: a Dialog, not a sheet).
 *
 * The invoice is already numbered and posted; this only records how it was delivered, via
 * `POST …/installments/:installmentId/package-deliveries`, which stamps every invoice of the
 * stage's package. WhatsApp is different: Rukna sends the PDF itself and records the delivery
 * when WhatsApp accepts it, so choosing WhatsApp hands over to the Send on WhatsApp dialog.
 *
 * A `FormDialog` (ADR-039), size `md`.
 */
export function SendInvoiceDialog({
  open,
  onClose,
  projectId,
  installmentId,
  invoiceNumber,
  onSent,
  onChooseWhatsApp,
}: SendInvoiceDialogProps) {
  const t = useTranslations('commercial.send');
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<DeliveryMethod | ''>('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMethod('');
    setRecipient('');
    setNote('');
    setError(null);
    setPending(false);
  }

  function close() {
    if (pending) return;
    reset();
    onClose();
  }

  function continueToWhatsApp() {
    reset();
    onClose();
    onChooseWhatsApp?.();
  }

  async function markSent() {
    if (!method || method === 'WHATSAPP') return;
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
    ...(onChooseWhatsApp
      ? [
          {
            value: 'WHATSAPP' as const,
            label: (
              <IconLabel icon={<MessageCircle size={16} aria-hidden="true" />}>
                {t('method.WHATSAPP')}
              </IconLabel>
            ),
          },
        ]
      : []),
    {
      value: 'EMAIL',
      label: (
        <IconLabel icon={<Mail size={16} aria-hidden="true" />}>{t('method.EMAIL')}</IconLabel>
      ),
    },
    {
      value: 'PHYSICAL',
      label: (
        <IconLabel icon={<Printer size={16} aria-hidden="true" />}>
          {t('method.PHYSICAL')}
        </IconLabel>
      ),
    },
    {
      value: 'OTHER',
      label: (
        <IconLabel icon={<MoreHorizontal size={16} aria-hidden="true" />}>
          {t('method.OTHER')}
        </IconLabel>
      ),
    },
  ];

  const dirty = method !== '' || recipient !== '' || note !== '';
  const whatsapp = method === 'WHATSAPP';

  const recipientLabel = method ? t(`recipientLabel.${method}`) : t('recipientLabel.OTHER');

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (!next ? close() : undefined)}
      title={t('title')}
      subtitle={
        invoiceNumber ? t('description', { number: invoiceNumber }) : t('descriptionNoNumber')
      }
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

        {whatsapp ? (
          <p className="text-body-sm text-muted-foreground">{t('whatsappHint')}</p>
        ) : (
          <>
            <FormField htmlFor="send-recipient" label={recipientLabel}>
              <Input
                id="send-recipient"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
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
          </>
        )}
        {!method ? <p className="text-caption text-muted-foreground">{t('chooseMethod')}</p> : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        {whatsapp ? (
          <Button type="button" onClick={continueToWhatsApp}>
            <MessageCircle size={16} aria-hidden="true" />
            {t('continueWhatsApp')}
          </Button>
        ) : method ? (
          <Button type="button" onClick={markSent} loading={pending} loadingText={t('saving')}>
            {t('markSent')}
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
