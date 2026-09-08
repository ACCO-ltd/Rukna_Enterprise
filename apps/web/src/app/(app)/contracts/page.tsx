import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ContractsList } from '@/features/contracts/components/contracts-list';

export default async function ContractsPage() {
  const t = await getTranslations('platform.contracts');

  return (
    <>
      <PageHeader title={t('title')} />
      <ContractsList />
    </>
  );
}
