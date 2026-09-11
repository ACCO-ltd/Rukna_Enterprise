'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ContractEdit } from '@/features/contracts/components/contract-edit';

import { useCommercialSummary } from '../hooks/use-commercial';

/**
 * Resolves the project's single main contract, then hands editing to the shared `ContractEdit`.
 *
 * The workspace edit route (`/projects/:id/commercial/contract/edit`) carries only the project in
 * its URL — a project has exactly one CLIENT_CONTRACT, so the contract id is derived from the
 * commercial summary the same way Contract & Security reads it (`summary.mainContract.id`) rather
 * than being threaded through the URL. `ContractEdit` then enforces the DRAFT-only rule and the
 * not-found / non-draft states; this boundary only covers "which contract" and "is there one".
 */
export function ProjectContractEdit({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial.contractAuthoring');
  const tCommon = useTranslations('common');
  const summary = useCommercialSummary(projectId);

  const backHref = `/projects/${projectId}/commercial/contract-security`;

  if (summary.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href={backHref}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const contractId = summary.data.mainContract?.id;

  // A project with no main contract has nothing to edit — send the user to create one rather than
  // mounting an edit form against an id that does not exist.
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

  return <ContractEdit id={contractId} projectId={projectId} />;
}
