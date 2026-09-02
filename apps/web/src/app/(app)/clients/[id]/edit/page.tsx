import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ClientEdit } from '@/features/clients/components/client-edit';

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('breadcrumb'), href: '/clients' }, { label: t('editTitle') }]}
        title={t('editTitle')}
        subtitle={t('editSubtitle')}
      />
      {/* ClientEdit renders its own panel through ClientForm; the loading and error states it
          shows first are deliberately unpanelled, so a failure is not dressed as a document. */}
      <ClientEdit id={id} />
    </div>
  );
}
