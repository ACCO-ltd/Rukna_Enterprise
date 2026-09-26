'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ContractStatus } from '@erp/types';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useContract } from '../hooks/use-contracts';
import { ContractForm } from './contract-form';
import { ContractReadOnlyView } from './contract-read-only-view';

/**
 * Loads a contract for editing and enforces the DRAFT-only rule and the caller's own
 * `canEdit` permission before rendering the live form.
 *
 * The API rejects a PATCH on a non-DRAFT contract with a 400, and enforces
 * `contractsManage` server-side regardless of what the UI shows — but showing a fully
 * editable, submittable form to a user who cannot save it (or to a contract that cannot be
 * saved at all) is its own bug: they only find out on a failed submit, with a generic error.
 * Neither case blocks navigation entirely, either — `ContractReadOnlyView` still shows every
 * fact the form would have edited, just as text, with a plain reason why it isn't editable
 * here.
 */
export function ContractEdit({
  id,
  projectId,
  canEdit,
}: {
  id: string;
  projectId?: string;
  /** From `summary.capabilities.canEditContract` — required so a caller can't forget it and
   * fall back to "always editable". */
  canEdit: boolean;
}) {
  const t = useTranslations('platform.contracts.detail');
  const tCommon = useTranslations('common');
  const { data: contract, isPending, isError, error } = useContract(id);

  // Inside the workspace the recovery back-links return to Contract & Security; the legacy
  // standalone entry (no projectId) still falls back to the retired detail route, which itself
  // redirects into the workspace.
  const backHref = projectId
    ? `/projects/${projectId}/commercial/contract-security`
    : `/contracts/${id}`;

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-96 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href={projectId ? backHref : '/contracts'}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  if (!canEdit || contract.status !== ContractStatus.DRAFT) {
    return (
      <ContractReadOnlyView
        contract={contract}
        backHref={backHref}
        reason={!canEdit ? 'noPermission' : 'notDraft'}
      />
    );
  }

  return <ContractForm contract={contract} projectId={projectId} />;
}
