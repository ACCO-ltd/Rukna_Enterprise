'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';

export type CommercialTab =
  'overview' | 'contract-security' | 'applications' | 'variations' | 'billing-collection';

const TABS: readonly CommercialTab[] = [
  'overview',
  'contract-security',
  'applications',
  'variations',
  'billing-collection',
];

function href(projectId: string, tab: CommercialTab): string {
  const base = `/projects/${projectId}/commercial`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

/**
 * Commercial internal navigation. The four views are a *level-3 local view switch* inside the
 * Commercial module tab (ux-doctrine §5), so they use the quiet segmented `ViewSwitcher` — NOT
 * the underline treatment, which is reserved for the level-2 module tabs and would read as a
 * second global tab bar.
 *
 * Unlike Progress (client-side state), Commercial's views are real routes and stay deep-linkable:
 * we drive `ViewSwitcher` in **link mode** via `renderLink` (next/link), setting
 * `aria-current="page"` on the active view. The switcher scrolls within itself at 375px, so it
 * serves mobile too — no separate `<Select>`. Variations is live (ADR-026 Phases 1+4);
 * Subcontracts is deliberately absent — not "coming soon".
 */
export function CommercialNav({ projectId, active }: { projectId: string; active: CommercialTab }) {
  const t = useTranslations('commercial.tabs');

  return (
    <ViewSwitcher
      aria-label={t('label')}
      value={active}
      items={TABS.map((tab) => ({ value: tab, label: t(tab), href: href(projectId, tab) }))}
      renderLink={({ href: linkHref, active: isActive, className, children, key }) => (
        <Link
          key={key}
          href={linkHref}
          aria-current={isActive ? 'page' : undefined}
          className={className}
        >
          {children}
        </Link>
      )}
    />
  );
}
