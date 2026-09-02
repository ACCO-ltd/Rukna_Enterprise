'use client';

import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Input, LtrValue, Skeleton, cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import type { BoqLibraryItem } from '../api/boq-item-library-api';
import { useLibrarySearch } from '../hooks/use-boq-item-library';

/**
 * "Add from library" — the fast-entry path (ADR-020 CONST-BOQ-020).
 *
 * A searchable list of reusable work items. Picking one hands the item back to the drawer,
 * which prefills the new BOQ line (description, unit, measurement method, and the *last-used
 * rate* as assistance). This is an **additional** path: a plain manual add is untouched, and
 * the picker only appears when adding a new item and the user has commercial visibility to see
 * the assistive rate.
 *
 * Search is server-backed (`GET /boq-item-library?q=`), debounced so it fires on a settled
 * query rather than every keystroke. On < sm the drawer is full screen, so the list simply
 * flows in the drawer's own scroll region — it is not an overlay that could be clipped.
 */
export function BoqLibraryPicker({
  currency,
  canViewCommercials,
  onPick,
}: {
  currency: string;
  canViewCommercials: boolean;
  onPick: (item: BoqLibraryItem) => void;
}) {
  const t = useTranslations('platform.boq.library');
  const locale = useLocale() as 'en' | 'ar';
  const listId = useId();

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);

  const { data, isPending, isError } = useLibrarySearch(debounced, true);
  const items = data ?? [];

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          className="ps-10"
        />
      </div>

      {isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : isPending ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">{t('searching')}</span>
          <Skeleton className="h-12 w-full" aria-hidden="true" />
          <Skeleton className="h-12 w-full" aria-hidden="true" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-control border border-dashed border-border px-3 py-6 text-center text-caption text-muted-foreground">
          {debounced.trim() ? t('noMatches') : t('empty')}
        </p>
      ) : (
        <ul id={listId} role="listbox" className="max-h-64 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onPick(item)}
                className={cn(
                  'flex min-h-11 w-full flex-col items-start gap-0.5 rounded-control border border-border px-3 py-2 text-start',
                  'hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <LtrValue className="font-mono text-caption text-muted-foreground">
                    {item.code}
                  </LtrValue>
                  <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-foreground">
                    {item.description}
                  </span>
                </span>
                <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                  {item.defaultUnit ? <span>{item.defaultUnit}</span> : null}
                  {item.category ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.category}</span>
                    </>
                  ) : null}
                  {/* The last-used rate is assistance only, never authoritative — labelled so a
                      surveyor treats it as a starting point, not a quote (CONST-BOQ-021). */}
                  {canViewCommercials && item.lastUsedRate ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <LtrValue className="tabular-nums">
                        {t('lastRate', {
                          rate: formatMoney(item.lastUsedRate, currency, locale) ?? '—',
                        })}
                      </LtrValue>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption text-muted-foreground">{t('assistanceNote')}</p>
    </section>
  );
}

/** Debounces a changing value so the search fires on a settled query, not every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return settled;
}
