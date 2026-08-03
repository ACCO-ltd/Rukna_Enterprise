import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('platform.nav');

  // Content lands in PR 3 — status counts and recent projects from GET /projects.
  // The shell (header, navigation, main landmark) comes from src/app/(app)/layout.tsx.
  return (
    <div className="mx-auto w-full max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('dashboard')}</h1>
    </div>
  );
}
