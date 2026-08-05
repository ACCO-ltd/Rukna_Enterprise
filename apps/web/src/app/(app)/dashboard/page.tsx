import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { DashboardContent } from '@/features/dashboard/components/dashboard-content';

export default async function DashboardPage() {
  const t = await getTranslations('platform.dashboard');

  return (
    <>
      <PageHeader title={t('title')} />
      <DashboardContent />
    </>
  );
}
