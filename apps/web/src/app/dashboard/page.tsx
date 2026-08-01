import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('platform.nav');

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard')}</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Placeholder — real shell lands in PR #2.
      </p>
    </main>
  );
}
