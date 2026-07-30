import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  const [common, auth, platform] = await Promise.all([
    import(`../../messages/${locale}/common.json`).then((m) => m.default),
    import(`../../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../../messages/${locale}/platform.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: { common, auth, platform },
  };
});

async function resolveLocale(): Promise<'en' | 'ar'> {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value;
  if (langCookie === 'ar' || langCookie === 'en') return langCookie;

  const headerStore = await headers();
  const acceptLang = headerStore.get('accept-language') ?? '';
  if (acceptLang.toLowerCase().includes('ar')) return 'ar';

  return 'en';
}
