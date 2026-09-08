import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectContractEdit } from '@/features/commercial/components/project-contract-edit';

/**
 * Edit a project's main contract, inside the Commercial workspace (P3 Slice B).
 *
 * The project has exactly one CLIENT_CONTRACT, so the URL carries only the project; the contract
 * id is resolved from the commercial summary inside `ProjectContractEdit`. A focused authoring
 * page in the workspace idiom — heading plus a return path to Contract & Security.
 */
export default async function EditProjectContractPage({
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

      <PageHeader title={t('editTitle')} subtitle={t('editSubtitle')} />

      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ProjectContractEdit projectId={id} />
      </div>
    </div>
  );
}
