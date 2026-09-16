import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { BrandingManager } from '@/features/organization/components/branding-manager';

export default async function BrandingPage() {
  const t = await getTranslations('platform.branding');

  return (
    <AdminPanel title={t('title')} description={t('pageIntro')}>
      <BrandingManager />
    </AdminPanel>
  );
}
