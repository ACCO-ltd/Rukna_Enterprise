'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Button, cn } from '@erp/ui';

/**
 * Sub-shell for the project procurement workspace.
 *
 * Wraps Overview, Requests and Purchases with a shared header and underline tab nav. Each tab is
 * a real Next.js route so it is bookmarkable, middle-clickable, and has its own URL.
 *
 * The header row states what this workspace is and offers a single escape hatch to the buyer's
 * cross-project workspace — the project owns requirements and cost tracking here, not purchasing
 * operations, and the link names the distinction rather than obscuring it.
 */
export function ProcurementSubShell({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const t = useTranslations('procurement.project');
  const pathname = usePathname();

  const tabs = [
    {
      key: 'overview',
      href: `/projects/${projectId}/procurement/overview`,
      label: t('tabs.overview'),
    },
    {
      key: 'requests',
      href: `/projects/${projectId}/procurement/requests`,
      label: t('tabs.requests'),
    },
    {
      key: 'purchases',
      href: `/projects/${projectId}/procurement/purchases`,
      label: t('tabs.purchases'),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header row: workspace identity + escape-hatch to buyer workspace */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
          <Link href="/procurement/orders">
            {t('openProcurement')}
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* Underline tab nav — identical visual contract to WorkspaceTabs desktop row */}
      <nav aria-label={t('navLabel')}>
        <div className="flex gap-0 border-b border-border">
          {tabs.map((tab) => {
            const isActive =
              pathname.endsWith(`/procurement/${tab.key}`) ||
              pathname.includes(`/procurement/${tab.key}/`);
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  'flex min-h-11 items-center px-4 py-2 text-body-sm font-medium transition-colors',
                  'border-b-2 -mb-px',
                  isActive
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Tab content */}
      <div data-project-procurement-root>{children}</div>
    </div>
  );
}
