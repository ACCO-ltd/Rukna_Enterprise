'use client';

import { useTranslations } from 'next-intl';
import { CaretDown, Desktop, Moon, Sun } from '@phosphor-icons/react';
import {
  Avatar,
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

/**
 * Avatar button that opens a dropdown containing the user email, theme control, and sign out.
 * Sign-out clears the in-memory access token and redirects to /login.
 */
export function UserMenu() {
  const t = useTranslations('platform');
  const { user } = useSession();
  const { mutate: logout, isPending } = useLogout();
  const themePreference = useThemePreference();

  // The name when the token carries one, the email until it does. Never a name invented from
  // the email — "a.hassan@acco.com" is not "A Hassan", and guessing someone's name is worse
  // than showing the address they signed in with.
  const displayName = user?.name ?? user?.email ?? null;
  // `Avatar` derives initials from a space-separated name (`initialsFromName`); with no real
  // name on file, feed it the email's local part with separators turned to spaces, so
  // "a.hassan@acco.com" still yields "AH" rather than treating "a." as one literal word.
  const avatarName = user?.name ?? user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('user.menuLabel')}
          className={cn(
            'flex shrink-0 items-center gap-2.5 rounded-full ps-1 pe-1 sm:rounded-control sm:pe-2',
            'transition-colors hover:bg-muted/70',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
          )}
        >
          <Avatar name={avatarName} />

          {/* Identity in the bar, not only behind a click. An avatar alone asks "whose session
              is this?" of anyone sharing a machine or holding two tenants open. Hidden below
              `sm`, where the bar has no room to spend on it. */}
          {displayName ? (
            <span className="hidden min-w-0 text-start sm:block">
              <span className="block max-w-40 truncate text-body-sm font-semibold leading-tight text-foreground">
                {displayName}
              </span>
              {user?.tenantSlug ? (
                <span className="block max-w-40 truncate text-caption uppercase leading-tight text-muted-foreground">
                  {user.tenantSlug}
                </span>
              ) : null}
            </span>
          ) : null}

          <CaretDown size={12} weight="bold" className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Identity */}
        {user ? (
          <>
            <DropdownMenuLabel className="normal-case tracking-normal">
              {user.name ? (
                <span className="block truncate font-medium text-foreground">{user.name}</span>
              ) : null}
              {/* The email stays, whether or not there is a name above it: it is the thing
                  someone checks when they need to know exactly which account is signed in. */}
              <span
                className={cn(
                  'block truncate',
                  user.name
                    ? 'text-caption font-normal text-muted-foreground'
                    : 'font-medium text-foreground',
                )}
              >
                {user.email}
              </span>
              <span className="block truncate text-caption font-normal uppercase text-muted-foreground">
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
