'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Input, ViewSwitcher } from '@erp/ui';

export type LineFilter = 'all' | 'unpriced';

/**
 * Find and narrow — nothing else. Adding and importing moved to where they happen (the grid's
 * "+ Add" lines, the bar's overflow), so this row only answers "which lines am I looking at?".
 *
 * Two views instead of the old seven-way dropdown: every line, or the unpriced ones — the only
 * narrowing the next step depends on. Search matches code and description; a matching line keeps
 * its parent sections visible (see `buildRows`).
 */
export function BoqToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  unpricedCount,
  showFilter,
  onExpandAll,
  onCollapseAll,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: LineFilter;
  onFilterChange: (value: LineFilter) => void;
  unpricedCount: number;
  /** Money-blind readers cannot see what is priced, so the filter would be a riddle. */
  showFilter: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const t = useTranslations('platform.boq.toolbar');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="relative w-full min-w-0 sm:w-72">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          className="ps-10"
        />
      </div>

      {showFilter ? (
        <ViewSwitcher
          aria-label={t('filterLabel')}
          value={filter}
          onValueChange={(value) => onFilterChange(value as LineFilter)}
          items={[
            { value: 'all', label: t('allLines') },
            { value: 'unpriced', label: t('unpriced', { count: unpricedCount }) },
          ]}
        />
      ) : null}

      <div className="ms-auto flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" className="text-brand-primary" onClick={onExpandAll}>
          {t('expandAll')}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-brand-primary" onClick={onCollapseAll}>
          {t('collapseAll')}
        </Button>
      </div>
    </div>
  );
}
