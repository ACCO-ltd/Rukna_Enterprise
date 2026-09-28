'use client';

import { useTranslations } from 'next-intl';

import { SupplierBillDetail } from '@/features/procurement/components/bill-screens';

/**
 * A supplier bill opened from the project Ledger (flow plan PR 4): the same document page
 * Accounting uses, kept inside the project's Finance tab. Back returns to the Ledger.
 */
export function ProjectBillPage({ projectId, billId }: { projectId: string; billId: string }) {
  const t = useTranslations('finance.shell');
  return (
    <SupplierBillDetail
      id={billId}
      back={{ href: `/projects/${projectId}/finance/ledger`, label: t('views.ledger') }}
    />
  );
}
