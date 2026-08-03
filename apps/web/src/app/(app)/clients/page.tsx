import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { ClientsList } from '@/features/clients/components/clients-list';

export default async function ClientsPage() {
  const t = await getTranslations('platform.clients');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <Button asChild>
          <Link href="/clients/new">{t('newClient')}</Link>
        </Button>
      </div>

      <div className="mt-6">
        <ClientsList />
      </div>
    </div>
  );
}
