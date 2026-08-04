import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { ReceiptsList } from '@/features/receipts/components/receipts-list';

export default async function ReceiptsPage() {
  const t = await getTranslations('platform.receipts');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <Button asChild>
          <Link href="/receipts/new">{t('newReceipt')}</Link>
        </Button>
      </div>

      <div className="mt-6">
        <ReceiptsList />
      </div>
    </div>
  );
}
