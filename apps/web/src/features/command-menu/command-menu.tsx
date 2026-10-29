'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { cn, Dialog, DialogContent, DialogTitle } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';

import {
  buildCommandEntries,
  filterCommandEntries,
  type CommandEntry,
  type CommandGroup,
} from './command-items';
import { closeCommandMenu, useCommandMenuOpen } from './command-menu-store';
import { recordHref, useRecordSearch } from './record-search';
import { formatMoney } from '@/lib/format';

/**
 * The ⌘K command menu — a keyboard-first jump-to-anything palette.
 *
 * Records first (Step 2f, ADR-047): `GET /search` returns the invoices, bills, payments, receipts,
 * journals, projects, clients and suppliers matching the typed text that the caller may open.
 * Then actions — the registry of create actions, plus, when a client matches, "New sale invoice
 * for …" and "Record receipt from …" — then the nav map. Everything is permission-filtered.
 *
 * Mounted once in the shell. Opened by the top-bar chip or the global Cmd/Ctrl+K listener,
 * both via `command-menu-store`.
 */
export function CommandMenu() {
  const open = useCommandMenuOpen();

  // Radix mounts the content only while open; remounting resets the query and highlight,
  // which is the behaviour we want each time the menu is summoned.
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeCommandMenu())}>
      {open ? <CommandMenuBody /> : null}
    </Dialog>
  );
}

const GROUP_ORDER: CommandGroup[] = ['record', 'action', 'goTo'];

function CommandMenuBody() {
  const t = useTranslations('platform');
  const router = useRouter();
  const { can, moduleVisible } = usePermissions();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [rawActiveIndex, setRawActiveIndex] = useState(0);

  const entries = useMemo(
    () => buildCommandEntries({ can, moduleVisible }, (key) => t(key)),
    [can, moduleVisible, t],
  );
  const search = useRecordSearch(query);
  const tSearch = useTranslations('platform.commandMenu.search');
  const records = useMemo<CommandEntry[]>(() => {
    const hits = query.trim().length >= 2 ? (search.data?.records ?? []) : [];
    return hits.map((record) => ({
      id: `record-${record.kind}-${record.id}`,
      group: 'record',
      label: record.title,
      href: recordHref(record),
      kindLabel: tSearch(`kind.${record.kind}`),
      detail: [
        record.detail,
        record.amount && record.currencyCode ? formatMoney(record.amount, record.currencyCode, 'en') : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
  }, [search.data, query, tSearch]);
  // A matched client (or a record tied to one) offers the two things done for a client most.
  const contextual = useMemo<CommandEntry[]>(() => {
    const hits = query.trim().length >= 2 ? (search.data?.records ?? []) : [];
    const client = hits.find((r) => r.kind === 'CLIENT');
    if (!client) return [];
    const out: CommandEntry[] = [];
    if (can('manage:receivable')) {
      out.push({
        id: `ctx-invoice-${client.id}`,
        group: 'action',
        label: tSearch('newSaleFor', { name: client.title }),
        href: `/finance/accounting/invoices/new/sale?clientId=${client.id}`,
      });
    }
    if (can('create:receipt') || can('manage:receivable')) {
      out.push({
        id: `ctx-receipt-${client.id}`,
        group: 'action',
        label: tSearch('receiptFrom', { name: client.title }),
        href: `/receipts/new?clientId=${client.id}`,
      });
    }
    return out;
  }, [search.data, query, can, tSearch]);
  const results = useMemo(
    () => [...records, ...contextual, ...filterCommandEntries(entries, query)],
    [records, contextual, entries, query],
  );

  // The stored index may drift past the end as the result set shrinks; clamp on read rather
  // than in an effect, which avoids a cascading render (and its lint rule) entirely.
  const activeIndex = results.length === 0 ? 0 : Math.min(rawActiveIndex, results.length - 1);

  // Autofocus the input when the menu opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activate = (entry: CommandEntry | undefined) => {
    if (!entry) return;
    closeCommandMenu();
    router.push(entry.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setRawActiveIndex(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setRawActiveIndex(results.length === 0 ? 0 : (activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(results[activeIndex]);
    }
  };

  // Group the flat result list for rendering while keeping a single global index for the
  // active-descendant highlight and keyboard traversal.
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: results
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.group === group),
  })).filter((section) => section.items.length > 0);

  const activeId = results[activeIndex]?.id;

  return (
    <DialogContent
      className="top-[12vh] max-h-[76dvh] gap-0 overflow-hidden p-0 sm:top-[12vh] sm:max-w-xl sm:translate-y-0"
      onKeyDown={onKeyDown}
      aria-label={t('commandMenu.title')}
    >
      <DialogTitle className="sr-only">{t('commandMenu.title')}</DialogTitle>

      {/* Type-ahead */}
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-menu-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRawActiveIndex(0);
          }}
          placeholder={t('commandMenu.placeholder')}
          className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {query.trim().length >= 2 && search.isFetching && records.length === 0 ? (
        <p className="px-4 pt-3 text-caption text-muted-foreground" role="status">
          {tSearch('searching')}
        </p>
      ) : null}

      {/* Results */}
      <ul id="command-menu-list" role="listbox" className="max-h-[52dvh] overflow-y-auto py-2">
        {results.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground" role="presentation">
            {t('commandMenu.empty')}
          </li>
        ) : (
          grouped.map((section) => (
            <li key={section.group} role="presentation">
              <p className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                {t(
                  section.group === 'goTo'
                    ? 'commandMenu.goTo'
                    : section.group === 'record'
                      ? 'commandMenu.records'
                      : 'commandMenu.actions',
                )}
              </p>
              <ul role="presentation">
                {section.items.map(({ entry, index }) => (
                  <CommandRow
                    key={entry.id}
                    entry={entry}
                    active={index === activeIndex}
                    onSelect={() => activate(entry)}
                    onHover={() => setRawActiveIndex(index)}
                    query={query}
                  />
                ))}
              </ul>
            </li>
          ))
        )}
      </ul>

      <p className="border-t border-border px-4 py-2 text-micro text-muted-foreground">
        {t('commandMenu.hint')}
      </p>
    </DialogContent>
  );
}

/** The typed text marked inside a label, case-insensitively — what made this row match. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning-subtle text-foreground">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function CommandRow({
  entry,
  active,
  onSelect,
  onHover,
  query,
}: {
  entry: CommandEntry;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  query: string;
}) {
  if (entry.group === 'record') {
    return (
      <li role="presentation">
        <button
          type="button"
          id={entry.id}
          role="option"
          aria-selected={active}
          onClick={onSelect}
          onMouseMove={onHover}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 text-start transition-colors',
            active ? 'bg-brand-accent' : 'hover:bg-muted/60',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-semibold text-foreground">
              <Highlight text={entry.label} query={query} />
            </span>
            {entry.detail ? (
              <span className="block truncate text-caption text-muted-foreground">
                <Highlight text={entry.detail} query={query} />
              </span>
            ) : null}
          </span>
          {entry.kindLabel ? <span className="shrink-0 text-caption text-muted-foreground">{entry.kindLabel}</span> : null}
        </button>
      </li>
    );
  }
  return (
    <li role="presentation">
      <button
        type="button"
        id={entry.id}
        role="option"
        aria-selected={active}
        onClick={onSelect}
        onMouseMove={onHover}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-2 text-start text-sm transition-colors',
          active ? 'bg-brand-accent text-brand-primary' : 'text-foreground hover:bg-muted/60',
        )}
      >
        <span className="truncate font-medium">{entry.label}</span>
        {entry.context ? (
          <span className="truncate text-xs text-muted-foreground">· {entry.context}</span>
        ) : null}
      </button>
    </li>
  );
}
