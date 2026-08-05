import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { PageHeader } from '@/components/layout/page-header';
import { ClientsList } from '@/features/clients/components/clients-list';

export default async function ClientsPage() {
  const t = await getTranslations('platform.clients');

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button asChild>
            <Link href="/clients/new">{t('newClient')}</Link>
          </Button>
        }
      />
      <ClientsList />
    </>
  );
}
