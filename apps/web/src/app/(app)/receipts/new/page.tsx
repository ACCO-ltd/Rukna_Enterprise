import { getTranslations } from 'next-intl/server';

import { ReceiptForm } from '@/features/receipts/components/receipt-form';

export default async function NewReceiptPage() {
  const t = await getTranslations('platform.receipts.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ReceiptForm />
      </div>
    </div>
  );
}
