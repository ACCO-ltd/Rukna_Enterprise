import { getTranslations } from 'next-intl/server';

export default async function ProjectMembersPage() {
  const t = await getTranslations('platform.projects.detail');

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
      <p className="text-sm text-foreground">{t('membersUnavailable')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('membersUnavailableHint')}</p>
    </div>
  );
}
