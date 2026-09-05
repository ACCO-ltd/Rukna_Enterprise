'use client';

import { useTranslations } from 'next-intl';
import { cn, RecordPanel } from '@erp/ui';
import { Layers } from 'lucide-react';

import { useProjectRollup } from '../hooks/use-progress';

/**
 * Where the project's percentage actually comes from: each work package, its share of the whole,
 * and how far it has got.
 *
 * The headline figure is `Σ(weight × package %)`, so this table is that sum written out. Somebody
 * asking "why is the project at 43%?" gets the answer by reading down it, which is the difference
 * between a number and a number you can act on.
 *
 * There is no "vs plan" column. The planned baseline (`GET …/programme/targets`) is a project-level
 * curve of cumulative percentages — nothing in it is per work package, so a package cannot be
 * behind its plan because it does not have one. The reference design shows the column; the data
 * does not exist for it, and a fabricated one on the screen that explains the headline would be
 * the worst place in the product to invent a number.
 */
export function WorkPackageProgressPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const rollup = useProjectRollup(projectId);

  const packages = rollup.data?.packages ?? [];

  return (
    <RecordPanel
      title={t('packages.title')}
      icon={<Layers size={17} strokeWidth={1.9} />}
      meta={t('packages.noVsPlan')}
      padded={false}
    >
      {rollup.isPending ? (
        <div className="m-4 h-32 animate-pulse rounded-control bg-muted" aria-hidden="true" />
      ) : packages.length === 0 ? (
        <p className="px-4 py-8 text-center text-caption text-muted-foreground">
          {t('packages.empty')}
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-start text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t('packages.workPackage')}
              </th>
              <th className="w-20 px-2 py-2 text-end text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t('packages.weight')}
              </th>
              <th className="w-1/2 px-4 py-2 text-start text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t('packages.progress')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {packages.map((wp) => (
              <tr key={wp.id}>
                <td className="px-4 py-3">
                  <span className="block truncate text-body-sm font-medium text-foreground">
                    {wp.name}
                  </span>
                  <span className="block truncate font-mono text-caption text-muted-foreground">
                    {wp.code}
                  </span>
                </td>
                <td className="px-2 py-3 text-end text-body-sm tabular-nums text-muted-foreground">
                  {Math.round(Number(wp.weight) * 100)}%
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      {/* One colour. A package is not "good" at 80% and "bad" at 20% — it is
                          simply further along, and without a per-package plan there is nothing
                          to be ahead or behind of. Colouring by magnitude would be inventing a
                          judgement the data cannot support. */}
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          wp.percentComplete >= 100 ? 'bg-success' : 'bg-brand-primary',
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, wp.percentComplete))}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-end text-body-sm font-medium tabular-nums text-foreground">
                      {wp.percentComplete}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </RecordPanel>
  );
}
