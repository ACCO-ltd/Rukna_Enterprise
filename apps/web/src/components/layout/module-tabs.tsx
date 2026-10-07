'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
} from '@erp/ui';
import { ChevronDown } from 'lucide-react';

import { guardedNavigate } from '@/lib/use-unsaved-changes-guard';

import type { ModuleTab } from './module-nav';
import { badgeKeysIn, NavCount, useNavBadgeCounts, type NavBadgeCounts } from './nav-badges';

interface ModuleTabsProps {
  tabs: ModuleTab[];
  /** Names the <nav>, e.g. "Accounting sections". */
  navLabel: string;
}

const TAB_CLASS =
  'inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-3 text-body-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary';
const TAB_ACTIVE = 'border-brand-primary text-foreground';
const TAB_IDLE = 'border-transparent text-muted-foreground hover:text-foreground';

/** Width kept free for the More trigger when tabs overflow. */
const MORE_RESERVE = 88;

/**
 * A module's tab bar (ADR-035).
 *
 * A tab with one page is a link; a tab with several is a click-to-open dropdown. When the bar
 * is too narrow the trailing tabs collapse into "More" — there is no sideways scrolling, which
 * hid later tabs with nothing saying they were there. Below 560px the whole bar becomes one
 * "Section: Tab › Page" picker, the honest control at phone width.
 *
 * The tabs arrive already permission-filtered (`moduleTabs`): an item a user cannot open is
 * removed, never shown disabled.
 */
export function ModuleTabs({ tabs, navLabel }: ModuleTabsProps) {
  const t = useTranslations('platform');
  const router = useRouter();
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(tabs.length);

  const measure = useCallback(() => {
    const row = rowRef.current;
    const ruler = measureRef.current;
    if (!row || !ruler) return;
    const widths = Array.from(ruler.children).map((el) => (el as HTMLElement).offsetWidth);
    const available = row.clientWidth;
    const total = widths.reduce((a, b) => a + b, 0);
    if (total <= available) {
      setFit(widths.length);
      return;
    }
    let used = 0;
    let count = 0;
    for (const w of widths) {
      if (used + w > available - MORE_RESERVE) break;
      used += w;
      count += 1;
    }
    setFit(Math.max(1, count));
  }, []);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, tabs]);

  const counts = useNavBadgeCounts(badgeKeysIn(tabs));
  const label = (key: string) => t(`nav.${key}`);
  /** Plain-text count suffix for the phone picker, whose options cannot hold a pill. */
  const countSuffix = (badge: keyof NavBadgeCounts | undefined) => {
    const count = badge ? counts[badge] : null;
    return count ? ` (${count})` : '';
  };
  const shown = tabs.slice(0, fit);
  const overflow = tabs.slice(fit);

  // Every destination, flattened for the phone picker: "Receivables › Client invoices".
  const destinations = tabs.flatMap((tab) =>
    tab.kind === 'link'
      ? [{ href: tab.href, text: `${label(tab.labelKey)}${countSuffix(tab.badge)}`, active: tab.active }]
      : tab.items.map((item) => ({
          href: item.href,
          text: `${label(tab.labelKey)} › ${label(item.labelKey)}${countSuffix(item.badge)}`,
          active: item.active,
        })),
  );
  const current = destinations.find((d) => d.active);

  return (
    <nav aria-label={navLabel} className="border-t border-border">
      {/* ── Phone: one section picker ─────────────────────────────────── */}
      <div className="py-3 min-[560px]:hidden">
        <label
          htmlFor="module-section-picker"
          className="mb-1 block text-micro font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t('shell.section')}
        </label>
        <Select
          id="module-section-picker"
          searchable={false}
          className="w-full"
          value={current?.href ?? ''}
          // Through the unsaved-changes guard: a select is not a link the guard can see.
          onChange={(href) => guardedNavigate(() => router.push(href))}
        >
          {current ? null : <option value="">{t('shell.chooseSection')}</option>}
          {destinations.map((d) => (
            <option key={d.href} value={d.href}>
              {d.text}
            </option>
          ))}
        </Select>
      </div>

      {/* ── Wider: tabs, with More for whatever does not fit ─────────── */}
      <div ref={rowRef} className="relative hidden min-w-0 items-center min-[560px]:flex">
        {shown.map((tab) => (
          <TabItem key={tab.key} tab={tab} label={label} counts={counts} />
        ))}
        {overflow.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(TAB_CLASS, overflow.some((tab) => tab.active) ? TAB_ACTIVE : TAB_IDLE)}
            >
              {t('shell.more')}
              <ChevronDown size={14} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              {overflow.map((tab, index) =>
                tab.kind === 'link' ? (
                  <MenuLink key={tab.key} href={tab.href} active={tab.active}>
                    {label(tab.labelKey)}
                    {tab.badge ? <NavCount badge={tab.badge} count={counts[tab.badge]} className="ms-auto" /> : null}
                  </MenuLink>
                ) : (
                  <div key={tab.key}>
                    {index > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="font-semibold text-foreground">
                      {label(tab.labelKey)}
                    </DropdownMenuLabel>
                    {tab.items.map((item) => (
                      <MenuLink key={item.href} href={item.href} active={item.active}>
                        {label(item.labelKey)}
                        {item.badge ? (
                          <NavCount badge={item.badge} count={counts[item.badge]} className="ms-auto" />
                        ) : null}
                      </MenuLink>
                    ))}
                  </div>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Off-screen ruler: every tab at its natural width, so the fit is measured, not guessed.
            Zero-size and clipped so the ruler never widens the page (each child's offsetWidth is
            unaffected); otherwise a long tab set scrolls the whole page sideways at tablet widths. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute start-0 top-0 flex h-0 w-0 overflow-hidden"
        >
          {tabs.map((tab) => (
            <span key={tab.key} className={cn(TAB_CLASS, TAB_IDLE, 'shrink-0')}>
              {label(tab.labelKey)}
              {tab.kind === 'menu' ? <ChevronDown size={14} /> : null}
            </span>
          ))}
        </div>
      </div>
    </nav>
  );
}

function TabItem({
  tab,
  label,
  counts,
}: {
  tab: ModuleTab;
  label: (key: string) => string;
  counts: NavBadgeCounts;
}) {
  if (tab.kind === 'link') {
    return (
      <Link
        href={tab.href}
        aria-current={tab.active ? 'page' : undefined}
        className={cn(TAB_CLASS, tab.active ? TAB_ACTIVE : TAB_IDLE)}
      >
        {label(tab.labelKey)}
        {tab.badge ? <NavCount badge={tab.badge} count={counts[tab.badge]} /> : null}
      </Link>
    );
  }
  // A group carries the count of its badged item, so a waiting inbox shows before it is opened.
  const badged = tab.items.find((item) => item.badge);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(TAB_CLASS, tab.active ? TAB_ACTIVE : TAB_IDLE)}>
        {label(tab.labelKey)}
        {badged?.badge ? <NavCount badge={badged.badge} count={counts[badged.badge]} /> : null}
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {tab.items.map((item) => (
          <MenuLink key={item.href} href={item.href} active={item.active}>
            {label(item.labelKey)}
            {item.badge ? (
              <NavCount badge={item.badge} count={counts[item.badge]} className="ms-auto" />
            ) : null}
          </MenuLink>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(active && 'bg-surface-selected font-semibold text-foreground')}
      >
        {children}
      </Link>
    </DropdownMenuItem>
  );
}
