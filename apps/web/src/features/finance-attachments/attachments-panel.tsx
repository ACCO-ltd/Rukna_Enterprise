'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Skeleton } from '@erp/ui';
import type { FinanceAttachmentKind } from '@erp/types';

import { ACCOUNTING_PERMISSIONS, usePermissions, type PermissionKey } from '@/features/auth/permissions/can';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { formatDate } from '@/lib/format';
import { useAttachFinanceFile, useFinanceAttachments, useRemoveFinanceAttachment } from './hooks';

/** The permission that runs each document — the same rule the API applies (finance-attachment-policy). */
const MANAGE: Record<FinanceAttachmentKind, PermissionKey> = {
  INVOICE: ACCOUNTING_PERMISSIONS.manageReceivables,
  RECEIPT: ACCOUNTING_PERMISSIONS.manageReceivables,
  BILL: ACCOUNTING_PERMISSIONS.managePayables,
  PAYMENT: ACCOUNTING_PERMISSIONS.managePayables,
  JOURNAL: ACCOUNTING_PERMISSIONS.manageJournals,
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Step 4 — the supporting files on a finance document: the supplier's invoice scan, the bank advice,
 * the signed delivery note. Files can be removed until the document posts; after that the evidence
 * is part of the record, and anything added is marked as added after posting.
 */
export function AttachmentsPanel({ kind, ownerId }: { kind: FinanceAttachmentKind; ownerId: string }) {
  const t = useTranslations('common.attachments');
  const { can } = usePermissions();
  const mayChange = can(MANAGE[kind]);
  const mayRead = mayChange || can(ACCOUNTING_PERMISSIONS.view);
  const list = useFinanceAttachments(kind, ownerId, mayRead);
  const attach = useAttachFinanceFile(kind, ownerId);
  const remove = useRemoveFinanceAttachment(kind, ownerId);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!mayRead) return null;

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setError(null);
    for (const file of files) {
      try {
        await attach.mutateAsync(file);
      } catch {
        setError(t('uploadFailed', { name: file.name }));
      }
    }
  }

  async function open(fileId: string) {
    try {
      const { url } = await getFileDownloadUrl(fileId);
      window.open(url, '_blank', 'noopener');
    } catch {
      setError(t('openFailed'));
    }
  }

  async function onRemove(attachmentId: string) {
    setError(null);
    try {
      await remove.mutateAsync(attachmentId);
    } catch {
      setError(t('removeFailed'));
    }
  }

  const rows = list.data ?? [];
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface" aria-labelledby={`attachments-${ownerId}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 id={`attachments-${ownerId}`} className="text-body font-semibold text-foreground">
          {t('title')}
          {rows.length ? <span className="ms-1.5 text-muted-foreground">({rows.length})</span> : null}
        </h2>
        {mayChange ? (
          <>
            <input ref={input} type="file" multiple className="sr-only" aria-label={t('add')} onChange={(e) => void onPick(e)} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ms-auto"
              loading={attach.isPending}
              loadingText={t('uploading')}
              onClick={() => input.current?.click()}
            >
              {t('add')}
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="px-4 pt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      {list.isPending ? (
        <div className="p-4"><Skeleton className="h-10 w-full" /></div>
      ) : list.isError ? (
        <p className="px-4 py-3 text-body-sm text-muted-foreground">{t('loadFailed')}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-body-sm text-muted-foreground">{mayChange ? t('emptyCanAdd') : t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="min-h-11 max-w-full truncate text-start text-body-sm font-medium text-brand-primary hover:underline sm:min-h-0"
                  onClick={() => void open(row.fileId)}
                >
                  {row.fileName}
                </button>
                <p className="text-caption text-muted-foreground">
                  {formatFileSize(row.sizeBytes)} · {formatDate(row.createdAt)}
                </p>
              </div>
              {row.addedAfterPosting ? <Badge tone="neutral">{t('addedAfterPosting')}</Badge> : null}
              {mayChange && !row.locked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('removeNamed', { name: row.fileName })}
                  loading={remove.isPending && remove.variables === row.id}
                  onClick={() => void onRemove(row.id)}
                >
                  {t('remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {rows.some((row) => row.locked) ? (
        <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground">{t('lockedNote')}</p>
      ) : null}
    </section>
  );
}
