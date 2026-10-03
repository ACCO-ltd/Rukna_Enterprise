'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@erp/ui';

import { JournalsList } from '@/features/accounting/components/journals-list';
import { SupplierPaymentsList } from '@/features/procurement/components/payment-screens';
import { ReceiptsList } from '@/features/receipts/components/receipts-list';

import { useProjectPaymentsAccess } from '../hooks';

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3" data-payments-section={id}>
      <div>
        <h2 id={id} className="text-h3 font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-caption text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Money movements for one project inside Finance (ADR-043 Phase 2): client receipts allocated
 * to its invoices, supplier payments allocated to its bills, and manual journals coded to it.
 * Each is the SAME list its accounting page renders, fixed to the project server-side
 * (`?projectId=`), and each appears only for holders of that list's own permission.
 */
export function FinanceProjectPayments({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.payments');
  const access = useProjectPaymentsAccess();

  if (!access.any) {
    return (
      <EmptyState
        variant="page"
        icon={<Lock size={24} aria-hidden="true" />}
        title={t('noAccess')}
        description={t('noAccessHint')}
      />
    );
  }

  return (
    <div className="space-y-8" data-finance-payments>
      {access.receipts ? (
        <Section id="finance-payments-receipts" title={t('receipts')} hint={t('receiptsHint')}>
          <ReceiptsList projectId={projectId} />
        </Section>
      ) : null}
      {access.supplierPayments ? (
        <Section id="finance-payments-supplier" title={t('supplierPayments')} hint={t('supplierPaymentsHint')}>
          <SupplierPaymentsList projectId={projectId} />
        </Section>
      ) : null}
      {access.journals ? (
        <Section id="finance-payments-journals" title={t('journals')} hint={t('journalsHint')}>
          <JournalsList projectId={projectId} />
        </Section>
      ) : null}
    </div>
  );
}
