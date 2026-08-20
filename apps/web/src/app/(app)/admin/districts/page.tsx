import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { DistrictsManager } from '@/features/districts/components/districts-manager';

export default async function DistrictsPage() {
  const t = await getTranslations('platform.districts');

  return (
    <>
      <PageHeader title={t('title')} />
      <DistrictsManager />
    </>
  );
}
