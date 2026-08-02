'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

type SupportedLocale = 'en' | 'ar';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('auth.login');

  const changeLocale = (nextLocale: SupportedLocale) => {
    if (nextLocale === locale) return;

    document.cookie = `lang=${nextLocale}; path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };

  return (
    <div
      className="inline-flex rounded-md border border-border bg-surface-subtle p-1"
      role="group"
      aria-label={t('languageLabel')}
    >
      <button
        type="button"
        onClick={() => changeLocale('en')}
        className="min-h-9 rounded px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm"
        aria-label={t('switchToEnglish')}
        aria-pressed={locale === 'en'}
      >
        {t('englishLanguage')}
      </button>
      <button
        type="button"
        onClick={() => changeLocale('ar')}
        className="min-h-9 rounded px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm"
        aria-label={t('switchToArabic')}
        aria-pressed={locale === 'ar'}
      >
        {t('arabicLanguage')}
      </button>
    </div>
  );
}
