'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn, Select } from '@erp/ui';

/**
 * One destination in a workspace tab bar.
 *
 * `href` doubles as the narrow-screen picker's option value, so it has to be unique across the
 * bar — which it already is, being a route.
 */
export interface WorkspaceTab {
  href: string;
  label: string;
  /** Drawn at 16px before the label. Optional: a bar without icons is still a bar. */
  icon?: ReactNode;
  active: boolean;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  /** Names the <nav> for assistive technology, e.g. "Project workspace" or "Administration sections". */
  navLabel: string;
  /** Unique id for the narrow-screen picker, which needs a label associated to it. */
  selectId: string;
  /** Applied to the <nav>. Hosts differ in which edge carries the rule, so it is not decided here. */
  className?: string;
  /**
   * Applied to the narrow-screen picker. Separate from `className` because the picker sits
   * inside the host's padding while the desktop row deliberately does not: giving the <nav>
   * horizontal padding would indent the first tab and break its alignment with the content
   * below it.
   */
  selectClassName?: string;
}

/**
 * The tab bar a workspace navigates itself with.
 *
 * There were two of these — one in the project workspace shell, one written again for
 * Administration — and they had already drifted apart in height, horizontal padding, font
 * weight and, worse, in what they do when the screen is too narrow to hold them: one collapsed
 * to a picker, the other scrolled sideways and left its later tabs off-screen with nothing
 * saying they were there. A reader who learned the gesture in one workspace should not have to
 * learn a second one somewhere else, so there is now one component and one answer.
 *
 * Below `md` the tabs become a native picker. That is the honest control at 375px: every
 * destination is reachable and the current one is named, where a scrolling row hides both
 * facts. Above `md` they are a row of links — real links, so they middle-click, they open in a
 * new tab, and the active one is `aria-current="page"`.
 */
export function WorkspaceTabs({
  tabs,
  navLabel,
  selectId,
  className,
  selectClassName,
}: WorkspaceTabsProps) {
  const router = useRouter();
  const active = tabs.find((tab) => tab.active);

  return (
    <nav aria-label={navLabel} className={className}>
      <label className="sr-only" htmlFor={selectId}>
        {navLabel}
      </label>
      {/* Navigation, not a picker: these are destinations someone browses, so no filter box
          however many tabs the workspace grows. */}
      <Select
        id={selectId}
        searchable={false}
        className={cn('my-3 w-full md:hidden', selectClassName)}
        value={active?.href ?? tabs[0]?.href ?? ''}
        onChange={(value) => router.push(value)}
      >
        {tabs.map((tab) => (
          <option key={tab.href} value={tab.href}>
            {tab.label}
          </option>
        ))}
      </Select>

      <div className="hidden items-center md:flex">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            className={cn(
              // One stroke weight and one icon size in both states: colour and the underline
              // carry "you are here", so the glyph does not have to thicken as well.
              'inline-flex min-h-12 items-center gap-2 border-b-2 px-3.5 text-body-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
              tab.active
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
