'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * ViewSwitcher — a quiet segmented control for a *level-3 local view switch* inside a module
 * (ux-doctrine §5). It is deliberately NOT the underline `Tabs` treatment: level-2 module tabs
 * use an underline; a level-3 switcher uses a subtle-fill segmented control so the eye reads
 * "still inside this module, switching views" rather than "a second global tab bar."
 *
 * The selected segment is a subtle fill (`bg-surface` lifted off a `bg-muted` track) with the
 * accent as its text colour — the accent carries interactivity, not a loud filled background
 * (that treatment belongs to the one primary action per screen, §1). Unselected segments are
 * muted and take one background step on hover.
 *
 * Accessibility: it is a `tablist` of `tab` buttons with roving focus and ArrowLeft/ArrowRight
 * (plus Home/End) — the standard keyboard model for a horizontal, single-select switcher. Only
 * the selected tab is in the tab order; arrows move selection and focus together. The consumer
 * renders the active view itself (this control is presentational + selection state), so there is
 * no `tabpanel` wiring here; label the switched region separately if it needs one.
 *
 * At 375px the track scrolls horizontally inside itself rather than wrapping or pushing the page
 * (§8.2) — a level-3 switcher that wraps to two rows reads as a broken menu.
 */

export interface ViewSwitcherItem {
  value: string;
  label: string;
}

export interface ViewSwitcherProps {
  items: ViewSwitcherItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Names the switcher for assistive tech, e.g. "Progress views". */
  'aria-label': string;
  className?: string;
}

export function ViewSwitcher({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: ViewSwitcherProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function focusAt(index: number) {
    const clamped = (index + items.length) % items.length;
    const item = items[clamped];
    if (!item) return;
    refs.current[clamped]?.focus();
    onValueChange(item.value);
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      // A subtle track: no border, one background step below the surface. The segments carry
      // the structure. Scrolls horizontally at narrow widths instead of wrapping (§8.2).
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-muted p-1',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            // Roving tabindex: only the selected segment is tabbable; arrows reach the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'min-h-11 whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium',
              'transition-colors duration-(--motion-enter) ease-brand',
              'focus-visible:outline-none focus-visible:shadow-ring',
              selected
                ? // Subtle fill: the surface lifts off the track and the accent tints the label.
                  // Not a loud filled button — that treatment is reserved for the primary action.
                  'bg-surface text-brand-primary shadow-e1'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
