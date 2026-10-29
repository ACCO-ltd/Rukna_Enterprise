import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { ReaderSettings } from '@/features/document-reader/reader-settings';

export default async function PhotoReaderPage() {
  const t = await getTranslations('platform.photoReader');

  return (
    <AdminPanel title={t('title')} description={t('pageIntro')}>
      <ReaderSettings />
    </AdminPanel>
  );
}
