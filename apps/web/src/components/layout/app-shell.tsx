'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AppHeader } from './app-header';
import { SidebarNav } from './sidebar-nav';

/**
 * Application chrome for authenticated routes.
 *
 * Mobile-first: below `lg` the navigation is an off-canvas drawer; from `lg` up it is a
 * persistent sidebar. The drawer is mounted and unmounted rather than slid in with a
 * transform — a `-translate-x-full` would slide the wrong way under `dir="rtl"`, and
 * correctness in both directions matters more than the animation.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('platform.shell');
  const [isMenuOpen, setMenuOpen] = useState(false);

  // Escape closes the drawer, and body scroll is locked while it covers the page.
  useEffect(() => {
    if (!isMenuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow"
      >
        {t('skipToContent')}
      </a>

      {/* Persistent sidebar — `border-e` and `start-0` are logical, so the panel sits on
          the inline-start edge in both LTR and RTL. */}
      <aside className="fixed inset-y-0 start-0 hidden w-64 border-e border-border bg-surface lg:block">
        <div className="flex h-16 items-center border-b border-border px-6">
          <span className="text-sm font-semibold tracking-tight text-foreground">Rukna</span>
        </div>
        <SidebarNav />
      </aside>

      {isMenuOpen ? (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-brand-ink/40"
            onClick={() => {
              setMenuOpen(false);
            }}
            aria-hidden="true"
          />
          <div
            className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('primaryNavLabel')}
          >
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold tracking-tight text-foreground">Rukna</span>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                aria-label={t('closeMenu')}
              >
                <CloseIcon />
              </button>
            </div>
            <SidebarNav
              onNavigate={() => {
                setMenuOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      {/* `ps-64` reserves the sidebar gutter on the inline-start side in both directions. */}
      <div className="lg:ps-64">
        <AppHeader
          onOpenMenu={() => {
            setMenuOpen(true);
          }}
        />
        <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
