'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { FinancePortfolioRow } from '@erp/types';
import { Combobox, StatusPill, type ComboboxOption } from '@erp/ui';

import { useFinancePortfolio } from '../hooks';
import { financeProjectRedirects } from '../redirects';
import { needsActionLabels } from './finance-projects-list';

/**
 * Where the picker sends the reader for another project: the same view they are on (Billing stays
 * Billing, Transactions keeps its `?view=`), never a record of the old project — an invoice page
 * falls back to its view, without the record's query.
 */
export function switchProjectHref(pathname: string, fromId: string, toId: string, search = ''): string {
  const prefix = financeProjectRedirects.overview(fromId);
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const segments = rest.split('/').filter(Boolean);
  const target = segments[0] ? `${financeProjectRedirects.overview(toId)}/${segments[0]}` : financeProjectRedirects.overview(toId);
  // The query belongs to the view only when the reader is on the view itself, not on a record in it.
  const query = segments.length <= 1 && search ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `${target}${query}`;
}

/**
 * The Finance project switcher (ADR-043): one control instead of "back to the list, find the
 * next project". It reads the portfolio only once it is opened — a project page reads one project
 * until the reader asks for the others. Search matches the name and code.
 */
export function FinanceProjectPicker({ project }: { project: FinancePortfolioRow }) {
  const t = useTranslations('finance.projects.workspace.picker');
  const tNeeds = useTranslations('finance.projects.needs');
  const router = useRouter();
  const pathname = usePathname() ?? financeProjectRedirects.overview(project.projectId);
  const search = useSearchParams()?.toString() ?? '';
  const [wanted, setWanted] = useState(false);
  const portfolio = useFinancePortfolio({}, { enabled: wanted });

  const toOption = (row: FinancePortfolioRow): ComboboxOption => {
    const needs = needsActionLabels(row, tNeeds as unknown as Parameters<typeof needsActionLabels>[1]);
    return {
      value: row.projectId,
      // Name and code are what the filter matches; the client reads on the line under them.
      label: `${row.name} · ${row.code}`,
      caption: row.clientName ?? undefined,
      meta: needs.length > 0 ? <StatusPill tone={needs[0]!.tone}>{t('needsAction')}</StatusPill> : undefined,
    };
  };
  // Until the list arrives the current project is the only option, so the trigger reads it.
  const options = portfolio.data ? portfolio.data.items.map(toOption) : [toOption(project)];

  return (
    <div className="w-full min-w-0 sm:w-[24rem]" onPointerDownCapture={() => setWanted(true)} onFocusCapture={() => setWanted(true)}>
      <Combobox
        id="finance-project-picker"
        aria-label={t('label')}
        value={project.projectId}
        onChange={(next) => {
          if (next && next !== project.projectId) router.push(switchProjectHref(pathname, project.projectId, next, search));
        }}
        options={options}
        renderValue={() => (
          <span className="font-semibold">
            {project.name} <span className="font-normal text-muted-foreground">· {project.code}</span>
          </span>
        )}
        placeholder={t('label')}
        searchPlaceholder={t('search')}
        emptyLabel={t('empty')}
        loading={wanted && portfolio.isPending}
        loadingLabel={t('loading')}
        panelClassName="min-w-[min(28rem,calc(100vw-2rem))]"
      />
    </div>
  );
}
