'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { getContractActions } from '../contract-actions';
import { useContract } from '../hooks/use-contracts';
import { ContractActionsPanel } from './contract-actions-panel';
import { ContractStatusBadge } from './contract-status-badge';

export function ContractDetail({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.contracts.detail');
  const tContracts = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: contract, isPending, isError, error } = useContract(contractId);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
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
  const value = formatMoney(contract.contractValue, contract.currency, locale);
  const unset = <span className="text-muted-foreground">{tContracts('notSet')}</span>;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/contracts"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {contract.contractNumber}
              </span>
              <ContractStatusBadge status={contract.status} />
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {value ?? contract.contractNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tContracts(`billingModel.${contract.billingModel}`)}
            </p>
          </div>

          {actions.canEdit ? (
            <Button variant="outline" asChild>
              <Link href={`/contracts/${contract.id}/edit`}>{t('edit')}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <ContractActionsPanel contract={contract} />

      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">{t('overview')}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('client')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              <Link
                href={`/clients/${contract.client.id}`}
                className="underline-offset-4 hover:underline"
              >
                {contract.client.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('project')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              <Link
                href={`/projects/${contract.projectId}`}
                className="underline-offset-4 hover:underline"
              >
                {t('viewProject')}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('boqVersion')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {/* No endpoint expands boqVersionId — the column has no Prisma relation, so
                  nothing returns the version number. Linking to the project's BOQ is the
                  closest honest thing to offer. */}
              <Link
                href={`/projects/${contract.projectId}/boq`}
                className="underline-offset-4 hover:underline"
              >
                {t('viewBoq')}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('value')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">{value ?? unset}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('startDate')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(contract.startDate, locale) ?? unset}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('expectedEnd')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(contract.expectedEndDate, locale) ?? unset}
            </dd>
          </div>
        </dl>
      </section>

      {/* Only meaningful once executed — before that the snapshots are null, and showing
          empty rows would suggest data is missing rather than not yet taken. */}
      {contract.clientNameSnapshot ? (
        <section className="rounded-lg border border-border bg-surface-subtle p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">{t('snapshotHeading')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('snapshotHint')}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t('client')}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{contract.clientNameSnapshot}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('taxNumber')}</dt>
              <dd className="mt-0.5 text-sm text-foreground" dir="ltr">
                {contract.clientTaxSnapshot || unset}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
