import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { ContractsList } from '@/features/contracts/components/contracts-list';

export default async function ProjectContractsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('platform.contracts');

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href="/contracts/new">{t('newContract')}</Link>
        </Button>
      </div>
      <ContractsList projectId={id} />
    </div>
  );
}
