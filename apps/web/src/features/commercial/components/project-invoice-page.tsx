'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { InvoiceDetail } from '@/features/accounting/components/invoice-detail';

/**
 * A client invoice opened from a project (flow plan PR 4, NAV-006): the same document page
 * Accounting uses, rendered under the project's Commercial tab so the finance officer never
 * leaves the project to review, approve or post it. Back returns to Billing & collection.
 */
export function ProjectInvoicePage({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const t = useTranslations('commercial.billing');
  const tTabs = useTranslations('commercial.tabs');
  const searchParams = useSearchParams();
  const base = `/projects/${projectId}/commercial/billing-collection`;
  // `?from=` keeps the list's filter on the way back — only when it points back into this
  // project's Commercial tab, never to an arbitrary URL.
  const from = searchParams?.get('from');
  const href = from && from.startsWith(`/projects/${projectId}/commercial/`) ? from : base;
  // The label names where Back actually goes.
  const label = href.includes('/commercial/contract-milestones')
    ? tTabs('contract-milestones')
    : t('title');
  return <InvoiceDetail invoiceId={invoiceId} projectId={projectId} back={{ href, label }} />;
}
