'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { useContract } from '../hooks/use-contracts';

/**
 * Which legacy IPA/IPC authoring page is redirecting. Each maps to the matching project-scoped
 * route under `/projects/:projectId/commercial/applications/…`. Kept as a serializable string so a
 * Server Component page can hand it to this Client boundary (functions can't cross that boundary).
 */
export type ApplicationRedirectTarget =
  | 'application-new'
  | 'application-detail'
  | 'certificate-new'
  | 'certificate-detail';

function workspacePath(
  target: ApplicationRedirectTarget,
  projectId: string,
  ipaId?: string,
  ipcId?: string,
): string {
  const base = `/projects/${projectId}/commercial/applications`;
  switch (target) {
    case 'application-new':
      return `${base}/new`;
    case 'application-detail':
      return `${base}/${ipaId}`;
    case 'certificate-new':
      return `${base}/${ipaId}/certificates/new`;
    case 'certificate-detail':
      return `${base}/${ipaId}/certificates/${ipcId}`;
  }
}

/**
 * The standalone IPA/IPC authoring routes under `/contracts/[id]/applications/…` are folded into
 * the project Commercial workspace (P3 Slice C). Old bookmarks and deep-links still arrive here
 * carrying only a `contractId` (plus, for nested pages, an `ipaId`/`ipcId`), so this boundary
 * resolves the contract just far enough to learn its `projectId`, then replaces the history entry
 * with the matching project-scoped workspace route.
 *
 * A client redirect — not a server `redirect()` — because the destination depends on data
 * (`projectId`) the URL does not carry. `router.replace` (not `push`) keeps the dead URL out of the
 * back-stack so Back doesn't bounce the user straight back here. Mirrors `ContractRedirect`.
 */
export function ContractApplicationRedirect({
  contractId,
  target,
  ipaId,
  ipcId,
}: {
  contractId: string;
  target: ApplicationRedirectTarget;
  ipaId?: string;
  ipcId?: string;
}) {
  const t = useTranslations('platform.contracts.detail');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { data, isError } = useContract(contractId);

  useEffect(() => {
    if (data) {
      router.replace(workspacePath(target, data.projectId, ipaId, ipcId));
    }
  }, [data, router, target, ipaId, ipcId]);

  if (isError) {
    return <Alert variant="error" messages={[t('notFound')]} />;
  }

  // Covers both the in-flight fetch and the brief moment after it resolves but before the
  // route change commits — either way the user should see a calm "taking you there" state.
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{tCommon('loading')}</span>
      <div
        className="h-24 animate-pulse rounded-panel border border-border bg-muted"
        aria-hidden="true"
      />
    </div>
  );
}
