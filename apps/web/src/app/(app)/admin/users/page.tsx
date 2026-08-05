import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { UsersList } from '@/features/users/components/users-list';

export default async function UsersPage() {
  const t = await getTranslations('platform.users');

  return (
    <>
      <PageHeader title={t('title')} />
      <UsersList />
    </>
  );
}
