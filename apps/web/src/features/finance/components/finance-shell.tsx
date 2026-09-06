'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookOpen, LayoutDashboard, LineChart, Wallet } from 'lucide-react';
import { cn } from '@erp/ui';

/**
 * The project Finance workspace shell.
 *
 * Four views, named for the question each answers rather than for the read model behind it:
 * Overview (can I trust these numbers, and what do they say), Cost Control (what did we plan and
 * where is it going), Profit & Loss (what did the accounts recognise), Ledger (show me the
 * postings). The tab used to be a single Project Actual P&L, which is a subset presented as the
 * whole.
 */
const VIEWS = [
  { key: 'overview', segment: '', icon: LayoutDashboard },
  { key: 'costControl', segment: 'cost-control', icon: Wallet },
  { key: 'profitLoss', segment: 'profit-loss', icon: LineChart },
  { key: 'ledger', segment: 'ledger', icon: BookOpen },
] as const;

export function FinanceShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('finance.shell');
  const pathname = usePathname();
  const base = `/projects/${projectId}/finance`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Horizontally scrollable at 375px rather than wrapping into two rows, so the workspace
          header keeps a fixed height on mobile. */}
      <nav aria-label={t('title')} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border px-1">
          {VIEWS.map((view) => {
            const href = view.segment ? `${base}/${view.segment}` : base;
            const active = view.segment
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === base || pathname === `${base}/`;
            const Icon = view.icon;
            return (
              <li key={view.key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-body-sm font-medium transition-colors',
                    active
                      ? 'border-brand-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  {t(`views.${view.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
