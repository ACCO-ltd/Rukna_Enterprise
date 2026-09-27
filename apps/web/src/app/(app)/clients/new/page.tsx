import { getTranslations } from 'next-intl/server';

import { ModuleTrail } from '@/components/layout/module-chrome';
import { ClientForm } from '@/features/clients/components/client-form';

/**
 * The Projects module header owns the page's `h1` and its breadcrumb names the Clients page
 * (ADR-035). What stays here is the one line a creator needs before starting.
 */
export default async function NewClientPage() {
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="w-full max-w-4xl">
      <ModuleTrail label={t('title')} />
      <p className="mb-4 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      <ClientForm />
    </div>
  );
}
