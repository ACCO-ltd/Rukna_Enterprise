import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { PageHeader } from '@/components/layout/page-header';
import { ReceiptsList } from '@/features/receipts/components/receipts-list';

export default async function ReceiptsPage() {
  const t = await getTranslations('platform.receipts');

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button asChild>
            <Link href="/receipts/new">{t('newReceipt')}</Link>
          </Button>
        }
      />
      <ReceiptsList />
    </>
  );
}
