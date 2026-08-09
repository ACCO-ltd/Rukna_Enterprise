import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  // `accounting` is a namespace of its own rather than another branch of `platform`.
  // `platform.json` is already the file every feature edits, and it is where the last rebase
  // silently produced a duplicate key that dropped 54 lines of translations.
  const [common, auth, platform, accounting, procurement] = await Promise.all([
    import(`../../messages/${locale}/common.json`).then((m) => m.default),
    import(`../../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../../messages/${locale}/platform.json`).then((m) => m.default),
    import(`../../messages/${locale}/accounting.json`).then((m) => m.default),
    import(`../../messages/${locale}/procurement.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: { common, auth, platform, accounting, procurement },
  };
});

async function resolveLocale(): Promise<'en' | 'ar'> {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value;
  if (langCookie === 'ar' || langCookie === 'en') return langCookie;

  return 'en';
}
