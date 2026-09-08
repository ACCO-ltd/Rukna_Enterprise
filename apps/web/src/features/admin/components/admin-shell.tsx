'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { isActiveNavItem } from '@/components/layout/nav-groups';
import { NavIcon } from '@/components/layout/nav-icon';
import { WorkspaceTabs } from '@/components/layout/workspace-tabs';
import { usePermissions } from '@/features/auth/permissions/can';

import { isAdminDeepRoute, visibleAdminTabs } from '../admin-nav';

/**
 * The Administration workspace shell.
 *
 * Administration used to be a collapsible column of six rows inside the global sidebar, sorted
 * under four micro-labels. That put a second level of navigation permanently in the chrome of
 * every other screen in the product, to serve six screens that a person visits deliberately.
 * It now works the way the project workspaces do: the sidebar holds one row, clicking it opens
 * this workspace, and the six screens are its tabs — drawn by the same `WorkspaceTabs` the
 * project workspaces use, so the two bars cannot drift apart again.
 *
 * The shell owns the page's `h1`. That is the point of it, not a side effect: each screen used
 * to render its own `h1` through `PageHeader`, so "Users" was announced as the top of the
 * document with nothing above it saying which part of the product you were in. Here the
 * workspace is the `h1` and each screen is an `h2` inside it (`AdminPanel`), which is what the
 * reader already sees and what a screen reader should hear.
 *
 * Two things this header deliberately does *not* carry, both of which it used to:
 *
 *  - **A breadcrumb.** "Dashboard › Administration › Users" named three things the reader could
 *    already see: a sidebar row, this `h1`, and the lit tab. The middle crumb was worse than
 *    redundant — it pointed at `/admin`, which redirects to `/admin/users`, so on the first tab
 *    it was a link back to the page you were standing on. The project workspaces keep their
 *    trail because theirs names a specific project; a trail that carries no information is just
 *    a line of text above the fold.
 *  - **A subtitle.** One fixed sentence about managing your organization, repeated on all six
 *    screens. Each screen states its own purpose in its `AdminPanel` description, where the
 *    sentence can actually differ.
 *
 * Between them they cost about 55px at the top of every administration screen — a row and a
 * half of whichever table the reader came here to read.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const { can } = usePermissions();

  // The governance builder brings its own workspace chrome. Hand it the page untouched.
  if (isAdminDeepRoute(pathname)) return <>{children}</>;

  const tabs = visibleAdminTabs(can);

  return (
    <div>
      <h1 className="text-h1 font-semibold tracking-tight text-foreground">{t('admin.title')}</h1>

      <WorkspaceTabs
        navLabel={t('admin.navLabel')}
        selectId="admin-workspace-menu"
        className="mt-3 border-b border-border"
        tabs={tabs.map((tab) => ({
          href: tab.href,
          label: t(`nav.${tab.labelKey}`),
          icon: tab.iconKey ? <NavIcon iconKey={tab.iconKey} size={16} /> : undefined,
          active: isActiveNavItem(pathname, tab.href),
        }))}
      />

      <div className="mt-6">{children}</div>
    </div>
  );
}
