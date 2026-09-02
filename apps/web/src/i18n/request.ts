import { getRequestConfig } from 'next-intl/server';

// The platform is English-only. The next-intl seam is kept so another locale (e.g. Somali) can
// be added later, but there is a single active locale today.
const locale = 'en';

export default getRequestConfig(async () => {
  // `accounting` is a namespace of its own rather than another branch of `platform`.
  // `platform.json` is already the file every feature edits, and it is where the last rebase
  // silently produced a duplicate key that dropped 54 lines of translations.
  const [
    common,
    auth,
    platform,
    accounting,
    procurement,
    commercial,
    documents,
    progress,
    projectTypes,
  ] = await Promise.all([
    import(`../../messages/${locale}/common.json`).then((m) => m.default),
    import(`../../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../../messages/${locale}/platform.json`).then((m) => m.default),
    import(`../../messages/${locale}/accounting.json`).then((m) => m.default),
    import(`../../messages/${locale}/procurement.json`).then((m) => m.default),
    import(`../../messages/${locale}/commercial.json`).then((m) => m.default),
    import(`../../messages/${locale}/documents.json`).then((m) => m.default),
    import(`../../messages/${locale}/progress.json`).then((m) => m.default),
    import(`../../messages/${locale}/project-types.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: {
      common,
      auth,
      platform,
      accounting,
      procurement,
      commercial,
      documents,
      progress,
      projectTypes,
    },
  };
});
