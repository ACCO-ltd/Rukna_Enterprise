import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';
import { Plus } from 'lucide-react';

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
            <Link href="/clients/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {t('newClient')}
            </Link>
          </Button>
        }
      />
      <ClientsList />
    </>
  );
}
