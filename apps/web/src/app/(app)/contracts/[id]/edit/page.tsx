import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ContractEdit } from '@/features/contracts/components/contract-edit';

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.contracts');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('detail.back'), href: `/contracts/${id}` }]}
        title={t('create.editTitle')}
      />
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ContractEdit id={id} />
      </div>
    </div>
  );
}
