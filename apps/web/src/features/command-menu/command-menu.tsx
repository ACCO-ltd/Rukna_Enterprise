'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { cn, Dialog, DialogContent, DialogTitle } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';

import {
  buildCommandEntries,
  filterCommandEntries,
  type CommandEntry,
  type CommandGroup,
} from './command-items';
import { closeCommandMenu, useCommandMenuOpen } from './command-menu-store';

/**
 * The ⌘K command menu — a keyboard-first jump-to-anything palette.
 *
 * Client-side only: it navigates the existing nav map and a registry of primary create
 * actions, both permission-filtered exactly as the sidebar filters itself. There is no
 * record-search group — no search endpoint exists, and the honesty rule (ux-doctrine §4)
 * forbids advertising it.
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

const GROUP_ORDER: CommandGroup[] = ['goTo', 'action'];

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
  const results = useMemo(() => filterCommandEntries(entries, query), [entries, query]);

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
        <MagnifyingGlassIcon size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
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
                {t(section.group === 'goTo' ? 'commandMenu.goTo' : 'commandMenu.actions')}
              </p>
              <ul role="presentation">
                {section.items.map(({ entry, index }) => (
                  <CommandRow
                    key={entry.id}
                    entry={entry}
                    active={index === activeIndex}
                    onSelect={() => activate(entry)}
                    onHover={() => setRawActiveIndex(index)}
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

function CommandRow({
  entry,
  active,
  onSelect,
  onHover,
}: {
  entry: CommandEntry;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
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
