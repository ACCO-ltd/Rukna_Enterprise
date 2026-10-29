'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, SkeletonForm } from '@erp/ui';

import { LoadError } from '@/components/load-error';

import { ApiError } from '@/lib/api-client';
import { useModuleTrail } from '@/components/layout/module-chrome';

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
  const { data: client, isPending, isError, error, refetch } = useClient(id);
  // Names the client being edited in the module breadcrumb (ADR-035): "Clients / <name>".
  useModuleTrail(client?.name);

  if (isPending) {
    return <SkeletonForm label={tCommon('loading')} />;
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);

    return (
      <div className="space-y-4">
        {notFound ? (
          <Alert variant="error" messages={[t('notFound')]} />
        ) : (
          <LoadError message={t('loadFailed')} onRetry={() => void refetch()} />
        )}
        <Button variant="outline" asChild>
          <Link href="/clients">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  return <ClientForm client={client} />;
}
