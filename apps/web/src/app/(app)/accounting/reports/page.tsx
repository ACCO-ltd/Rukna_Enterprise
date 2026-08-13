import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';

const REPORTS = [
  {
    key: 'trialBalance' as const,
    href: '/finance/accounting/trial-balance',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  {
    key: 'profitLoss' as const,
    href: '/finance/accounting/profit-loss',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
        <polyline points="17,6 23,6 23,12" />
      </svg>
    ),
  },
  {
    key: 'balanceSheet' as const,
    href: '/finance/accounting/balance-sheet',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    key: 'monthlyComparison' as const,
    href: '/finance/accounting/monthly-comparison',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    key: 'accountLedger' as const,
    href: '/finance/accounting/ledger',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
  },
] as const;

export default async function AccountingReportsPage() {
  const t = await getTranslations('platform.accountingReportsPage');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        breadcrumbs={[{ label: 'Accounting', href: '/accounting' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Link
            key={report.key}
            href={report.href}
            className="group flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] hover:border-brand-primary/40 hover:shadow-[var(--shadow-panel),0_0_0_3px_color-mix(in_srgb,var(--color-brand-primary)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          >
            <div className="flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-primary/8 text-brand-primary transition-colors group-hover:bg-brand-primary/14">
                {report.icon}
              </span>
              <span className="flex h-7 w-7 shrink-0 translate-x-1 items-center justify-center rounded-md text-muted-foreground/40 transition-[color,transform] group-hover:translate-x-0 group-hover:text-brand-primary" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </div>

            <div>
              <p className="text-[14px] font-semibold text-foreground">
                {t(report.key)}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {t(`${report.key}Desc`)}
              </p>
            </div>

            <span className="mt-auto text-[12px] font-medium text-brand-primary opacity-0 transition-opacity group-hover:opacity-100">
              {t('open')} →
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
