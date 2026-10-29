'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, SkeletonForm } from '@erp/ui';

import { useCommercialSummary } from '../hooks/use-commercial';
import { LoadError } from '@/components/load-error';

/**
 * Resolves the project's single main contract for the project-scoped IPA/IPC routes, then hands
 * the resolved `contractId` to the mounted authoring component.
 *
 * The workspace application routes (`/projects/:id/commercial/applications/*`) carry only the
 * project in the URL — a project has exactly one CLIENT_CONTRACT, so the contract id is derived
 * from the commercial summary the same way Contract & Security reads it
 * (`summary.mainContract.id`), exactly as `ProjectContractEdit` does for the edit route. The IPA
 * form, IPA detail, IPC wizard and IPC detail all still take `contractId`; this boundary only
 * answers "which contract" and "is there one", and every mounted component keeps its own
 * pending / not-found / lifecycle handling.
 */
export function ProjectApplicationBoundary({
  projectId,
  children,
}: {
  projectId: string;
  children: (contractId: string) => ReactNode;
}) {
  const t = useTranslations('commercial.contractAuthoring');
  const tCommon = useTranslations('common');
  const summary = useCommercialSummary(projectId);

  const contractSecurityHref = `/projects/${projectId}/commercial/contract`;

  if (summary.isPending) {
    return <SkeletonForm label={tCommon('loading')} />;
  }

  if (summary.isError) {
    return (
      <div className="space-y-4">
        <LoadError message={t('loadFailed')} onRetry={() => void summary.refetch()} />
        <Button variant="outline" asChild>
          <Link href={contractSecurityHref}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const contractId = summary.data.mainContract?.id;

  // A project with no main contract has no application to build against — point the user at
  // creating a contract rather than mounting a form against an id that does not exist.
  if (!contractId) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" messages={[t('noContractHint')]} />
        <Button asChild>
          <Link href={`/projects/${projectId}/commercial/contract/new`}>{t('createContract')}</Link>
        </Button>
      </div>
    );
  }

  return <>{children(contractId)}</>;
}
