'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { useContract } from '@/features/contracts/hooks/use-contracts';
import { IpcListPanel } from '@/features/ipc/components/ipc-list-panel';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useIpa } from '../hooks/use-ipa';
import { getIpaActions } from '../ipa-actions';
import { IpaActionsPanel } from './ipa-actions-panel';
import { IpaDeductionsPanel } from './ipa-deductions-panel';
import { IpaItemsPanel } from './ipa-items-panel';
import { IpaStatusBadge } from './ipa-status-badge';

export function IpaDetail({ contractId, ipaId }: { contractId: string; ipaId: string }) {
  const t = useTranslations('platform.ipa.detail');
  const tIpa = useTranslations('platform.ipa');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const ipa = useIpa(ipaId);
  // The contract supplies the BOQ version the line picker reads from, the currency, and
  // the retention and advance rates the deduction form is checked against.
  const contract = useContract(contractId);

  if (ipa.isPending || contract.isPending) {
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

  if (ipa.isError || contract.isError) {
    const notFound = ipa.error instanceof ApiError && ipa.error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href={`/contracts/${contractId}`}>{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const actions = getIpaActions(ipa.data);
  const currency = contract.data.currency;
  const from = formatDate(ipa.data.periodFrom, locale);
  const to = formatDate(ipa.data.periodTo, locale);

  return (
    <div className="space-y-8">
      <div>
        {/* `inline-flex min-h-11` rather than bare text: a standalone navigation link is a
            touch target, and at 18px it failed the 44px rule the same way table rows did
            before c8afdd6. The height is invisible on a pointer device. */}
        <Link
          href={`/contracts/${contractId}`}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {ipa.data.applicationRef ?? tIpa('unnumbered')}
              </span>
              <IpaStatusBadge status={ipa.data.status} />
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              <bdi>{formatMoney(ipa.data.netPayable, currency, locale)}</bdi>
            </h1>
            <p className="text-sm text-muted-foreground">{t('netHeading')}</p>
            {/* Explains the missing reference above rather than leaving it looking broken. */}
            {ipa.data.applicationRef === null ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('numberedOnApproval')}</p>
            ) : null}
          </div>
        </div>
      </div>

      <IpaActionsPanel ipa={ipa.data} contractId={contractId} />

      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('period')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {from && to ? `${from} – ${to}` : (from ?? to ?? t('noPeriod'))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('grossHeading')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(ipa.data.totalPeriodAmount, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('deductionsHeading')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi>{formatMoney(ipa.data.totalDeductions, currency, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('contract')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              <Link
                href={`/contracts/${contractId}`}
                className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
              >
                {contract.data.contractNumber}
              </Link>
            </dd>
          </div>
        </dl>
      </section>

      <IpaItemsPanel
        ipaId={ipa.data.id}
        items={ipa.data.items}
        projectId={contract.data.projectId}
        boqVersionId={contract.data.boqVersionId}
        canEdit={actions.canEditLines}
      />

      <IpaDeductionsPanel
        ipaId={ipa.data.id}
        deductions={ipa.data.deductions}
        periodTotal={ipa.data.totalPeriodAmount}
        currency={currency}
        contract={contract.data}
        canEdit={actions.canEditLines}
      />

      {/* What this application was actually certified at. Last because it is the outcome of
          everything above it, and because an application is read top-down: what was claimed,
          what was deducted, then what came back. */}
      <IpcListPanel applicationId={ipa.data.id} contractId={contractId} currency={currency} />
    </div>
  );
}
