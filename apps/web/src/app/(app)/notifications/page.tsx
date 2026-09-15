import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { NotificationFeed } from '@/features/notifications/components/notification-feed';

export default async function NotificationsPage() {
  const t = await getTranslations('notifications');

  return (
    <>
      <PageHeader title={t('title')} />
      <NotificationFeed />
    </>
  );
}
