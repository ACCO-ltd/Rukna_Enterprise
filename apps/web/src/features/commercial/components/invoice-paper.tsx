'use client';

import { useLocale, useTranslations } from 'next-intl';
import { DocumentPaper, MoneyDisplay } from '@erp/ui';
import type { CommercialInvoiceDocumentResponse } from '@erp/types';

import { formatDate } from '@/lib/format';

/**
 * A commercial invoice drawn on paper from `GET …/commercial/invoices/:id` — the same data the
 * PDF uses. The issuer block is the issuing organisation: its current branding while the invoice
 * is a draft, the snapshot frozen at issue afterwards (decision D8), so nothing here is hardcoded.
 *
 * Money-blind viewers get the hidden state on every line and one sentence in place of the totals.
 */
export function InvoicePaper({
  document,
  className,
}: {
  document: CommercialInvoiceDocumentResponse;
  className?: string;
}) {
  const t = useTranslations('commercial.invoicePage.paper');
  const locale = useLocale() as 'en';
  const hidden = !document.financialsVisible;
  const isDraft = document.lifecycle === 'DRAFT';

  // Money inside the sheet uses the sheet's own ink — the app's muted grey would vanish on the
  // light paper in the dark theme.
  const money = (value: string | null) => (
    <MoneyDisplay
      value={value}
      hidden={hidden}
      hiddenLabel={t('hiddenAmount')}
      className={hidden ? 'text-brand-panel/60' : undefined}
    />
  );

  const invoiceDate = formatDate(document.invoiceDate, locale) ?? (isDraft ? t('onIssue') : t('notSet'));
  const dueDate =
    formatDate(document.dueDate, locale) ??
    (document.paymentTermsDays !== null
      ? t('netDays', { days: document.paymentTermsDays })
      : t('notSet'));

  const facts = [
    { label: t('invoiceDate'), value: invoiceDate },
    { label: t('dueDate'), value: dueDate },
    ...(document.projectCode ? [{ label: t('project'), value: document.projectCode }] : []),
    ...(document.contractNumber ? [{ label: t('contract'), value: document.contractNumber }] : []),
  ];

  const totals = [
    { label: t('subtotal'), value: money(document.subtotal) },
    ...(document.taxLabel ? [{ label: document.taxLabel, value: money(document.taxAmount) }] : []),
  ];

  return (
    <DocumentPaper
      label={t('label')}
      className={className}
      issuer={{
        name: document.issuer.name,
        address: document.issuer.legalAddress,
        registration: document.issuer.taxRegistrationNumber
          ? t('taxRegistration', { number: document.issuer.taxRegistrationNumber })
          : null,
        logoUrl: document.issuer.logoUrl,
        logoAlt: t('logoAlt', { name: document.issuer.name }),
      }}
      title={t('title')}
      number={document.invoiceNumber}
      numberPendingLabel={t('numberPending')}
      billTo={{ label: t('billTo'), name: document.billTo.name, address: document.billTo.address }}
      facts={facts}
      columns={{
        description: t('description'),
        amount: t('amount', { currency: document.currency }),
      }}
      lines={document.lines.map((line, index) => ({
        key: `${index}-${line.description}`,
        description: line.description,
        detail: line.detail,
        amount: money(line.amount),
      }))}
      noLinesLabel={t('noLines')}
      totals={hidden ? [] : totals}
      total={hidden ? undefined : { label: t('totalDue'), value: money(document.total) }}
      totalsHiddenLabel={hidden ? t('totalsHidden') : undefined}
      footer={document.issuer.footerNote ?? undefined}
      watermark={isDraft ? t('watermark') : undefined}
    />
  );
}
