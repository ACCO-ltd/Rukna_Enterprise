'use client';

import * as React from 'react';
import { cn } from '@erp/ui';

export interface QueueListItem {
  id: string;
  /** The bold first line — for a report queue, its date. */
  title: React.ReactNode;
  /**
   * The secondary line, already joined: "DPR-0415 · Amina Yusuf · WP-02 Frame, WP-03 Masonry".
   * Build it with `joinQueueMeta` so empty parts drop out instead of leaving stray separators.
   */
  meta?: React.ReactNode;
  /** Optional trailing element (a status pill, a count). Kept small — the row is the target. */
  trailing?: React.ReactNode;
}

export interface QueueListProps {
  items: QueueListItem[];
  /** Names the list for assistive tech, e.g. "Reports awaiting review". */
  label: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

/** Joins the non-empty parts of a queue row's secondary line with a middle dot. */
export function joinQueueMeta(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(' · ');
}

/**
 * A selectable queue — the left pane of a review split (reports awaiting review, milestones ready
 * to verify). Each row is a bold title over one secondary line; the selected row is highlighted.
 *
 * Listbox semantics with selection following focus: the list is one tab stop, ArrowUp/ArrowDown
 * move the selection (Home/End jump to the ends), and the active row is announced through
 * `aria-activedescendant`. Selecting a row is how the reader moves through the queue, so every
 * move selects — there is no separate "open" step.
 */
export function QueueList({ items, label, selectedId, onSelect, className }: QueueListProps) {
  const baseId = React.useId();
  const optionId = (id: string) => `${baseId}-${id}`;
  const listRef = React.useRef<HTMLUListElement>(null);

  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  function selectAt(index: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    const item = items[clamped];
    if (!item) return;
    onSelect(item.id);
    // Keep the newly selected row in view inside a scrolling pane.
    const node = listRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(optionId(item.id))}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectAt(selectedIndex < 0 ? 0 : selectedIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectAt(selectedIndex < 0 ? 0 : selectedIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        break;
      case 'End':
        event.preventDefault();
        selectAt(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selectedIndex >= 0 ? optionId(items[selectedIndex]!.id) : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'space-y-1 rounded-panel focus-visible:outline-none focus-visible:shadow-ring',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          // Clicks are handled on the option; keyboard lives on the listbox (one tab stop).
          <li
            key={item.id}
            id={optionId(item.id)}
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-panel border px-3 py-2.5 transition-colors duration-(--motion-enter) ease-brand',
              selected
                ? 'border-brand-accent-strong bg-brand-accent'
                : 'border-transparent hover:bg-surface-subtle',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-foreground">{item.title}</p>
              {item.meta ? (
                <p className="mt-0.5 truncate text-caption text-muted-foreground">{item.meta}</p>
              ) : null}
            </div>
            {item.trailing ? <div className="shrink-0">{item.trailing}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
