'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { useContract } from '../hooks/use-contracts';

/**
 * The standalone `/contracts/[id]/edit` page is folded into the project Commercial workspace
 * (P3 Slice B). Old links still arrive here with only a `contractId`, so this boundary resolves
 * the contract far enough to learn its `projectId`, then `router.replace`s to the workspace edit
 * route — which resolves the same contract from the commercial summary.
 *
 * A client redirect, not a server `redirect()`, because the destination depends on the contract's
 * `projectId`, which the URL does not carry. `replace` (not `push`) keeps the dead URL out of the
 * back-stack. Mirrors `ContractRedirect` for the retired detail page.
 */
export function ContractEditRedirect({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.contracts.detail');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { data, isError } = useContract(contractId);

  useEffect(() => {
    if (data) {
      router.replace(`/projects/${data.projectId}/commercial/contract/edit`);
    }
  }, [data, router]);

  if (isError) {
    return <Alert variant="error" messages={[t('notFound')]} />;
  }

  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{tCommon('loading')}</span>
      <div
        className="h-24 animate-pulse rounded-lg border border-border bg-muted"
        aria-hidden="true"
      />
    </div>
  );
}
