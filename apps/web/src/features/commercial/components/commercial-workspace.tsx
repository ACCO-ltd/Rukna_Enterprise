'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';

import { useCommercialSummary } from '../hooks/use-commercial';
import {
  CommercialNav,
  commercialLandingTab,
  commercialTabHref,
  commercialTabsFor,
  type CommercialTab,
} from './commercial-nav';
import { ContractSecurityTab } from './contract-security-tab';
import { ApplicationsTab } from './applications-tab';
import { PaymentScheduleTab } from './payment-schedule-tab';
import { VariationsTab } from './variations-tab';
import { BillingCollectionTab } from './billing-collection-tab';

/**
 * The old `/commercial` (Overview) route no longer has a tab of its own (S-SH-5). A page hitting
 * it passes `active="overview"` and the workspace resolves the real landing tab — Payment Schedule
 * for a MILESTONE contract, Contract otherwise — and replaces the URL with it, so a bookmark or a
 * stale link never dead-ends on a retired view.
 */
type WorkspaceIntent = CommercialTab | 'overview';

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
  active: WorkspaceIntent;
}) {
  const t = useTranslations('commercial');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const query = useCommercialSummary(projectId);

  const billingModel = query.data?.mainContract?.billingModel ?? null;
  const hasContract = query.data?.mainContract != null;

  // The retired Overview route lands here as `active="overview"` and is bounced to the real landing
  // tab once the summary tells us the billing model. The redirect runs in an effect (not during
  // render) so it never fires against half-loaded data. The skeleton below covers the interim.
  const isOverviewRedirect = active === 'overview';
  const landing = commercialLandingTab(billingModel, hasContract);
  useEffect(() => {
    if (isOverviewRedirect && query.isSuccess) {
      router.replace(commercialTabHref(projectId, landing));
    }
  }, [isOverviewRedirect, query.isSuccess, router, projectId, landing]);

  if (query.isPending || isOverviewRedirect) {
    return <WorkspaceSkeleton label={tCommon('loading')} />;
  }

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
  // A MILESTONE contract has no Applications view (ADR-023). Someone who deep-links or
  // back-buttons into it gets the explanation rather than a blank screen: the tab is gone
  // because this contract is billed from its payment plan, and the plan is one click away.
  const available = commercialTabsFor(billingModel);
  const tab = active as CommercialTab;
  const resolved: CommercialTab = available.includes(tab) ? tab : landing;

  return (
    <div className="space-y-5" data-commercial-root>
      <Heading />
      <CommercialNav projectId={projectId} active={resolved} billingModel={billingModel} />

      <div>
        {!available.includes(tab) ? (
          <UnavailableView projectId={projectId} />
        ) : (
          <>
            {tab === 'contract-security' ? (
              <ContractSecurityTab projectId={projectId} summary={summary} />
            ) : null}
            {tab === 'applications' ? (
              <ApplicationsTab projectId={projectId} summary={summary} />
            ) : null}
            {tab === 'payment-schedule' ? (
              <PaymentScheduleTab projectId={projectId} summary={summary} />
            ) : null}
            {tab === 'variations' ? (
              <VariationsTab projectId={projectId} summary={summary} />
            ) : null}
            {tab === 'billing-collection' ? (
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
