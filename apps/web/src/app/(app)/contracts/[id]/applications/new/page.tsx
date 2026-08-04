import { getTranslations } from 'next-intl/server';

import { IpaForm } from '@/features/ipa/components/ipa-form';

export default async function NewIpaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.ipa.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <IpaForm contractId={id} />
      </div>
    </div>
  );
}
