'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Notice, SkeletonForm, SwitchField } from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { ApiError } from '@/lib/api-client';

import { documentReaderApi, readerStatusKey } from './api';

/**
 * Step 7 — Administration → Photo reader. Off until an administrator turns it on (owner decision
 * 2026-10-28), with the provider named so it is clear where photos go.
 */
export function ReaderSettings() {
  const t = useTranslations('platform.photoReader');
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: readerStatusKey, queryFn: documentReaderApi.status });
  const save = useMutation({
    mutationFn: documentReaderApi.setEnabled,
    onSuccess: (s) => queryClient.setQueryData(readerStatusKey, s),
  });

  if (status.isError) return <LoadError message={t('loadFailed')} onRetry={() => void status.refetch()} />;
  if (status.isPending) return <SkeletonForm fields={2} label={t('loading')} />;
  const s = status.data;

  return (
    <div className="max-w-2xl space-y-5">
      {!s.available ? (
        <Notice tone="info" title={t('notConfiguredTitle')}>{t('notConfigured')}</Notice>
      ) : (
        <>
          <SwitchField
            id="photo-reader-enabled"
            checked={s.enabled}
            onCheckedChange={(v) => save.mutate(v)}
            disabled={save.isPending}
            label={t('switch')}
            description={t('switchHint')}
          />
          <Notice tone="attention" title={t('whereTitle')}>
            {t('where', { provider: s.provider ?? '', model: s.model ?? '' })}
          </Notice>
        </>
      )}
      <ul className="list-disc space-y-1 ps-5 text-body-sm text-muted-foreground">
        <li>{t('rule1')}</li>
        <li>{t('rule2')}</li>
        <li>{t('rule3')}</li>
      </ul>
      {save.isError ? <Alert variant="error">{save.error instanceof ApiError ? save.error.message : t('saveFailed')}</Alert> : null}
    </div>
  );
}
