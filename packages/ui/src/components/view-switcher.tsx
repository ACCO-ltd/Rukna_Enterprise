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
 * Two modes, same look:
 * - **Button mode** (default): a `tablist` of `tab` buttons with roving focus and
 *   ArrowLeft/ArrowRight (plus Home/End) — the standard keyboard model for a horizontal,
 *   single-select switcher. Only the selected tab is in the tab order; arrows move selection
 *   and focus together. Use when the active view is client-side state.
 * - **Link mode** (pass `renderLink`): each view is a real URL (deep-linkable). Rendered as a
 *   `<nav>` of links via the router-agnostic `renderLink` prop (same pattern `StatTile`/
 *   `MetricStrip` use so `@erp/ui` stays router-free). No `tablist`/roving here — a route nav
 *   is a `<nav>` of links in normal Tab order, and the ARIA must match the mode: a `tablist`
 *   must contain `tab` buttons, not anchors. The consumer sets `aria-current="page"` on the
 *   active link.
 *
 * The consumer renders the active view itself (this control is presentational + selection
 * state), so there is no `tabpanel` wiring here; label the switched region separately if needed.
 *
 * At 375px the track scrolls horizontally inside itself rather than wrapping or pushing the page
 * (§8.2) — a level-3 switcher that wraps to two rows reads as a broken menu.
 */

// Shared classes so button mode and link mode can never visually drift apart.
// A subtle track: no border, one background step below the surface. The segments carry the
// structure. Scrolls horizontally at narrow widths instead of wrapping (§8.2).
const TRACK_CLASS =
  'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-muted p-1';

// The per-segment shape, shared by both the `<button>` and the `renderLink` anchor.
const SEGMENT_BASE_CLASS = cn(
  'min-h-11 whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium',
  'transition-colors duration-(--motion-enter) ease-brand',
  'focus-visible:outline-none focus-visible:shadow-ring',
);

// Subtle fill: the surface lifts off the track and the accent tints the label. Not a loud
// filled button — that treatment is reserved for the one primary action per screen.
const SEGMENT_SELECTED_CLASS = 'bg-surface text-brand-primary shadow-e1';
const SEGMENT_UNSELECTED_CLASS =
  'text-muted-foreground hover:bg-surface-hover hover:text-foreground';

function segmentClass(selected: boolean): string {
  return cn(SEGMENT_BASE_CLASS, selected ? SEGMENT_SELECTED_CLASS : SEGMENT_UNSELECTED_CLASS);
}

export interface ViewSwitcherItem {
  value: string;
  label: string;
  /** In link mode, the destination URL for this view (deep-linkable). Ignored in button mode. */
  href?: string;
}

export interface ViewSwitcherProps {
  items: ViewSwitcherItem[];
  value: string;
  /** Required in button mode (state-driven). Not used in link mode. */
  onValueChange?: (value: string) => void;
  /**
   * Router-agnostic link renderer. When provided, the switcher renders in **link mode**: a
   * `<nav>` of links instead of a `tablist` of buttons. The consumer supplies the router `Link`
   * (e.g. next/link) and sets `aria-current="page"` on the active item. Same pattern as
   * `StatTile`/`MetricStrip`, keeping `@erp/ui` router-free.
   */
  renderLink?: (props: {
    href: string;
    active: boolean;
    className: string;
    children: React.ReactNode;
    key: string;
  }) => React.ReactNode;
  /** Names the switcher for assistive tech, e.g. "Progress views". */
  'aria-label': string;
  className?: string;
}

export function ViewSwitcher({
  items,
  value,
  onValueChange,
  renderLink,
  'aria-label': ariaLabel,
  className,
}: ViewSwitcherProps) {
  // ─── Link mode ────────────────────────────────────────────────────────────
  // Each view is a URL. A route nav is a <nav> of links in normal Tab order — no tablist,
  // no roving focus. The consumer's renderLink carries aria-current="page" on the active link.
  if (renderLink) {
    return (
      <nav aria-label={ariaLabel} className={cn(TRACK_CLASS, className)}>
        {items.map((item) => {
          const active = item.value === value;
          return renderLink({
            href: item.href ?? '#',
            active,
            className: segmentClass(active),
            children: item.label,
            key: item.value,
          });
        })}
      </nav>
    );
  }

  // ─── Button mode ──────────────────────────────────────────────────────────
  return (
    <ButtonSwitcher
      items={items}
      value={value}
      onValueChange={onValueChange}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}

function ButtonSwitcher({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: {
  items: ViewSwitcherItem[];
  value: string;
  onValueChange?: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function focusAt(index: number) {
    const clamped = (index + items.length) % items.length;
    const item = items[clamped];
    if (!item) return;
    refs.current[clamped]?.focus();
    onValueChange?.(item.value);
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
      className={cn(TRACK_CLASS, className)}
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
            onClick={() => onValueChange?.(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={segmentClass(selected)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
