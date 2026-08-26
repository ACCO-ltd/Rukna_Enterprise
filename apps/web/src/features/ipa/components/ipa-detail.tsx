'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow, SectionHeader } from '@erp/ui';
import { CaretLeftIcon } from '@phosphor-icons/react';

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
  const contract = useContract(contractId);

  if (ipa.isPending || contract.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-container border border-border bg-muted"
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
    <div className="space-y-6">
      {/* ── Back link — outside the header card ─────────────────────────── */}
      <div className="mb-5">
        <Link
          href={`/contracts/${contractId}`}
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:rounded"
        >
          <CaretLeftIcon size={14} aria-hidden="true" />
          {t('back')}
        </Link>
      </div>

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-container border border-border bg-surface shadow-e1">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6 pb-5 sm:pb-6">
          {/* Reference + status */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              {ipa.data.applicationRef ?? tIpa('unnumbered')}
            </span>
            <IpaStatusBadge status={ipa.data.status} />
          </div>

          {/* Net payable as primary figure */}
          <h1 className="mt-2 text-h1 font-bold leading-tight text-foreground">
            <bdi>{formatMoney(ipa.data.netPayable, currency, locale)}</bdi>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('netHeading')}</p>

          {ipa.data.applicationRef === null ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{t('numberedOnApproval')}</p>
          ) : null}
        </div>
      </div>

      <IpaActionsPanel ipa={ipa.data} contractId={contractId} />

      {/* ── Summary ─────────────────────────────────────────────────────────
          Mixed key-value facts on a hairline definition list, not headline
          numbers on tiles. The net payable is the header figure and is not
          restated here. */}
      <section aria-labelledby="ipa-summary-heading">
        <SectionHeader id="ipa-summary-heading" title={t('summary')} />
        <DefinitionList className="mt-3">
          <DefinitionRow label={t('grossHeading')} numeric>
            <bdi className="tabular-nums">
              {formatMoney(ipa.data.totalPeriodAmount, currency, locale)}
            </bdi>
          </DefinitionRow>
          <DefinitionRow label={t('deductionsHeading')} numeric>
            <bdi className="tabular-nums">
              {formatMoney(ipa.data.totalDeductions, currency, locale)}
            </bdi>
          </DefinitionRow>
          <DefinitionRow label={t('period')}>
            {from && to ? `${from} – ${to}` : (from ?? to ?? t('noPeriod'))}
          </DefinitionRow>
          <DefinitionRow label={t('contract')}>
            <Link href={`/contracts/${contractId}`} className="underline-offset-4 hover:underline">
              {contract.data.contractNumber}
            </Link>
          </DefinitionRow>
        </DefinitionList>
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

      <IpcListPanel applicationId={ipa.data.id} contractId={contractId} currency={currency} />
    </div>
  );
}
