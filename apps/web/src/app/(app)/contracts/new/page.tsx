import { getTranslations } from 'next-intl/server';

import { ContractForm } from '@/features/contracts/components/contract-form';

export default async function NewContractPage() {
  const t = await getTranslations('platform.contracts.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ContractForm />
      </div>
    </div>
  );
}
