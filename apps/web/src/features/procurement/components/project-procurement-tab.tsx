'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Coins, ExternalLink, LayoutDashboard, ClipboardList } from 'lucide-react';
import { Button, ViewSwitcher } from '@erp/ui';

import { ProcurementOverviewView } from './project/procurement-overview-view';
import { RequirementsView } from './project/requirements-view';
import { CostCommitmentsView } from './project/cost-commitments-view';

export type ProjectProcurementView = 'overview' | 'requirements' | 'cost';

/**
 * Project Procurement (Phase 5).
 *
 * The boundary this tab implements: **the organisation owns supplier documents; the project owns
 * the cost coded onto their lines.** `PurchaseOrder` carries no `projectId` — the cost target
 * lives on `PurchaseOrderLine` and is inherited read-only downstream — because one order
 * legitimately buys cement for three sites. So there is no PO authoring here, no goods-receipt
 * queue, no bill or payment operation. Those are the buyer's, at `/procurement/*`, and this tab
 * links out to them rather than duplicating a second workflow to keep in step with the first.
 *
 * Three views, answering three questions: what have we committed and consumed, what does the site
 * need, and where is the money going against the scope we priced. Deliberately not five — a tab
 * per document type would be exactly the project-filtered clone of the buyer's application this
 * design exists to avoid.
 */
export function ProjectProcurementTab({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.project');
  const [view, setView] = useState<ProjectProcurementView>('overview');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {/* Where the rest of procurement lives. Stated once, at the top, rather than as a dashed
            box at the bottom of every view. */}
        <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
          <Link href="/procurement/orders">
            {t('openProcurement')}
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* Underline, matching Progress and Commercial: the same level-3 control everywhere, with a
          glyph on the active view only as a non-colour signal of where you are. */}
      <ViewSwitcher
        appearance="underline"
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProjectProcurementView)}
        items={[
          {
            value: 'overview',
            label: t('tabs.overview'),
            icon: <LayoutDashboard size={16} strokeWidth={1.9} />,
          },
          {
            value: 'requirements',
            label: t('tabs.requirements'),
            icon: <ClipboardList size={16} strokeWidth={1.9} />,
          },
          { value: 'cost', label: t('tabs.cost'), icon: <Coins size={16} strokeWidth={1.9} /> },
        ]}
      />

      <div data-project-procurement-root>
        {view === 'overview' ? (
          <ProcurementOverviewView projectId={projectId} onGoTo={setView} />
        ) : null}
        {view === 'requirements' ? <RequirementsView projectId={projectId} /> : null}
        {view === 'cost' ? <CostCommitmentsView projectId={projectId} /> : null}
      </div>
    </div>
  );
}
