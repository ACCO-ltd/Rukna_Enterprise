'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

type SupportedLocale = 'en' | 'ar';

/**
 * Device-local language toggle.
 *
 * Writes the `lang` cookie that `src/i18n/request.ts` reads on the server, then refreshes
 * so server components re-render in the new locale and `<html dir>` flips.
 *
 * The choice cannot be persisted to the user's account — there is no endpoint to update
 * `preferredLanguage` (B9). Until there is, switching here affects this browser only,
 * while login seeds the initial locale from the JWT `lang` claim.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('common.language');

  const changeLocale = (nextLocale: SupportedLocale) => {
    if (nextLocale === locale) return;

    document.cookie = `lang=${nextLocale}; path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };

  return (
    <div
      className="inline-flex rounded-md border border-border bg-surface-subtle p-1"
      role="group"
      aria-label={t('label')}
    >
      <button
        type="button"
        onClick={() => {
          changeLocale('en');
        }}
        className="min-h-9 rounded px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm"
        aria-label={t('switchToEnglish')}
        aria-pressed={locale === 'en'}
      >
        {t('english')}
      </button>
      <button
        type="button"
        onClick={() => {
          changeLocale('ar');
        }}
        className="min-h-9 rounded px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm"
        aria-label={t('switchToArabic')}
        aria-pressed={locale === 'ar'}
      >
        {t('arabic')}
      </button>
    </div>
  );
}
