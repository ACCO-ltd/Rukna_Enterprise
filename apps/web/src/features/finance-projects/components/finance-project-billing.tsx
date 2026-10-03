'use client';

import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, Skeleton } from '@erp/ui';

import {
  CommercialBillingView,
  projectInvoiceHref,
} from '@/features/commercial/components/commercial-billing-view';
import { PaymentSchedulePanel } from '@/features/commercial/components/commercial-contract-view';
import { useCommercialWorkspace } from '@/features/commercial/hooks/use-commercial-workspace';

/**
 * Billing inside Finance (ADR-043 decision 1: the finance team issues invoices). The SAME
 * components the project's Commercial tab renders — the payment schedule (each milestone stage
 * with its verified / ready-to-bill state and the one reason it waits) and the billing view (to
 * do, prepare/issue invoice, send on WhatsApp, record a payment, send a reminder, invoices,
 * payments) — over the same `GET …/commercial/workspace` read and the same commands. Since Phase 3
 * these commands live ONLY here: the project's Commercial tab shows a money-free status per stage.
 * An invoice opens on the project invoice page hosted under this tab (`…/billing/invoices/:id`),
 * which carries every invoice command — issue, send, record payment, credit note, collection notes.
 * Construction still verifies milestones.
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
      <PaymentSchedulePanel projectId={projectId} workspace={workspace} mode="finance" invoiceHref={projectInvoiceHref(projectId)} />
      <CommercialBillingView projectId={projectId} workspace={workspace} invoiceHref={projectInvoiceHref(projectId)} />
    </div>
  );
}
