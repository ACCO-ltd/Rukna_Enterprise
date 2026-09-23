'use client';

import { useTranslations } from 'next-intl';
import { Layers } from 'lucide-react';

import { useProjectRollup } from '../hooks/use-progress';
import { RefBar, RefCard, RefCardHeader } from './ref-ui';

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
    <RefCard>
      <RefCardHeader
        icon={<Layers size={17} strokeWidth={1.9} />}
        title={t('packages.title')}
        subtitle={t('packages.noVsPlan')}
        divider
      />
      {rollup.isPending ? (
        <div className="m-5 h-32 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
      ) : packages.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">{t('packages.empty')}</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-2.5 text-start text-xs font-medium text-gray-500">
                {t('packages.workPackage')}
              </th>
              <th className="w-20 px-2 py-2.5 text-end text-xs font-medium text-gray-500">
                {t('packages.weight')}
              </th>
              <th className="w-1/2 px-5 py-2.5 text-start text-xs font-medium text-gray-500">
                {t('packages.progress')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {packages.map((wp) => (
              <tr key={wp.id}>
                <td className="px-5 py-3">
                  <span className="block truncate text-sm font-medium text-gray-900">{wp.name}</span>
                  <span className="block truncate font-mono text-xs text-gray-500">{wp.code}</span>
                </td>
                <td className="px-2 py-3 text-end text-sm tabular-nums text-gray-500">
                  {Math.round(Number(wp.weight) * 100)}%
                </td>
                <td className="px-5 py-3">
                  {/* Schedule-only phases (no BOQ scope) have no derived %, so there is nothing to
                      bar — show a dash, never a misleading 0%. */}
                  {wp.percentComplete === null ? (
                    <span className="text-sm text-gray-400">—</span>
                  ) : (
                    <RefBar percent={wp.percentComplete} tone={wp.percentComplete >= 100 ? 'green' : 'blue'} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </RefCard>
  );
}
