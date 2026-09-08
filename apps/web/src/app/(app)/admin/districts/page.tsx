import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { DistrictsManager } from '@/features/districts/components/districts-manager';

export default async function DistrictsPage() {
  const t = await getTranslations('platform.districts');

  return (
    <AdminPanel title={t('title')} description={t('intro')}>
      <DistrictsManager />
    </AdminPanel>
  );
}
