'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@erp/ui';
import type { CommercialSummaryResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import { resolveCommercialNextStep } from '../commercial-next-step';
import { useCommercialSummary } from '../hooks/use-commercial';
import { contractStatusTone } from '../presentation';
import { CommercialNav, type CommercialTab } from './commercial-nav';
import { OverviewTab } from './overview-tab';
import { MainContractTab } from './main-contract-tab';
import { ApplicationsTab } from './applications-tab';
import { RetentionAdvancesTab } from './retention-advances-tab';
import { GuaranteesTab } from './guarantees-tab';

/**
 * The Commercial workspace shell.
 *
 * Composition follows the Project Workspace: a header carrying the contract's identity and
 * the single context-aware primary action, the internal tab nav, then the active surface.
 * Every financial figure and lifecycle decision is the server's — the summary withholds
 * money from a user without `view:financial-position` and returns capabilities rather than
 * a rule to re-derive.
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
      <div className="space-y-3">
        <Header projectId={projectId} summary={null} />
        <CommercialNav projectId={projectId} active={active} />
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

  return (
    <div className="space-y-4" data-commercial-root>
      <Header projectId={projectId} summary={summary} />
      <CommercialNav projectId={projectId} active={active} />
      <div>
        {active === 'overview' ? <OverviewTab projectId={projectId} summary={summary} /> : null}
        {active === 'main-contract' ? <MainContractTab summary={summary} /> : null}
        {active === 'applications' ? <ApplicationsTab projectId={projectId} summary={summary} /> : null}
        {active === 'retention-advances' ? <RetentionAdvancesTab summary={summary} /> : null}
        {active === 'guarantees' ? <GuaranteesTab summary={summary} /> : null}
      </div>
    </div>
  );
}

function Header({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse | null;
}) {
  const t = useTranslations('commercial');
  const tStep = useTranslations('commercial.nextStep');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  // Exactly one primary action, resolved from the contract's own state rather than from
  // "whichever attention item happens to carry a URL" — that ordering made the button change
  // meaning as unrelated items appeared and disappeared. See commercial-next-step.ts.
  const step = summary ? resolveCommercialNextStep(summary, projectId) : null;
  const contract = summary?.mainContract ?? null;
  const value = contract && summary ? summary.metrics.contractValue : null;

  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-h2 font-bold text-foreground">{t('title')}</h1>
        <p className="text-body-sm text-muted-foreground">{t('subtitle')}</p>
        {contract ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            <span className="font-medium text-foreground">{contract.contractNumber}</span>
            <Badge tone={contractStatusTone(contract.status)}>
              {t(`contractStatus.${contract.status}`)}
            </Badge>
            {value && value.state !== 'RESTRICTED' && value.amount ? (
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(value.amount, value.currency, locale)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {step ? (
          <Button asChild size="sm" className="min-h-11 sm:min-h-0">
            <Link href={step.href}>{tStep(step.kind, { count: step.count ?? 0 })}</Link>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('actions.more')}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${projectId}`}>{t('actions.backToProject')}</Link>
            </DropdownMenuItem>
            {can('view:contract') ? (
              <DropdownMenuItem asChild>
                <Link href={`/projects/${projectId}/commercial/applications`}>
                  {t('actions.viewApplications')}
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}

function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-14 w-full" aria-hidden="true" />
      <Skeleton className="h-10 w-full" aria-hidden="true" />
      {/* Skeletons mirror the final layout: one summary band, then the two-column body. */}
      <Skeleton className="h-28 w-full" aria-hidden="true" />
      <Skeleton className="h-24 w-full" aria-hidden="true" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 w-full" aria-hidden="true" />
        <Skeleton className="h-80 w-full" aria-hidden="true" />
      </div>
    </div>
  );
}
