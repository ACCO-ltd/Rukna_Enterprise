'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * ViewSwitcher — a *level-3 local view switch* inside a module (ux-doctrine §5), in one of two
 * appearances.
 *
 * **`segmented`** (default) is the quiet subtle-fill control §5 describes: level-2 module tabs use
 * an underline, so a segmented level-3 reads as "still inside this module, switching views" rather
 * than "a second global tab bar."
 *
 * **`underline`** was added for Progress on the owner's instruction (2026-09-05). It is the same
 * treatment as the level-2 tabs and therefore needs its own separation, which it gets from three
 * things: a shorter row (44px against 48px), `font-medium` against `font-semibold`, and an icon on
 * the **active tab only** rather than on every tab. That last one is not decoration — it is a
 * second, non-colour signal of "you are here", alongside the underline and `aria-selected`.
 *
 * Opt in per call site. Commercial stays segmented; changing that is a separate decision.
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
  'min-h-control whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium',
  'transition-colors duration-(--motion-enter) ease-brand',
  'focus-visible:outline-none focus-visible:shadow-ring',
);

// Subtle fill: the surface lifts off the track and the accent tints the label. Not a loud
// filled button — that treatment is reserved for the one primary action per screen.
const SEGMENT_SELECTED_CLASS = 'bg-surface text-brand-primary shadow-e1';
const SEGMENT_UNSELECTED_CLASS =
  'text-muted-foreground hover:bg-surface-hover hover:text-foreground';

// The underline appearance. `-mb-px` pulls each segment's own bottom border onto the track's
// hairline, so the active indicator sits *on* the rule rather than under it.
const UNDERLINE_TRACK_CLASS =
  'flex max-w-full items-center gap-1 overflow-x-auto border-b border-border';

const UNDERLINE_BASE_CLASS = cn(
  '-mb-px inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3',
  'text-body-sm font-medium',
  'transition-colors duration-(--motion-enter) ease-brand',
  'focus-visible:outline-none focus-visible:shadow-ring',
);

const UNDERLINE_SELECTED_CLASS = 'border-brand-primary text-brand-primary';
const UNDERLINE_UNSELECTED_CLASS =
  'border-transparent text-muted-foreground hover:text-foreground';

export type ViewSwitcherAppearance = 'segmented' | 'underline';

function trackClass(appearance: ViewSwitcherAppearance): string {
  return appearance === 'underline' ? UNDERLINE_TRACK_CLASS : TRACK_CLASS;
}

function segmentClass(selected: boolean, appearance: ViewSwitcherAppearance = 'segmented'): string {
  if (appearance === 'underline') {
    return cn(
      UNDERLINE_BASE_CLASS,
      selected ? UNDERLINE_SELECTED_CLASS : UNDERLINE_UNSELECTED_CLASS,
    );
  }
  return cn(SEGMENT_BASE_CLASS, selected ? SEGMENT_SELECTED_CLASS : SEGMENT_UNSELECTED_CLASS);
}

/**
 * The label, with the item's glyph in front of it when it is the active view.
 *
 * Only when active, and only in the underline appearance: the icon is what tells the eye which
 * tab is current without relying on the accent colour. Rendering one on every tab would put this
 * row a hair away from the level-2 project tabs it sits directly beneath.
 */
function segmentContent(item: ViewSwitcherItem, selected: boolean, appearance: ViewSwitcherAppearance) {
  if (appearance !== 'underline' || !selected || !item.icon) return item.label;
  return (
    <>
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {item.icon}
      </span>
      {item.label}
    </>
  );
}

export interface ViewSwitcherItem {
  value: string;
  label: string;
  /** In link mode, the destination URL for this view (deep-linkable). Ignored in button mode. */
  href?: string;
  /**
   * A single glyph, shown before the label **only while this view is active** and only in the
   * `underline` appearance. Rendered `aria-hidden` — the label is the name.
   */
  icon?: React.ReactNode;
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
  /** Defaults to `segmented`. See the note at the top of this file before choosing `underline`. */
  appearance?: ViewSwitcherAppearance;
  className?: string;
}

export function ViewSwitcher({
  items,
  value,
  onValueChange,
  renderLink,
  'aria-label': ariaLabel,
  appearance = 'segmented',
  className,
}: ViewSwitcherProps) {
  // ─── Link mode ────────────────────────────────────────────────────────────
  // Each view is a URL. A route nav is a <nav> of links in normal Tab order — no tablist,
  // no roving focus. The consumer's renderLink carries aria-current="page" on the active link.
  if (renderLink) {
    return (
      <nav aria-label={ariaLabel} className={cn(trackClass(appearance), className)}>
        {items.map((item) => {
          const active = item.value === value;
          return renderLink({
            href: item.href ?? '#',
            active,
            className: segmentClass(active, appearance),
            children: segmentContent(item, active, appearance),
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
      appearance={appearance}
      className={className}
    />
  );
}

function ButtonSwitcher({
  items,
  value,
  onValueChange,
  ariaLabel,
  appearance,
  className,
}: {
  items: ViewSwitcherItem[];
  value: string;
  onValueChange?: (value: string) => void;
  ariaLabel: string;
  appearance: ViewSwitcherAppearance;
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
      className={cn(trackClass(appearance), className)}
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
            className={segmentClass(selected, appearance)}
          >
            {segmentContent(item, selected, appearance)}
          </button>
        );
      })}
    </div>
  );
}
