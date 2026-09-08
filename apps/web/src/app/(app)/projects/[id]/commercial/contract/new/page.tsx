import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ContractForm } from '@/features/contracts/components/contract-form';

/**
 * Create a project's main contract, inside the Commercial workspace (P3 Slice B).
 *
 * The standalone `/contracts/new` page is folded away: the project is known from the `[id]`
 * segment, so it is pinned into the form rather than chosen from a dropdown. This is a focused
 * authoring page — a workspace-idiom heading and a return path to Contract & Security — not the
 * tab shell, because the form is a full-height task the tabs would only crowd.
 */
export default async function NewProjectContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('commercial.contractAuthoring');

  const backHref = `/projects/${id}/commercial/contract-security`;

  return (
    <div className="w-full max-w-4xl">
      <Link
        href={backHref}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {t('back')}
      </Link>

      <PageHeader title={t('newTitle')} subtitle={t('newSubtitle')} />

      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ContractForm projectId={id} />
      </div>
    </div>
  );
}
