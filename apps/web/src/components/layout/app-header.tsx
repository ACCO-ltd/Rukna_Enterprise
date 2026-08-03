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
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>

        {user ? (
          <p className="hidden max-w-[16rem] truncate text-sm text-muted-foreground md:block">
            {user.email}
          </p>
        ) : null}

        <Button
          variant="outline"
          size="sm"
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
