'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { isActiveNavItem, NAV_ITEMS } from './nav-items';

interface SidebarNavProps {
  /** Called after a navigation choice, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const t = useTranslations('platform');

  return (
    <nav aria-label={t('shell.primaryNavLabel')} className="p-3">
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = isActiveNavItem(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                // aria-current is what conveys "you are here" to assistive tech; colour
                // alone would not.
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  // min-h-11 keeps the touch target at the 44px floor on mobile.
                  'flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t(`nav.${item.labelKey}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
