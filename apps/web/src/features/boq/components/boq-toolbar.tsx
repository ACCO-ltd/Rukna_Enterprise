'use client';

import { ChevronsDownUp, ChevronsUpDown, Download, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, cn } from '@erp/ui';

import type { PricingFilter } from '../boq-rows';

/**
 * Search, filters and the row-adding entry point.
 *
 * Import is deliberately absent, not disabled. It needs ACCO's real workbook to define a
 * column mapping, and a greyed-out control that never becomes available is a worse answer
 * than no control — it invites a support question every time someone sees it. See ADR-016.
 */
export function BoqToolbar({
  search,
  onSearchChange,
  pricing,
  onPricingChange,
  allExpanded,
  onToggleExpandAll,
  onExport,
  onAddSection,
  canManage,
  resultCount,
  totalCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  pricing: PricingFilter;
  onPricingChange: (value: PricingFilter) => void;
  allExpanded: boolean;
  onToggleExpandAll: () => void;
  onExport: () => void;
  onAddSection: () => void;
  canManage: boolean;
  resultCount: number;
  totalCount: number;
}) {
  const t = useTranslations('platform.boq.toolbar');
  const filtering = search.trim().length > 0 || pricing !== 'all';

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-initial">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="ps-10 sm:w-64"
          />
        </div>

        <Select
          value={pricing}
          aria-label={t('filterLabel')}
          onChange={(event) => onPricingChange(event.target.value as PricingFilter)}
          className="w-auto"
        >
          <option value="all">{t('filter.all')}</option>
          <option value="incomplete">{t('filter.incomplete')}</option>
          <option value="priced">{t('filter.priced')}</option>
          <option value="sections">{t('filter.sections')}</option>
          <option value="items">{t('filter.items')}</option>
        </Select>

        {/* Only meaningful while a filter narrows the list — otherwise it restates the
            row count the grid footer already gives. */}
        {filtering ? (
          <span className="text-caption text-muted-foreground">
            {t('matching', { count: resultCount, total: totalCount })}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-2" onClick={onToggleExpandAll}>
          {allExpanded ? (
            <ChevronsDownUp size={15} aria-hidden="true" />
          ) : (
            <ChevronsUpDown size={15} aria-hidden="true" />
          )}
          {allExpanded ? t('collapseAll') : t('expandAll')}
        </Button>

        <Button variant="outline" size="sm" className="gap-2" onClick={onExport}>
          <Download size={15} aria-hidden="true" />
          {t('export')}
        </Button>

        {canManage ? (
          <Button size="sm" className={cn('gap-2')} onClick={onAddSection}>
            <Plus size={15} aria-hidden="true" />
            {t('addSection')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
