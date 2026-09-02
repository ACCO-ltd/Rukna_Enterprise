import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ClientForm } from '@/features/clients/components/client-form';

export default async function NewClientPage() {
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('breadcrumb'), href: '/clients' }, { label: t('title') }]}
        title={t('title')}
        subtitle={t('subtitle')}
      />
      <ClientForm />
    </div>
  );
}
