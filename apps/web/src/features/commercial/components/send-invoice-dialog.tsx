'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  RadioGroup,
  Textarea,
} from '@erp/ui';
import { CheckCircle2 } from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

import { getIssuedInvoiceDocument, recordPackageDelivery } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';
import type { MilestoneItemViewModel } from '../milestone-journey.adapter';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeliveryMethod = 'whatsapp' | 'email' | 'physical' | 'other';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SendInvoiceDialogProps {
  open: boolean;
  milestone: MilestoneItemViewModel | null;
  projectId: string;
  currency: string;
  clientName: string;
  onSent: (installmentId: string, deliveryMethod: DeliveryMethod) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SendInvoiceDialog({
  open,
  milestone,
  projectId,
  currency,
  clientName,
  onSent,
  onClose,
}: SendInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('commercial.contractMilestones.sendInvoice');
  const locale = useLocale() as 'en';

  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [whatsappOpened, setWhatsappOpened] = useState(false);
  const [isOpeningWhatsApp, setIsOpeningWhatsApp] = useState(false);

  async function openWhatsApp() {
    if (!milestone) return;
    const phone = recipient.replace(/[^0-9]/g, '');
    const documents = milestone.invoiceJourney?.documents ?? [];
    if (phone.length < 7 || documents.length === 0 || documents.some((d) => !d.invoiceNumber)) {
      return;
    }

    setIsOpeningWhatsApp(true);
    setErrorMessage(null);
    try {
      const documentLinks = await Promise.all(
        documents.map(async (document) => ({
          document,
          url: (await getIssuedInvoiceDocument(document.invoiceId)).url,
        })),
      );
      const message = [
        t('whatsappGreeting', { client: clientName }),
        t('whatsappIntro', { milestone: milestone.name }),
        ...documentLinks.map(({ document, url }) =>
          t('whatsappDocument', {
            number: document.invoiceNumber!,
            source: document.sourceReference,
            total: document.total
              ? (formatMoney(document.total, currency, locale) ?? document.total)
              : '—',
            dueDate: document.dueDate
              ? (formatDate(document.dueDate, locale) ?? document.dueDate)
              : t('dueDateNotSet'),
            url,
          }),
        ),
        summaryLine ? t('whatsappTotal', { total: summaryLine }) : null,
        t('whatsappPaymentReference'),
        t('whatsappClosing'),
      ]
        .filter(Boolean)
        .join('\n\n');
      const href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(href, '_blank', 'noopener,noreferrer');
      setWhatsappOpened(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('whatsappOpenFailed'));
    } finally {
      setIsOpeningWhatsApp(false);
    }
  }

  async function handleMarkSent() {
    if (!milestone || !deliveryMethod) return;
    setIsPending(true);
    setErrorMessage(null);
    try {
      await recordPackageDelivery(projectId, milestone.id, {
        method: deliveryMethod.toUpperCase() as 'WHATSAPP' | 'EMAIL' | 'PHYSICAL' | 'OTHER',
        sentAt: new Date().toISOString(),
        recipient: recipient.trim() || undefined,
        note: note.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
      onSent(milestone.id, deliveryMethod);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not record delivery. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDeliveryMethod('');
      setRecipient('');
      setNote('');
      setErrorMessage(null);
      setWhatsappOpened(false);
      setIsOpeningWhatsApp(false);
      onClose();
    }
  }

  if (!milestone) return null;

  const journey = milestone.invoiceJourney;
  const total =
    milestone.baseAmount
      ? (
          Number(milestone.baseAmount) +
          milestone.variationAllocations.reduce(
            (sum, vo) => sum + (vo.amount ? Number(vo.amount) : 0),
            0,
          )
        ).toFixed(2)
      : null;

  const totalWithVat = total ? (Number(total) * 1.05).toFixed(2) : null;
  const fmtTotal = totalWithVat ? (formatMoney(totalWithVat, currency, locale) ?? totalWithVat) : null;
  const fmtDue =
    journey?.dueDate ? (formatDate(journey.dueDate, locale) ?? journey.dueDate) : null;

  const summaryLine =
    fmtTotal && fmtDue
      ? t('totalDue', { total: fmtTotal, date: fmtDue })
      : fmtTotal
        ? t('totalNoDue', { total: fmtTotal })
        : null;

  const deliveryOptions = [
    { value: 'whatsapp' as const, label: t('whatsapp') },
    { value: 'email' as const, label: t('email') },
    { value: 'physical' as const, label: t('physical') },
    { value: 'other' as const, label: t('other') },
  ];
  const issuedDocuments = journey?.documents ?? [];
  const allDocumentsNumbered =
    issuedDocuments.length > 0 && issuedDocuments.every((document) => Boolean(document.invoiceNumber));
  const whatsappPhoneIsValid = recipient.replace(/[^0-9]/g, '').length >= 7;
  const canOpenWhatsApp = allDocumentsNumbered && whatsappPhoneIsValid && !isOpeningWhatsApp;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="send-invoice-desc">
        {/* Eyebrow */}
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
          <span className="text-body-sm font-semibold text-success">{t('eyebrow')}</span>
        </div>

        <DialogTitle className="mt-1">{t('title')}</DialogTitle>
        <DialogDescription id="send-invoice-desc" className="text-body-sm text-muted-foreground">
          {summaryLine}
        </DialogDescription>

        <div className="space-y-5 py-1">
          {errorMessage ? (
            <Alert variant="error" messages={[errorMessage]} role="alert" />
          ) : null}

          {journey?.documents.length ? (
            <section className="rounded-panel border border-border bg-surface p-3">
              <p className="text-body-sm font-semibold text-foreground">
                {t('documentsIssued')}
              </p>
              <ul className="mt-2 space-y-1.5">
                {journey.documents.map((document) => (
                  <li
                    key={document.invoiceId}
                    className="flex items-center justify-between gap-3 text-body-sm"
                  >
                    <span className="font-mono font-medium text-foreground">
                      {document.invoiceNumber ?? t('numberPending')}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {document.sourceReference}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!allDocumentsNumbered ? (
            <Alert variant="warning" messages={[t('invoiceNumberRequired')]} role="status" />
          ) : null}

          {/* Delivery method */}
          <RadioGroup
            label={t('method')}
            name="delivery-method"
            value={deliveryMethod}
            onChange={(v) => setDeliveryMethod(v as DeliveryMethod)}
            options={deliveryOptions}
            orientation="vertical"
            description={!deliveryMethod ? t('methodRequired') : undefined}
          />

          {/* Recipient */}
          <FormField htmlFor="si-recipient" label={t('recipient')}>
            <Input
              id="si-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={deliveryMethod === 'whatsapp' ? t('whatsappRecipientPlaceholder') : t('recipientPlaceholder')}
              disabled={isPending}
            />
          </FormField>

          {/* Note */}
          <FormField htmlFor="si-note" label={t('note')}>
            <Textarea
              id="si-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={2}
              disabled={isPending}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('sendLater')}
          </Button>
          <Button
            variant="default"
            onClick={
              deliveryMethod === 'whatsapp' && !whatsappOpened
                ? openWhatsApp
                : handleMarkSent
            }
            disabled={
              !deliveryMethod ||
              isPending ||
              (deliveryMethod === 'whatsapp' && !whatsappOpened && !canOpenWhatsApp)
            }
          >
            {isPending || isOpeningWhatsApp
              ? t('sending')
              : deliveryMethod === 'whatsapp' && !whatsappOpened
                ? t('openWhatsApp')
                : deliveryMethod === 'whatsapp'
                  ? t('confirmWhatsAppSent')
                  : t('markSent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
