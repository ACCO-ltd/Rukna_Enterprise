import { getTranslations } from 'next-intl/server';

import { ModuleTrail } from '@/components/layout/module-chrome';
import { ClientForm } from '@/features/clients/components/client-form';

/**
 * The Projects module header owns the page's `h1` and its breadcrumb names the Clients page
 * (ADR-035). The form opens with its own sticky action bar and record header (ADR-037), so
 * nothing sits between the module header and the bar.
 */
export default async function NewClientPage() {
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="w-full max-w-4xl">
      <ModuleTrail label={t('title')} />
      <ClientForm />
    </div>
  );
}
