'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Button } from '@erp/ui';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';

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
    <div className="space-y-6">
      <WorkspaceSectionHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
            {/* The buyer's workspace, already narrowed to this project's orders. */}
            <Link href={`/procurement/orders?projectId=${projectId}`}>
              {t('openProcurement')}
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <WorkspaceSubNav
        label={t('navLabel')}
        items={tabs.map((tab) => ({ value: tab.key, label: tab.label, href: tab.href }))}
      />

      {/* Tab content */}
      <div data-project-procurement-root>{children}</div>
    </div>
  );
}
