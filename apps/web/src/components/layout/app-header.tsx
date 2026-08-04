'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';

import { LanguageSwitcher } from '@/components/language-switcher';
import { useLogout } from '@/features/auth/hooks/use-logout';
import { useSession } from '@/features/auth/session/use-session';

interface AppHeaderProps {
  onOpenMenu: () => void;
}

export function AppHeader({ onOpenMenu }: AppHeaderProps) {
  const t = useTranslations();
  const { user } = useSession();
  const { mutate: logout, isPending } = useLogout();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="-ms-2 flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary lg:hidden"
        aria-label={t('platform.shell.openMenu')}
      >
        <MenuIcon />
      </button>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">Rukna ERP</p>
        {/*
          The workspace label comes from the JWT `tenantSlug` claim — already in memory,
          so it costs no request. The organization's display name would need
          GET /organizations/:id on every page load; not worth it for a header label.
        */}
        {user ? (
          <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
            {user.tenantSlug}
          </p>
        ) : null}
      </div>

      <div className="ms-auto flex items-center gap-2 sm:gap-3">
        {/* Shown at every width. This used to be `hidden sm:block`, which left a mandated
            bilingual product with no way to change language on a phone — the switcher in
            the app header is the only one past the login screen, so an Arabic user on a
            375px viewport was stuck in whichever locale their JWT seeded. The title to the
            start of it truncates, so the row still fits. */}
        <LanguageSwitcher />

        {user ? (
          <p className="hidden max-w-[16rem] truncate text-sm text-muted-foreground md:block">
            {user.email}
          </p>
        ) : null}

        {/* Default size, not `sm`: `sm` is 36px and the 44px touch-target floor is
            mandatory on every viewport, not only mobile. */}
        <Button
          variant="outline"
          onClick={() => {
            logout();
          }}
          disabled={isPending}
        >
          {t('auth.logout.button')}
        </Button>
      </div>
    </header>
  );
}

function MenuIcon() {
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
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}
