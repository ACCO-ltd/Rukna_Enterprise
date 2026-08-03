import { getTranslations } from 'next-intl/server';

import { ClientEdit } from '@/features/clients/components/client-edit';

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('editTitle')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ClientEdit id={id} />
      </div>
    </div>
  );
}
