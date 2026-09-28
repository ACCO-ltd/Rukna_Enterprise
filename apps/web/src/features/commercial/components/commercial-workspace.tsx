'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileSignature } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, Skeleton } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useCommercialSummary } from '../hooks/use-commercial';
import { useCommercialWorkspace } from '../hooks/use-commercial-workspace';
import { ApplicationsTab } from './applications-tab';
import { CommercialBillingView } from './commercial-billing-view';
import { CommercialContextBar } from './commercial-context-bar';
import { CommercialContractView } from './commercial-contract-view';
import {
  CommercialNav,
  commercialLandingTab,
  commercialTabHref,
  commercialTabsFor,
  type CommercialTab,
} from './commercial-nav';

/**
 * The Commercial tab: "here's what we're owed and what we've collected".
 *
 * No page title — the project tab bar already says "Commercial". Without a contract the tab is one
 * empty state with the one way forward. With one, a bar states the contract and its five figures,
 * the view switch sits under it, and the view does the work. Every figure, ranking and permission
 * comes from `GET …/commercial/workspace`; this component only arranges it.
 *
 * `active="landing"` is `/commercial` itself: it lands billers on Billing and everyone else on
 * Contract (the JWT permissions live client-side, so the choice is made here, not in the route).
 */
export function CommercialWorkspace({
  projectId,
  active,
}: {
  projectId: string;
  active: CommercialTab | 'landing';
}) {
  const t = useTranslations('commercial.workspace');
  const router = useRouter();
  const query = useCommercialWorkspace(projectId);
  const workspace = query.data;
  const contract = workspace?.contract ?? null;

  useEffect(() => {
    if (active === 'landing' && workspace && contract) {
      router.replace(commercialTabHref(projectId, commercialLandingTab(workspace.capabilities.canBill)));
    }
  }, [active, workspace, contract, projectId, router]);

  if (query.isPending) return <WorkspaceSkeleton label={t('loading')} />;

  if (query.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[errorText(query.error, t('loadFailedHint'))]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  if (!workspace) return null;

  // ─── No contract: one empty state, one way forward ─────────────────────────
  if (!contract) {
    return (
      <EmptyState
        variant="page"
        icon={<FileSignature size={24} strokeWidth={1.8} aria-hidden="true" />}
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <div className="flex flex-col items-center gap-3">
            {workspace.capabilities.canRecordContract ? (
              <Button asChild>
                <Link href={`/projects/${projectId}/commercial/contract/new`}>{t('empty.record')}</Link>
              </Button>
            ) : (
              <p className="text-caption text-muted-foreground">{t('empty.noPermission')}</p>
            )}
            {workspace.signBoq ? (
              <p className="text-caption text-muted-foreground">
                {t.rich('empty.boqNote', {
                  version: workspace.signBoq.versionNumber,
                  boq: (chunks) => (
                    <Link href={`/projects/${projectId}/boq`} className="font-medium text-brand-primary hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
          </div>
        }
      />
    );
  }

  if (active === 'landing') return <WorkspaceSkeleton label={t('loading')} />;

  const available = commercialTabsFor(contract.billingModel);

  return (
    <div className="space-y-4" data-commercial-root>
      <CommercialContextBar projectId={projectId} workspace={workspace} />
      <CommercialNav
        projectId={projectId}
        active={active}
        billingModel={contract.billingModel}
        billingCount={workspace.todo.length}
      />
      {!available.includes(active) ? (
        <EmptyState
          variant="page"
          title={t('applicationsHidden.title')}
          description={t('applicationsHidden.description')}
          action={
            <Button asChild variant="outline">
              <Link href={commercialTabHref(projectId, 'billing')}>{t('applicationsHidden.action')}</Link>
            </Button>
          }
        />
      ) : active === 'billing' ? (
        <CommercialBillingView projectId={projectId} workspace={workspace} />
      ) : active === 'contract' ? (
        <CommercialContractView projectId={projectId} workspace={workspace} />
      ) : (
        <ApplicationsView projectId={projectId} />
      )}
    </div>
  );
}

/** The IPA → IPC chain for a measured contract; unchanged, it still reads the summary. */
function ApplicationsView({ projectId }: { projectId: string }) {
  const summary = useCommercialSummary(projectId);
  if (!summary.data) return <Skeleton className="h-64 w-full" />;
  return <ApplicationsTab projectId={projectId} summary={summary.data} />;
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}

function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-16 w-full rounded-panel" aria-hidden="true" />
      <Skeleton className="h-10 w-64" aria-hidden="true" />
      <Skeleton className="h-64 w-full" aria-hidden="true" />
    </div>
  );
}
