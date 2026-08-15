'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Select, cn } from '@erp/ui';

export type CommercialTab =
  'overview' | 'contract-security' | 'applications' | 'billing-collection';

const TABS: readonly CommercialTab[] = [
  'overview',
  'contract-security',
  'applications',
  'billing-collection',
];

function href(projectId: string, tab: CommercialTab): string {
  const base = `/projects/${projectId}/commercial`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

/**
 * Commercial internal navigation. Desktop shows a compact tab row; on a narrow viewport it
 * collapses to a single stable selector (44px target) so five tabs never wrap or overflow.
 * Variations and Subcontracts are deliberately absent — not "coming soon".
 */
export function CommercialNav({ projectId, active }: { projectId: string; active: CommercialTab }) {
  const t = useTranslations('commercial.tabs');
  const router = useRouter();

  return (
    <nav aria-label={t('label')} className="border-b border-border">
      {/* Desktop tabs */}
      <ul className="hidden gap-1 sm:flex">
        {TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={href(projectId, tab)}
              aria-current={tab === active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-[40px] items-center border-b-2 px-3 text-body-sm font-medium transition-colors',
                tab === active
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab)}
            </Link>
          </li>
        ))}
      </ul>

      {/* Mobile selector */}
      <div className="py-2 sm:hidden">
        <Select
          aria-label={t('label')}
          value={active}
          onChange={(e) => router.push(href(projectId, e.target.value as CommercialTab))}
        >
          {TABS.map((tab) => (
            <option key={tab} value={tab}>
              {t(tab)}
            </option>
          ))}
        </Select>
      </div>
    </nav>
  );
}
