'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ClientStatus } from '@erp/types';
import { Alert, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useClient, useSetClientStatus } from '../hooks/use-client';
import { ClientContacts } from './client-contacts';
import { ClientStatusBadge } from './client-status-badge';

export function ClientDetail({ clientId }: { clientId: string }) {
  const t = useTranslations('platform.clients.detail');
  const tClients = useTranslations('platform.clients');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: client, isPending, isError, error } = useClient(clientId);
  const update = useSetClientStatus(clientId);
  const [confirmingStatus, setConfirmingStatus] = useState(false);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/clients">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const displayName = locale === 'ar' && client.nameAr ? client.nameAr : client.name;
  const isActive = client.status === ClientStatus.ACTIVE;
  const unset = <span className="text-muted-foreground">{tClients('notSet')}</span>;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/clients"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{client.code}</span>
              <ClientStatusBadge status={client.status} />
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h1>
            {/* The heading shows the name in the UI language; this line shows the OTHER
                one, because a contract or invoice may carry either and staff need to
                recognise both. Keyed off the locale rather than a name comparison: an
                earlier version compared `name !== displayName`, which rendered the Arabic
                name twice in Arabic and omitted it entirely in English. */}
            {client.nameAr ? (
              <p className="text-sm text-muted-foreground">
                {/* <bdi> isolates the opposite-direction text so it renders correctly
                    without dragging the line to the other edge — putting `dir` on the <p>
                    changes its block alignment too, which left the secondary name
                    floating far from the heading it belongs to. */}
                <bdi dir={locale === 'ar' ? 'ltr' : 'rtl'} lang={locale === 'ar' ? 'en' : 'ar'}>
                  {locale === 'ar' ? client.name : client.nameAr}
                </bdi>
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`/clients/${client.id}/edit`}>{t('edit')}</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmingStatus(true);
              }}
            >
              {isActive ? t('deactivate') : t('reactivate')}
            </Button>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">{t('overview')}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('taxNumber')}</dt>
            <dd className="mt-0.5 text-sm text-foreground" dir="ltr">
              {client.taxNumber || unset}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('defaultCurrency')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">{client.defaultCurrency || unset}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('created')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(client.createdAt, locale) ?? unset}
            </dd>
          </div>
        </dl>
      </section>

      <ClientContacts clientId={client.id} contacts={client.contacts} />

      {confirmingStatus ? (
        <ConfirmActionDialog
          title={isActive ? t('deactivateTitle') : t('reactivateTitle')}
          description={isActive ? t('deactivateBody') : t('reactivateBody')}
          confirmLabel={isActive ? t('deactivate') : t('reactivate')}
          isPending={update.isPending}
          errorMessage={update.isError ? t('statusChangeFailed') : undefined}
          onConfirm={() => {
            update.mutate(isActive ? ClientStatus.INACTIVE : ClientStatus.ACTIVE, {
              onSuccess: () => {
                setConfirmingStatus(false);
              },
            });
          }}
          onDismiss={() => {
            update.reset();
            setConfirmingStatus(false);
          }}
        />
      ) : null}
    </div>
  );
}
