'use client';

import type { CommercialSummaryResponse } from '@erp/types';
import { useTranslations } from 'next-intl';

import { MainContractTab } from './main-contract-tab';
import { GuaranteesTab } from './guarantees-tab';

/** Contract baseline and the instruments that secure its performance. */
export function ContractSecurityTab({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial.contractSecurity');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-h3 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <MainContractTab summary={summary} />
      <section className="space-y-2">
        <h2 className="text-body-sm font-semibold text-foreground">{t('guarantees')}</h2>
        <GuaranteesTab summary={summary} />
      </section>
    </div>
  );
}
