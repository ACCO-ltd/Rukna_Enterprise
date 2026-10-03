'use client';

import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, Skeleton } from '@erp/ui';

import { CommercialBillingView, type InvoiceHrefBuilder } from '@/features/commercial/components/commercial-billing-view';
import { PaymentSchedulePanel } from '@/features/commercial/components/commercial-contract-view';
import { useCommercialWorkspace } from '@/features/commercial/hooks/use-commercial-workspace';

/** In Finance an invoice opens on the accounting invoice page, so the finance team stays in Finance. */
export const accountingInvoiceHref: InvoiceHrefBuilder = (invoiceId) => `/finance/accounting/invoices/${invoiceId}`;

/**
 * Billing inside Finance (ADR-043 decision 1: the finance team issues invoices). The SAME
 * components the project's Commercial tab renders — the payment schedule (each milestone stage
 * with its verified / ready-to-bill state and the one reason it waits) and the billing view (to
 * do, prepare/issue invoice, send on WhatsApp, record a payment, send a reminder, invoices,
 * payments) — over the same `GET …/commercial/workspace` read and the same commands. Only the
 * invoice links differ. Construction still verifies and marks milestones ready to bill.
 */
export function FinanceProjectBilling({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.billing');
  const query = useCommercialWorkspace(projectId);
  const workspace = query.data;

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError || !workspace) {
    return (
      <Alert variant="error" title={t('loadFailed')}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  if (!workspace.contract) {
    return (
      <EmptyState
        variant="page"
        icon={<FileSignature size={24} strokeWidth={1.8} aria-hidden="true" />}
        title={t('noContract')}
        description={t('noContractHint')}
        action={
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/commercial`}>{t('openCommercial')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4" data-finance-billing>
      <PaymentSchedulePanel projectId={projectId} workspace={workspace} invoiceHref={accountingInvoiceHref} />
      <CommercialBillingView projectId={projectId} workspace={workspace} invoiceHref={accountingInvoiceHref} />
    </div>
  );
}
