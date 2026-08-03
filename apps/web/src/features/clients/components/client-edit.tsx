'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useClient } from '../hooks/use-client';
import { ClientForm } from './client-form';

/**
 * Loads a client for editing.
 *
 * Unlike projects, there is no status gate here: `ClientService.update` accepts a PATCH in
 * any state, including INACTIVE. Correcting the spelling of a retired client's name is
 * legitimate, and blocking it would be the UI inventing a rule the API does not have.
 */
export function ClientEdit({ id }: { id: string }) {
  const t = useTranslations('platform.clients.detail');
  const tCommon = useTranslations('common');
  const { data: client, isPending, isError, error } = useClient(id);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);

    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/clients">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  return <ClientForm client={client} />;
}
