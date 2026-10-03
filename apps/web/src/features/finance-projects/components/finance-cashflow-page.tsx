'use client';

import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/layout/page-header';

import { CashflowView } from './cashflow-view';

/** Finance → Reports → Cash flow: the portfolio forecast. */
export function FinanceCashflowPage() {
  const t = useTranslations('finance.cashflow');
  return (
    <div className="w-full max-w-6xl space-y-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <CashflowView />
    </div>
  );
}
