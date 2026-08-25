'use client';

import { useTranslations } from 'next-intl';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { cn } from '@erp/ui';

import { openCommandMenu } from './command-menu-store';

/**
 * The top bar's leading affordance: a chip that reads like a search field and opens the
 * command menu. The "⌘K" hint teaches the shortcut without a tour. It is a real, working
 * control — not a disabled tease (ux-doctrine §4).
 */
export function CommandMenuTrigger() {
  const t = useTranslations('platform');

  return (
    <button
      type="button"
      onClick={openCommandMenu}
      className={cn(
        'group flex h-9 min-w-0 items-center gap-2 rounded-control border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors',
        'hover:border-brand-primary/30 hover:bg-muted hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
        'w-full max-w-xs sm:w-72',
      )}
      aria-label={t('commandMenu.triggerLabel')}
    >
      <MagnifyingGlassIcon size={16} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{t('commandMenu.triggerLabel')}</span>
      <kbd className="ms-auto hidden shrink-0 rounded-control border border-border bg-surface px-1.5 py-0.5 text-micro font-semibold text-muted-foreground sm:inline-block">
        {t('commandMenu.hintKey')}
      </kbd>
    </button>
  );
}
