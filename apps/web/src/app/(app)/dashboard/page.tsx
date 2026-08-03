import { getTranslations } from 'next-intl/server';

import { DashboardContent } from '@/features/dashboard/components/dashboard-content';

export default async function DashboardPage() {
  const t = await getTranslations('platform.dashboard');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6">
        <DashboardContent />
      </div>
    </div>
  );
}
