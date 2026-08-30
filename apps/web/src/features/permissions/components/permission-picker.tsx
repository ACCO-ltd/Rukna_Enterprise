'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Input } from '@erp/ui';

import { permissionKey, type PermissionCatalogueItem } from '../api/permissions-api';
import { usePermissionsCatalogue } from '../hooks/use-permissions-catalogue';

interface PermissionPickerProps {
  /** Currently-selected permission ids. */
  selectedIds: string[];
  /** Called with the next full set of selected ids. */
  onChange: (next: string[]) => void;
  /** Disable every control while a mutation is in flight. */
  disabled?: boolean;
}

/** Groups a flat catalogue into resource → items, resources ordered alphabetically. */
function groupByResource(
  items: PermissionCatalogueItem[],
): { resource: string; items: PermissionCatalogueItem[] }[] {
  const byResource = new Map<string, PermissionCatalogueItem[]>();
  for (const item of items) {
    const bucket = byResource.get(item.resource);
    if (bucket) bucket.push(item);
    else byResource.set(item.resource, [item]);
  }
  return [...byResource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, group]) => ({
      resource,
      items: group.slice().sort((a, b) => a.action.localeCompare(b.action)),
    }));
}

function matches(item: PermissionCatalogueItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${permissionKey(item)} ${item.description ?? ''}`.toLocaleLowerCase();
  return haystack.includes(query);
}

/**
 * Searchable, resource-grouped multi-select over the permission catalogue.
 *
 * Selection is by permission id (what the API expects); the visible key is the
 * `action:resource` string the rest of the platform speaks in.
 */
export function PermissionPicker({ selectedIds, onChange, disabled }: PermissionPickerProps) {
  const t = useTranslations('platform.roles.permissions');
  const tCommon = useTranslations('common');
  const searchId = useId();
  const [query, setQuery] = useState('');

  const { data, isPending, isError } = usePermissionsCatalogue();

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const normalisedQuery = query.trim().toLocaleLowerCase();

  const groups = useMemo(() => {
    const filtered = (data ?? []).filter((item) => matches(item, normalisedQuery));
    return groupByResource(filtered);
  }, [data, normalisedQuery]);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  function toggleResource(items: PermissionCatalogueItem[], allSelected: boolean) {
    if (disabled) return;
    const next = new Set(selected);
    for (const item of items) {
      if (allSelected) next.delete(item.id);
      else next.add(item.id);
    }
    onChange([...next]);
  }

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-56 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={searchId} className="text-sm font-medium text-foreground">
          {t('label')}
        </label>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t('selectedCount', { count: selected.size })}
        </span>
      </div>

      <Input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
        disabled={disabled}
      />

      <div className="max-h-72 space-y-4 overflow-y-auto rounded-panel border border-border bg-surface p-3">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('noMatches')}</p>
        ) : (
          groups.map(({ resource, items }) => {
            const allSelected = items.every((item) => selected.has(item.id));
            return (
              <fieldset key={resource} className="space-y-1.5">
                <legend className="flex w-full items-center justify-between gap-2 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {resource}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleResource(items, allSelected)}
                    disabled={disabled}
                    className="rounded-control text-xs font-medium text-brand-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring disabled:pointer-events-none disabled:opacity-50"
                  >
                    {allSelected ? t('clearGroup') : t('selectGroup')}
                  </button>
                </legend>

                {items.map((item) => {
                  const key = permissionKey(item);
                  const checked = selected.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control px-2 py-1.5 hover:bg-surface-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item.id)}
                        disabled={disabled}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-brand-primary focus-visible:shadow-ring"
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-foreground">{key}</span>
                        {item.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })
        )}
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(data ?? [])
            .filter((item) => selected.has(item.id))
            .map((item) => (
              <Badge key={item.id} tone="info">
                {permissionKey(item)}
              </Badge>
            ))}
        </div>
      ) : null}
    </div>
  );
}
