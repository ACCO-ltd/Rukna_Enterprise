import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { CompanyTemplatesManager } from '@/features/organization/components/company-templates-manager';

export default async function TemplatesPage() {
  const t = await getTranslations('platform.templates');

  return (
    <AdminPanel title={t('title')} description={t('pageIntro')}>
      <CompanyTemplatesManager />
    </AdminPanel>
  );
}
