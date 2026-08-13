import { getTranslations } from 'next-intl/server';

import { ClientForm } from '@/features/clients/components/client-form';

export default async function NewClientPage() {
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6 bg-surface px-1 py-2 sm:px-6 sm:py-6">
        <ClientForm />
      </div>
    </div>
  );
}
