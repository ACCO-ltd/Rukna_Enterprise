'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { GlobalSidebar } from './global-sidebar';
import { TopBar } from './top-bar';

/**
 * Application chrome for all authenticated routes.
 *
 * Layout model:
 *   - Desktop (lg+): fixed 240px sidebar on the inline-start edge, sticky 56px top bar,
 *     scrollable main content with appropriate gutters.
 *   - Mobile (<lg): no visible sidebar. The top bar has a hamburger that slides in an
 *     off-canvas drawer. The drawer mounts/unmounts rather than transforms so RTL layout
 *     is correct in both directions without fighting CSS `translate`.
 *
 * This shell handles the GLOBAL layout only. The project workspace layout (with its own
 * secondary sidebar for project-scoped navigation) is a nested layout applied by
 * `/projects/[id]/layout.tsx` — it replaces the content area without touching the
 * global sidebar or top bar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('platform.shell');
  const [isMenuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [isMenuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Skip link — first focusable element so keyboard users can bypass chrome. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow"
      >
        {t('skipToContent')}
      </a>

      {/* ── Desktop sidebar — persistent, fixed ──────────────────────────── */}
      <aside
        className="fixed inset-y-0 start-0 hidden w-60 border-e border-border bg-surface lg:flex lg:flex-col"
        aria-label={t('primaryNavLabel')}
      >
        <GlobalSidebar />
      </aside>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {isMenuOpen ? (
        <div className="lg:hidden">
          {/* Scrim */}
          <div
            className="fixed inset-0 z-40 bg-brand-ink/30"
            aria-hidden="true"
            onClick={close}
          />
          {/* Panel */}
          <div
            className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('primaryNavLabel')}
          >
            <div className="flex h-14 shrink-0 items-center justify-end border-b border-border px-3">
              <button
                type="button"
                onClick={close}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                aria-label={t('closeMenu')}
              >
                <CloseIcon />
              </button>
            </div>
            <GlobalSidebar onNavigate={close} />
          </div>
        </div>
      ) : null}

      {/* ── Content column — offset by sidebar on desktop ─────────────────── */}
      <div className="flex min-h-screen flex-col lg:ps-60">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
