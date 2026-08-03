'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { useContracts } from '../hooks/use-contracts';
import { ContractStatusBadge } from './contract-status-badge';

/**
 * The project side of the hybrid navigation: a project manager works project-first and
 * needs to see what is contracted without learning that Contracts is a separate menu.
 *
 * Deliberately a summary rather than a second full list — the filtering, searching and
 * table live at `/contracts`, and duplicating them here would mean two implementations of
 * the same screen drifting apart. This lists the contracts and links out.
 */
export function ProjectContractsSection({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.contracts.projectSection');
  const tContracts = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data, isPending, isError } = useContracts(projectId);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        <div className="flex gap-2">
          {data && data.length > 0 ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/contracts">{t('viewAll')}</Link>
            </Button>
          ) : null}
          <Button size="sm" asChild>
            <Link href="/contracts/new">{t('add')}</Link>
          </Button>
        </div>
      </div>

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-24 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[tContracts('loadFailed')]} />
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {data.map((contract) => (
            <li key={contract.id}>
              <Link
                href={`/contracts/${contract.id}`}
                className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {contract.contractNumber}
                  </span>
                  <ContractStatusBadge status={contract.status} />
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {formatMoney(contract.contractValue, contract.currency, locale) ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
