'use client';

import { ChevronsDownUp, ChevronsUpDown, FileUp, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, cn } from '@erp/ui';

import type { PricingFilter } from '../boq-rows';

/**
 * Search, filters, and the always-visible ways to add scope.
 *
 * The two creative actions a BOQ needs — **Add section** and **Import** — live here in the open,
 * not behind the header overflow: on an empty or new BOQ they are the whole job, and hiding them
 * is what made "how do I start?" a support question. Export moved the other way, into the header
 * overflow, because reading the BOQ out is a rare act next to building it. Both stay `outline`:
 * the status bar owns the one primary button (the contextual next step).
 */
export function BoqToolbar({
  search,
  onSearchChange,
  pricing,
  onPricingChange,
  allExpanded,
  onToggleExpandAll,
  onAddSection,
  onImport,
  canManage,
  canImport,
  hasVariations,
  resultCount,
  totalCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  pricing: PricingFilter;
  onPricingChange: (value: PricingFilter) => void;
  allExpanded: boolean;
  onToggleExpandAll: () => void;
  onAddSection: () => void;
  onImport: () => void;
  canManage: boolean;
  canImport: boolean;
  /** Whether any line was scoped in by a variation — gates the provenance filter (Phase 6). */
  hasVariations: boolean;
  resultCount: number;
  totalCount: number;
}) {
  const t = useTranslations('platform.boq.toolbar');
  const filtering = search.trim().length > 0 || pricing !== 'all';

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-2.5 lg:flex-row lg:items-center lg:justify-between">
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
          onChange={(value) => onPricingChange(value as PricingFilter)}
          className="w-auto"
        >
          <option value="all">{t('filter.all')}</option>
          <option value="incomplete">{t('filter.incomplete')}</option>
          <option value="priced">{t('filter.priced')}</option>
          <option value="sections">{t('filter.sections')}</option>
          <option value="items">{t('filter.items')}</option>
          {hasVariations ? (
            <>
              <option value="original">{t('filter.original')}</option>
              <option value="variations">{t('filter.variations')}</option>
            </>
          ) : null}
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

        {/* Outline, not primary — the status bar owns the one blue button. Add section and
            Import are peers, always visible so starting a BOQ is never a hunt. */}
        {canManage ? (
          <Button variant="outline" size="sm" className={cn('gap-2')} onClick={onAddSection}>
            <Plus size={15} aria-hidden="true" />
            {t('addSection')}
          </Button>
        ) : null}

        {canImport ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={onImport}>
            <FileUp size={15} aria-hidden="true" />
            {t('import')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
