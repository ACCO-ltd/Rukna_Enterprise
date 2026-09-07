'use client';

import Link from 'next/link';
import type { CommercialSummaryResponse } from '@erp/types';
import { FileText, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';

import { EmptyState } from '@/components/empty-state';

import { CommercialActivity } from './commercial-activity';
import { ContractPositionBand, OtherCommercialItemsBand } from './contract-position';
import { CurrentPaymentCycle } from './current-payment-cycle';
import { PaymentPlanOrCertification } from './payment-plan-panel';
import { AttentionList, SectionCard } from './commercial-ui';

const TERMINAL = new Set(['CLOSED', 'CANCELLED', 'TERMINATED']);

/**
 * Commercial Overview — the project's revenue control centre.
 *
 * Reading order is the question a commercial manager actually arrives with: *what is this
 * contract worth and where has the money got to* (the position bands), then *what do I have to do
 * to get paid next* (the cycle card, the only primary action on the screen), then the plan behind
 * it, what needs attention, and what has been happening.
 *
 * Nothing here is computed in the browser. Every figure and every verdict arrives from
 * `GET /projects/:id/commercial/summary` and `/current-cycle`, which are the only things that can
 * be authoritative about money (ADR-017 CONST-COM). Cost, margin and forecast are deliberately
 * absent — that is Finance's job, and duplicating it here would create a second, drifting answer.
 */
export function OverviewTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const contract = summary.mainContract;

  if (!contract) return <NoContract summary={summary} />;

  const isTerminal = TERMINAL.has(contract.status);
  // Before the contract governs anything there is no revenue cycle to run, and four zeros would
  // describe a project that has failed to bill rather than one that has not started. Say what is
  // actually true and point at the step that changes it.
  const preActive = contract.status !== 'ACTIVE' && !isTerminal;

  return (
    <div className="space-y-4">
      {isTerminal ? <TerminalNotice status={contract.status} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ContractPositionBand summary={summary} projectId={projectId} />
        <OtherCommercialItemsBand summary={summary} projectId={projectId} />
      </div>

      {preActive ? <ContractNotYetActive projectId={projectId} status={contract.status} /> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {!preActive ? <CurrentPaymentCycle projectId={projectId} summary={summary} /> : null}
          <SectionCard title={t('overview.attention')}>
            <AttentionList items={summary.attention} />
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4">
          <PaymentPlanOrCertification projectId={projectId} summary={summary} />
          <CommercialActivity items={summary.recentActivity} />
        </div>
      </div>
    </div>
  );
}

/** A closed contract is a record. Say so once, at the top, rather than leaving the reader to
 *  infer it from actions that quietly are not there. */
function TerminalNotice({ status }: { status: string }) {
  const t = useTranslations('commercial');
  return (
    <div className="flex items-start gap-2.5 rounded-panel border border-historical/25 bg-historical-subtle px-4 py-3 sm:px-5">
      <Lock size={16} className="mt-0.5 shrink-0 text-historical" aria-hidden="true" />
      <div>
        <p className="text-body-sm font-semibold text-foreground">
          {t(`overview.terminal.${status}`)}
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">{t('overview.terminalHint')}</p>
      </div>
    </div>
  );
}

function ContractNotYetActive({ projectId, status }: { projectId: string; status: string }) {
  const t = useTranslations('commercial');
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <p className="text-body-sm font-semibold text-foreground">
          {t('overview.notActiveTitle', { status: t(`contractStatus.${status}`) })}
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">{t('overview.notActiveHint')}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-0">
        <Link href={`/projects/${projectId}/commercial/contract-security`}>
          {t('overview.notActiveAction')}
        </Link>
      </Button>
    </div>
  );
}

function NoContract({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial');
  const create = summary.attention.find((item) => item.kind === 'NO_MAIN_CONTRACT');
  return (
    <EmptyState
      variant="page"
      icon={<FileText size={25} strokeWidth={1.8} aria-hidden="true" />}
      title={t('overview.noContractTitle')}
      description={t('overview.noContractHint')}
      action={
        // One primary call to action and one only. `actionUrl` is null server-side when the user
        // cannot create a contract, so a disabled button is never rendered.
        create?.actionUrl ? (
          <Button asChild className="min-h-11 sm:min-h-0">
            <Link href={create.actionUrl}>{t('attention.NO_MAIN_CONTRACT.action')}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
