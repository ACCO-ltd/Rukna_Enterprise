'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { formatDate } from '@/lib/format';

import { useIpas } from '../hooks/use-ipa';
import { IpaStatusBadge } from './ipa-status-badge';

/**
 * Payment applications for one contract.
 *
 * Deliberately scoped: an application only means anything against the contract it bills,
 * so there is no top-level `/applications` route and no cross-contract list. `GET /ipa`
 * accepts `contractId`, which is the one filter that matters here.
 *
 * The list shows no money. `GET /ipa` returns bare rows — the totals are computed per
 * request on the DETAIL endpoint only — so showing a net payable here would mean one
 * detail fetch per row. That is a real cost for a figure the user can reach in one click.
 */
export function IpaList({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.ipa');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data, isPending, isError } = useIpas(contractId);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <Button size="sm" asChild>
          <Link href={`/contracts/${contractId}/applications/new`}>{t('newApplication')}</Link>
        </Button>
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
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {data.map((application) => {
            const from = formatDate(application.periodFrom, locale);
            const to = formatDate(application.periodTo, locale);

            return (
              <li key={application.id}>
                <Link
                  href={`/contracts/${contractId}/applications/${application.id}`}
                  className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {/* An application has no number until it is approved for submission —
                        say so rather than rendering an empty cell. */}
                    <span className="font-mono text-xs text-muted-foreground">
                      {application.applicationRef ?? t('unnumbered')}
                    </span>
                    <IpaStatusBadge status={application.status} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {from && to ? `${from} – ${to}` : (from ?? to ?? t('detail.noPeriod'))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
