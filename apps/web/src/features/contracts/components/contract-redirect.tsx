'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { useContract } from '../hooks/use-contracts';

/**
 * The standalone `/contracts/[id]` detail page is retired: the Contract aggregate now lives
 * in its project's Commercial workspace (P3 Q-C). Old bookmarks and deep-links still arrive
 * here with only a `contractId` in the URL, so this boundary resolves the contract just far
 * enough to learn its `projectId`, then replaces the history entry with the workspace route.
 *
 * A client redirect — not a server `redirect()` — because the destination depends on data
 * (`projectId`) the URL does not carry. `router.replace` (not `push`) keeps the dead URL out
 * of the back-stack so Back doesn't bounce the user straight back here.
 */
export function ContractRedirect({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.contracts.detail');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { data, isError } = useContract(contractId);

  useEffect(() => {
    if (data) {
      router.replace(`/projects/${data.projectId}/commercial/contract-security`);
    }
  }, [data, router]);

  if (isError) {
    return <Alert variant="error" messages={[t('notFound')]} />;
  }

  // Covers both the in-flight fetch and the brief moment after it resolves but before the
  // route change commits — either way the user should see a calm "taking you there" state.
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
