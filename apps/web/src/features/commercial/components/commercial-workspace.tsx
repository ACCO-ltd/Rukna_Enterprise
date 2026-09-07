'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';

import { useCommercialSummary } from '../hooks/use-commercial';
import { CommercialNav, commercialTabsFor, type CommercialTab } from './commercial-nav';
import { OverviewTab } from './overview-tab';
import { ContractSecurityTab } from './contract-security-tab';
import { ApplicationsTab } from './applications-tab';
import { VariationsTab } from './variations-tab';
import { BillingCollectionTab } from './billing-collection-tab';

/**
 * The Commercial workspace.
 *
 * It renders inside the project shell, which already states which project this is, what state it
 * is in, and the one project-level action that state calls for. So this used to be a *second*
 * header — a building icon, the project's contract number, its value, its client — stacked
 * directly under the first. It is now what the other refined workspaces are: a heading naming the
 * module, the level-3 view switch, and the active view. Contract identity reads on Contract &
 * Security, which is the section that owns it.
 *
 * Every financial figure and lifecycle verdict is the server's. The summary withholds money from
 * a user without `view:financial-position` and returns capabilities rather than a rule for the
 * browser to re-derive (ADR-017 CONST-COM).
 */
export function CommercialWorkspace({
  projectId,
  active,
}: {
  projectId: string;
  active: CommercialTab;
}) {
  const t = useTranslations('commercial');
  const tCommon = useTranslations('common');
  const query = useCommercialSummary(projectId);

  if (query.isPending) return <WorkspaceSkeleton label={tCommon('loading')} />;

  if (query.isError) {
    return (
      <div className="space-y-4">
        <Heading />
        <Alert
          variant="error"
          title={t('states.loadFailed')}
          messages={[errorText(query.error, t('states.loadFailedHint'))]}
        >
          <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
            {t('states.retry')}
          </Button>
        </Alert>
      </div>
    );
  }

  const summary = query.data;
  const billingModel = summary.mainContract?.billingModel ?? null;
  // A MILESTONE contract has no Applications view (ADR-023). Someone who deep-links or
  // back-buttons into it gets the explanation rather than a blank screen: the tab is gone
  // because this contract is billed from its payment plan, and the plan is one click away.
  const available = commercialTabsFor(billingModel);
  const resolved: CommercialTab = available.includes(active) ? active : 'overview';

  return (
    <div className="space-y-5" data-commercial-root>
      <Heading />
      <CommercialNav projectId={projectId} active={resolved} billingModel={billingModel} />

      <div>
        {!available.includes(active) ? (
          <UnavailableView projectId={projectId} />
        ) : (
          <>
            {active === 'overview' ? <OverviewTab projectId={projectId} summary={summary} /> : null}
            {active === 'contract-security' ? (
              <ContractSecurityTab projectId={projectId} summary={summary} />
            ) : null}
            {active === 'applications' ? (
              <ApplicationsTab projectId={projectId} summary={summary} />
            ) : null}
            {active === 'variations' ? (
              <VariationsTab projectId={projectId} summary={summary} />
            ) : null}
            {active === 'billing-collection' ? (
              <BillingCollectionTab projectId={projectId} summary={summary} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Module heading — the same shape Progress uses, so the two read as one product. No panel, no
 * icon tile, no restatement of the contract: the project shell above has already introduced the
 * record, and this only has to name the workspace and say what it is for.
 */
function Heading() {
  const t = useTranslations('commercial');
  return (
    <div>
      <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
      <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
    </div>
  );
}

function UnavailableView({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial');
  return (
    <EmptyState
      variant="page"
      title={t('applications.hiddenTitle')}
      description={t('applications.hiddenHint')}
      action={
        <Button asChild variant="outline">
          <Link href={`/projects/${projectId}/commercial/billing-collection`}>
            {t('applications.hiddenAction')}
          </Link>
        </Button>
      }
    />
  );
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}

function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-12 w-64" aria-hidden="true" />
      <Skeleton className="h-11 w-full" aria-hidden="true" />
      {/* Skeletons mirror the final layout: the position strip, the cycle card, then the body. */}
      <Skeleton className="h-24 w-full" aria-hidden="true" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" aria-hidden="true" />
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    </div>
  );
}
