'use client';

import { useTranslations } from 'next-intl';
import { Alert, SkeletonRecord } from '@erp/ui';

import { useInvoice } from '../hooks/use-invoices';
import { ManualInvoiceForm } from './manual-invoice-form';

/** ADR-048 — edit a DRAFT hand-typed invoice; anything else explains why it cannot be edited. */
export function ManualInvoiceEdit({ id }: { id: string }) {
  const t = useTranslations('accounting.invoices.manual');
  const query = useInvoice(id);
  if (query.isPending) return <SkeletonRecord label={t('loading')} />;
  if (query.isError || !query.data) return <Alert variant="error" messages={[t('loadFailed')]} />;
  if (!query.data.isManual || query.data.documentStatus !== 'DRAFT') {
    return <Alert variant="warning" messages={[t('notEditable')]} />;
  }
  return <ManualInvoiceForm invoice={query.data} />;
}
