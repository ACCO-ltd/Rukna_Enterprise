import { getTranslations } from 'next-intl/server';

import { ClientEdit } from '@/features/clients/components/client-edit';

/**
 * The Projects module header owns the page's `h1`; `ClientEdit` names the client in its
 * breadcrumb (ADR-035). What stays here is the one line an editor needs before changing it.
 */
export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('platform.clients.create');

  return (
    <div className="w-full max-w-4xl">
      <p className="mb-4 text-body-sm text-muted-foreground">{t('editSubtitle')}</p>
      {/* ClientEdit renders its own panel through ClientForm; the loading and error states it
          shows first are deliberately unpanelled, so a failure is not dressed as a document. */}
      <ClientEdit id={id} />
    </div>
  );
}
