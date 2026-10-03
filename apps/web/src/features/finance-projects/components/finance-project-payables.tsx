'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@erp/ui';

import { SupplierBillsList } from '@/features/procurement/components/bill-screens';

import { useCanViewProjectPayables } from '../hooks';

/**
 * Payables inside Finance (ADR-043 Phase 2): this project's supplier bills — the SAME list the
 * accounting Bills page renders, fixed to the project server-side (`GET /bills?projectId=`, so
 * a bill coded to the project on one line still appears), with match, approval, posting and
 * outstanding. A row opens the accounting bill page, where approve / post / pay and the
 * "Why can't I pay this?" checklist live — no command is repeated here.
 */
export function FinanceProjectPayables({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.payables');
  const allowed = useCanViewProjectPayables();

  if (!allowed) {
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
    <section aria-labelledby="finance-payables-title" className="space-y-3" data-finance-payables>
      <div>
        <h2 id="finance-payables-title" className="text-h3 font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="text-caption text-muted-foreground">{t('hint')}</p>
      </div>
      <SupplierBillsList projectId={projectId} />
    </section>
  );
}
