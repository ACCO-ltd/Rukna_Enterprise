import { getTranslations } from 'next-intl/server';

import { NewProjectApplication } from '@/features/commercial/components/new-project-application';

/**
 * Create a payment application (IPA) inside the project Commercial workspace (P3 Slice C).
 *
 * The standalone `/contracts/:id/applications/new` page is folded away: the project is known from
 * the `[id]` segment, and the contract is resolved from the commercial summary by the client
 * wrapper. The wrapper anchors the form's cancel link and post-create redirect to the workspace.
 */
export default async function NewProjectApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('platform.ipa.create');

  return (
    <div className="w-full max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <NewProjectApplication projectId={id} />
      </div>
    </div>
  );
}
