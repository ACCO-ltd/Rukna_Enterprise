'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  ApprovalChain,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  RadioGroup,
  Textarea,
  type ApprovalStep,
  type RadioOption,
} from '@erp/ui';
import { Mail, MessageCircle, MoreHorizontal, Printer } from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

import { getIssuedInvoiceDocument, recordPackageDelivery } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';
import type { MilestoneItemViewModel } from '../milestone-journey.adapter';
import { InvoiceDocumentPreview } from './invoice-document-preview';

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

  const deliveryOptions: RadioOption<DeliveryMethod>[] = [
    { value: 'whatsapp', label: <IconLabel icon={<MessageCircle size={16} aria-hidden="true" />}>{t('whatsapp')}</IconLabel> },
    { value: 'email', label: <IconLabel icon={<Mail size={16} aria-hidden="true" />}>{t('email')}</IconLabel> },
    { value: 'physical', label: <IconLabel icon={<Printer size={16} aria-hidden="true" />}>{t('physical')}</IconLabel> },
    { value: 'other', label: <IconLabel icon={<MoreHorizontal size={16} aria-hidden="true" />}>{t('other')}</IconLabel> },
  ];
  const issuedDocuments = journey?.documents ?? [];
  const allDocumentsNumbered =
    issuedDocuments.length > 0 && issuedDocuments.every((document) => Boolean(document.invoiceNumber));
  const whatsappPhoneIsValid = recipient.replace(/[^0-9]/g, '').length >= 7;
  const canOpenWhatsApp = allDocumentsNumbered && whatsappPhoneIsValid && !isOpeningWhatsApp;

  // Lifecycle context (Draft → Issued → Sent → Paid). This dialog only ever opens once an
  // invoice is issued, so 'draft' is always behind it — the rest reflects the real journey/
  // milestone state rather than assuming this action always ends in 'sent'.
  const isPaid = milestone.userState === 'paid';
  const isPartiallyPaid = milestone.userState === 'partially-paid';
  const isSent =
    journey?.phase === 'sent' || milestone.userState === 'awaiting-payment' || isPaid || isPartiallyPaid;
  const lifecycleSteps: ApprovalStep[] = [
    { id: 'draft', title: t('lifecycle.draft'), state: 'approved' },
    { id: 'issued', title: t('lifecycle.issued'), state: isSent ? 'approved' : 'current' },
    {
      id: 'sent',
      title: t('lifecycle.sent'),
      state: isPaid || isPartiallyPaid ? 'approved' : isSent ? 'current' : 'upcoming',
    },
    { id: 'paid', title: t('lifecycle.paid'), state: isPaid ? 'approved' : isPartiallyPaid ? 'current' : 'upcoming' },
  ];

  const primaryLabel =
    isPending || isOpeningWhatsApp
      ? t('sending')
      : deliveryMethod === 'whatsapp' && !whatsappOpened
        ? t('openWhatsApp')
        : deliveryMethod === 'whatsapp'
          ? t('confirmWhatsAppSent')
          : t('markSent');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" aria-describedby="send-invoice-desc">
        <DialogHeader>
          <Badge tone="live" dot className="w-fit">
            {t('eyebrow')}
          </Badge>
          <DialogTitle className="mt-2">{t('title')}</DialogTitle>
          <DialogDescription id="send-invoice-desc">{summaryLine}</DialogDescription>

          <div className="mt-4 overflow-x-auto border-t border-border pt-4 [-webkit-overflow-scrolling:touch]">
            <ApprovalChain steps={lifecycleSteps} label={t('lifecycleLabel')} />
          </div>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Left: delivery record ──────────────────────────────────────── */}
          <div className="space-y-5 overflow-y-auto">
            <div>
              <h3 className="text-body font-semibold text-foreground">{t('deliveryRecordTitle')}</h3>
              <p className="mt-0.5 text-body-sm text-muted-foreground">{t('deliveryRecordHint')}</p>
            </div>

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
              variant="card"
              orientation="horizontal"
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
                rows={3}
                disabled={isPending}
              />
            </FormField>
          </div>

          {/* ── Right: live preview ─────────────────────────────────────────── */}
          <div className="hidden lg:block">
            <InvoiceDocumentPreview documents={issuedDocuments} allNumbered={allDocumentsNumbered} />
          </div>
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
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
