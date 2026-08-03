'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import type { Project } from '@/features/projects/types';
import { formatDate, formatMoney } from '@/lib/format';

export function RecentProjects({ projects }: { projects: Project[] }) {
  const t = useTranslations('platform.dashboard');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <section aria-labelledby="recent-projects-heading">
      <h2
        id="recent-projects-heading"
        className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t('recentHeading')}
      </h2>

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {projects.map((project) => {
          // Arabic readers see the Arabic name when the project has one; otherwise the
          // canonical name, never an empty cell.
          const displayName = locale === 'ar' && project.nameAr ? project.nameAr : project.name;
          const value = formatMoney(project.contractValue, project.currency, locale);
          const created = formatDate(project.createdAt, locale);

          return (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex min-h-16 flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-foreground">{displayName}</p>
                  {project.clientName ? (
                    <p className="truncate text-xs text-muted-foreground">{project.clientName}</p>
                  ) : null}
                </div>

                <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0.5">
                  {/* An absent contract value is labelled, not shown as 0.00 — a project
                      awaiting pricing is not a project worth nothing. */}
                  <span className="text-sm font-semibold text-foreground">
                    {value ?? (
                      <span className="font-normal text-muted-foreground">
                        {t('noContractValue')}
                      </span>
                    )}
                  </span>
                  {created ? (
                    <span className="text-xs text-muted-foreground">{created}</span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
