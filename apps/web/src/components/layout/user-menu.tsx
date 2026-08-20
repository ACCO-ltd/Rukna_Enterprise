'use client';

import { useTranslations } from 'next-intl';
import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@erp/ui';

import { useLogout } from '@/features/auth/hooks/use-logout';
import { useSession } from '@/features/auth/session/use-session';
import { setThemePreference, useThemePreference } from '@/features/theme/theme-store';
import type { ThemePreference } from '@/features/theme/theme-preference';

/** Derives display initials from an email address. "abdulsalam@acco.com" → "AA". */
function emailToInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.replace(/[._-]+/g, ' ').trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

/**
 * Avatar button that opens a dropdown containing the user email, theme control, and sign out.
 * Sign-out clears the in-memory access token and redirects to /login.
 */
export function UserMenu() {
  const t = useTranslations('platform');
  const { user } = useSession();
  const { mutate: logout, isPending } = useLogout();
  const themePreference = useThemePreference();

  const initials = user ? emailToInitials(user.email) : '??';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('user.menuLabel')}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            'bg-brand-primary text-xs font-semibold text-brand-on-primary shadow-[var(--shadow-control)] ring-2 ring-surface',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
            'transition-opacity hover:opacity-90',
          )}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Identity */}
        {user ? (
          <>
            <DropdownMenuLabel className="normal-case tracking-normal">
              <span className="block truncate font-medium text-foreground">{user.email}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.tenantSlug}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('user.theme')}</DropdownMenuLabel>
          <ThemeItem
            preference="light"
            current={themePreference}
            label={t('user.themeLight')}
            icon={<Sun size={16} aria-hidden="true" />}
          />
          <ThemeItem
            preference="dark"
            current={themePreference}
            label={t('user.themeDark')}
            icon={<Moon size={16} aria-hidden="true" />}
          />
          <ThemeItem
            preference="system"
            current={themePreference}
            label={t('user.themeSystem')}
            icon={<Desktop size={16} aria-hidden="true" />}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Sign out */}
        <DropdownMenuItem
          destructive
          onSelect={() => logout()}
          disabled={isPending}
        >
          {isPending ? t('user.signOutPending') : t('user.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItem({
  preference,
  current,
  label,
  icon,
}: {
  preference: ThemePreference;
  current: ThemePreference;
  label: string;
  icon: React.ReactNode;
}) {
  const selected = preference === current;

  return (
    <DropdownMenuItem
      onSelect={() => setThemePreference(preference)}
      role="menuitemradio"
      aria-checked={selected}
      className={cn('min-h-11', selected && 'font-semibold text-brand-primary')}
    >
      {icon}
      <span>{label}</span>
      {selected ? <CheckIcon className="ms-auto" /> : null}
    </DropdownMenuItem>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
