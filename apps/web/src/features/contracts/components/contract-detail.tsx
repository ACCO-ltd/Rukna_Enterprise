'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { getContractActions } from '../contract-actions';
import { canEditTerms } from '../contract-terms';
import { useContract } from '../hooks/use-contracts';
import { AdvanceTermsPanel } from './advance-terms-panel';
import { ContractActionsPanel } from './contract-actions-panel';
import { ContractStatusBadge } from './contract-status-badge';
import { GuaranteesPanel } from './guarantees-panel';
import { MilestonesPanel } from './milestones-panel';
import { RetentionTermsPanel } from './retention-terms-panel';

import { IpaList } from '@/features/ipa/components/ipa-list';

export function ContractDetail({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.contracts.detail');
  const tContracts = useTranslations('platform.contracts');
  const tTerms = useTranslations('platform.contracts.terms');
  const tIpa = useTranslations('platform.ipa');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: contract, isPending, isError, error } = useContract(contractId);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-xl border border-border bg-muted"
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
          <Link href="/contracts">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const actions = getContractActions(contract);
  const termsEditable = canEditTerms(contract.status);
  const value = formatMoney(contract.contractValue, contract.currency, locale);
  const unset = <span className="italic font-normal text-muted-foreground/60">{tContracts('notSet')}</span>;

  const today = new Date().toISOString().slice(0, 10);

  const overviewRows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('client'),
      value: (
        <Link
          href={`/clients/${contract.client.id}`}
          className="underline-offset-4 hover:underline"
        >
          {contract.client.name}
        </Link>
      ),
    },
    {
      label: t('billingModel'),
      value: tContracts(`billingModel.${contract.billingModel}`),
    },
    { label: t('value'), value: value ?? unset },
    { label: t('startDate'), value: formatDate(contract.startDate, locale) ?? unset },
    { label: t('expectedEnd'), value: formatDate(contract.expectedEndDate, locale) ?? unset },
    {
      label: t('project'),
      value: (
        <Link
          href={`/projects/${contract.projectId}`}
          className="underline-offset-4 hover:underline"
        >
          {t('viewProject')}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Back link — outside the header card ─────────────────────────── */}
      <div className="mb-5">
        <Link
          href="/contracts"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:rounded"
        >
          <ChevronStartIcon />
          {t('back')}
        </Link>
      </div>

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          {/* Top row: contract number + badge ← → value */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium text-muted-foreground">
                {contract.contractNumber}
              </span>
              <ContractStatusBadge status={contract.status} />
            </div>
            {value ? (
              <span
                className="shrink-0 text-sm font-semibold tabular-nums text-foreground"
                title={t('value')}
              >
                {value}
              </span>
            ) : null}
          </div>

          {/* Client name as primary heading */}
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[28px]">
            {contract.client.name}
          </h1>

          {/* Billing model subtitle */}
          <p className="mt-1 text-sm text-muted-foreground">
            {tContracts(`billingModel.${contract.billingModel}`)}
          </p>
        </div>

        {actions.canEdit ? (
          <div className="mt-4 border-t border-border px-5 py-3 sm:px-6">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/contracts/${contract.id}/edit`}>{t('edit')}</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <ContractActionsPanel contract={contract} />

      <Tabs defaultValue="overview" className="rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-4 pt-2">
          <TabsTrigger value="overview">{tTerms('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="retention">{tTerms('tabs.retention')}</TabsTrigger>
          <TabsTrigger value="advances">{tTerms('tabs.advances')}</TabsTrigger>
          <TabsTrigger value="guarantees">{tTerms('tabs.guarantees')}</TabsTrigger>
          <TabsTrigger value="milestones">{tTerms('tabs.milestones')}</TabsTrigger>
          <TabsTrigger value="applications">{tIpa('short')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 p-4 sm:p-6">
          {!termsEditable ? <Alert variant="info" messages={[tTerms('lockedHint')]} /> : null}

          {/* Overview tile grid */}
          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-2 lg:grid-cols-3">
            {overviewRows.map((row) => (
              <div key={row.label} className="bg-surface px-5 py-4">
                <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                <dd className="mt-1.5 text-sm font-semibold text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          {/* Client snapshot — only meaningful once executed */}
          {contract.clientNameSnapshot ? (
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
              <div className="border-b border-border px-5 py-3 sm:px-6">
                <h2 className="text-[13px] font-semibold text-foreground">{t('snapshotHeading')}</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{t('snapshotHint')}</p>
              </div>
              <dl className="grid gap-px bg-border sm:grid-cols-2">
                <div className="bg-surface px-5 py-4">
                  <dt className="text-xs font-medium text-muted-foreground">{t('client')}</dt>
                  <dd className="mt-1.5 text-sm font-semibold text-foreground">{contract.clientNameSnapshot}</dd>
                </div>
                <div className="bg-surface px-5 py-4">
                  <dt className="text-xs font-medium text-muted-foreground">{t('taxNumber')}</dt>
                  <dd className="mt-1.5 text-sm font-semibold text-foreground" dir="ltr">
                    {contract.clientTaxSnapshot || unset}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="retention" className="p-4 sm:p-6">
          <RetentionTermsPanel
            contractId={contract.id}
            terms={contract.retentionTerms}
            canEdit={termsEditable}
          />
        </TabsContent>

        <TabsContent value="advances" className="p-4 sm:p-6">
          <AdvanceTermsPanel
            contractId={contract.id}
            terms={contract.advanceTerms}
            currency={contract.currency}
            canEdit={termsEditable}
          />
        </TabsContent>

        <TabsContent value="guarantees" className="p-4 sm:p-6">
          <GuaranteesPanel
            contractId={contract.id}
            guarantees={contract.guarantees}
            today={today}
            canEdit={termsEditable}
          />
        </TabsContent>

        <TabsContent value="milestones" className="p-4 sm:p-6">
          <MilestonesPanel
            contractId={contract.id}
            milestones={contract.milestones}
            today={today}
            canEdit={termsEditable}
          />
        </TabsContent>

        <TabsContent value="applications" className="p-4 sm:p-6">
          <IpaList contractId={contract.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
