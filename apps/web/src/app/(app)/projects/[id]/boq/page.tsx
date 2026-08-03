import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { BoqPanel } from '@/features/boq/components/boq-panel';

export default async function BoqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.boq');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <Link
        href={`/projects/${id}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-primary hover:text-brand-primary-hover"
      >
        {t('backToProject')}
      </Link>

      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6">
        <BoqPanel projectId={id} />
      </div>
    </div>
  );
}
