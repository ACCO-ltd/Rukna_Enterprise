'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import type { Project } from '@/features/projects/types';
import { formatDate, formatMoney } from '@/lib/format';

interface PortfolioTableWidgetProps {
  projects: Project[];
}

export function PortfolioTableWidget({ projects }: PortfolioTableWidgetProps) {
  const t = useTranslations('platform.dashboard');
  const locale = useLocale() as 'en' | 'ar';

  if (projects.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full min-w-0 text-sm">
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t('colProject')}
            </th>
            <th
              scope="col"
              className="hidden px-4 py-3 text-start text-xs font-semibold uppercase tracking-widest text-muted-foreground sm:table-cell"
            >
              {t('colClient')}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t('colStatus')}
            </th>
            <th
              scope="col"
              className="hidden px-4 py-3 text-end text-xs font-semibold uppercase tracking-widest text-muted-foreground md:table-cell"
            >
              {t('colValue')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {projects.map((project) => {
            const displayName =
              locale === 'ar' && project.nameAr ? project.nameAr : project.name;
            const value = formatMoney(project.contractValue, project.currency, locale);
            const created = formatDate(project.createdAt, locale);

            return (
              <tr
                key={project.id}
                className="transition-colors hover:bg-surface-subtle"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/projects/${project.id}`}
                    className="group block focus-visible:outline-none"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {project.code}
                    </span>
                    <p className="mt-0.5 font-medium text-foreground group-hover:text-brand-primary group-focus-visible:underline">
                      {displayName}
                    </p>
                    {created ? (
                      <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                        {project.clientName ?? t('noContractValue')}
                      </p>
                    ) : null}
                  </Link>
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {project.clientName ?? (
                    <span className="text-muted-foreground/50">{t('noContractValue')}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ProjectStatusBadge status={project.status} />
                </td>
                <td className="hidden px-4 py-3 text-end tabular-nums text-foreground md:table-cell">
                  {value ?? (
                    <span className="text-muted-foreground">{t('noContractValue')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
