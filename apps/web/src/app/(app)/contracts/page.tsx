import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { ContractsList } from '@/features/contracts/components/contracts-list';

export default async function ContractsPage() {
  const t = await getTranslations('platform.contracts');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <Button asChild>
          <Link href="/contracts/new">{t('newContract')}</Link>
        </Button>
      </div>

      <div className="mt-6">
        <ContractsList />
      </div>
    </div>
  );
}
