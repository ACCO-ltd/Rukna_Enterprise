'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { usePermissions } from '@/features/auth/permissions/can';

import { moduleTabs, resolveModule } from './module-nav';
import { ModuleTabs } from './module-tabs';

// ─── Trail: the page's own trailing crumb ─────────────────────────────────────

interface TrailContextValue {
  trail: string | null;
  setTrail: (label: string | null) => void;
}

const TrailContext = createContext<TrailContextValue>({ trail: null, setTrail: () => {} });

export function ModuleTrailProvider({ children }: { children: React.ReactNode }) {
  const [trail, setTrail] = useState<string | null>(null);
  const value = useMemo(() => ({ trail, setTrail }), [trail]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}

/**
 * Names the record a detail page is showing, as the last breadcrumb:
 * "Accounting / Payables / Supplier bills / BILL-2026-0042". Pass `undefined` while the record
 * is loading; the crumb clears when the page unmounts.
 */
export function useModuleTrail(label: string | null | undefined): void {
  const { setTrail } = useContext(TrailContext);
  useEffect(() => {
    setTrail(label ?? null);
    return () => setTrail(null);
  }, [label, setTrail]);
}

/**
 * `useModuleTrail` as a component, for a server-rendered page that cannot call a hook:
 * `<ModuleTrail label={t('create.title')} />`. Renders nothing.
 */
export function ModuleTrail({ label }: { label: string }) {
  useModuleTrail(label);
  return null;
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface Crumb {
  label: string;
  href?: string;
}

interface ModuleHeaderProps {
  title: string;
  crumbs: Crumb[];
  description?: string;
  children?: React.ReactNode;
}

/**
 * A module's heading: the module name as the page's one `h1`, the Module / Tab / Page trail
 * beside it, and one line saying what the module is for. The page itself carries no second
 * title — the trail already names it.
 */
export function ModuleHeader({ title, crumbs, description, children }: ModuleHeaderProps) {
  const t = useTranslations('platform.shell');
  return (
    <header className="mb-6 rounded-panel border border-border bg-surface px-4 pt-4 sm:px-6 sm:pt-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-h1 font-semibold tracking-tight text-foreground">{title}</h1>
        {crumbs.length > 0 ? (
          <nav aria-label={t('breadcrumb')} className="w-full min-w-0 sm:w-auto">
            <ol className="flex flex-wrap items-center gap-x-1.5 text-body-sm text-muted-foreground">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={index === 0 ? 'hidden sm:inline' : undefined}>
                      /
                    </span>
                    {crumb.href && !last ? (
                      <Link href={crumb.href} className="hover:text-foreground hover:underline">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className={last ? 'font-medium text-foreground' : undefined}
                        aria-current={last ? 'page' : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className={description || crumbs.length ? 'mt-3' : undefined}>{children}</div>
    </header>
  );
}

// ─── Chrome: resolves the module from the URL ─────────────────────────────────

/**
 * Renders the module header and tab bar for whichever module owns the current route, or
 * nothing for a page outside every module (the dashboard, a project workspace, Administration,
 * which keeps its own workspace shell). Mounted once, in `AppShell`.
 */
export function ModuleChrome() {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const { can, moduleVisible } = usePermissions();
  const { trail } = useContext(TrailContext);

  const resolved = resolveModule(pathname);
  if (!resolved || !moduleVisible(resolved.domain.moduleKey)) return null;

  const { domain, item, groupKey } = resolved;
  const crumbs: Crumb[] = [];
  if (groupKey) crumbs.push({ label: t(`nav.group.${groupKey}`) });
  if (item) crumbs.push({ label: t(`nav.${item.labelKey}`), href: item.href });
  if (trail) crumbs.push({ label: trail });

  const tabs = moduleTabs(domain, pathname, can);
  const title = t(`nav.${domain.labelKey}`);

  return (
    <ModuleHeader
      title={title}
      crumbs={crumbs}
      description={t(`module.${domain.moduleKey}.description`)}
    >
      <ModuleTabs tabs={tabs} navLabel={t('shell.moduleSections', { module: title })} />
    </ModuleHeader>
  );
}
