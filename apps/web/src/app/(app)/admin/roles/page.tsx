import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { RolesList } from '@/features/roles/components/roles-list';

export default async function RolesPage() {
  const t = await getTranslations('platform.roles');

  return (
    <>
      <PageHeader title={t('title')} />
      <RolesList />
    </>
  );
}
