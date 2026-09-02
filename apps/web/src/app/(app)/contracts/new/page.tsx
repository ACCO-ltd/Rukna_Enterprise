import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ContractForm } from '@/features/contracts/components/contract-form';

export default async function NewContractPage() {
  const t = await getTranslations('platform.contracts');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('title'), href: '/contracts' }]}
        title={t('create.title')}
      />
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ContractForm />
      </div>
    </div>
  );
}
