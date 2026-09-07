'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AttachmentSourceType, type LinkedAttachmentResponse } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  Input,
  Label,
  Select,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { Paperclip } from 'lucide-react';

import { formatDate } from '@/lib/format';
import { getFileDownloadUrl } from '@/features/files/api/files-api';

import { useLinkedAttachments } from '../hooks/use-documents';
import { formatBytes } from './document-primitives';

const PAGE_SIZE = 25;

/**
 * Linked Attachments — evidence this project holds that some other record owns.
 *
 * **Read-only, and visibly so.** There is no Attach button and no Delete action, because every
 * file here belongs to a daily progress report, a contract, a guarantee, an application or a
 * certificate, and each of those has its own rules about when its evidence may change. Offering a
 * delete here would route around all of them. The Source column is the affordance: it takes the
 * reader to the record that can actually change the thing they are looking at.
 *
 * The State column exists for the same reason. "Locked" is not decoration — it is why the parent
 * record will refuse to remove the file, stated before the reader goes looking for the button.
 */
export function LinkedAttachmentsView({ projectId }: { projectId: string }) {
  const t = useTranslations('documents');
  const [sourceType, setSourceType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const query = useLinkedAttachments(projectId, {
    sourceType: sourceType || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(sourceType || search);

  async function openFile(fileId: string) {
    setDownloadError(null);
    try {
      const { url } = await getFileDownloadUrl(fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDownloadError(t('states.downloadFailed'));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('attachments.title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">
          {t('attachments.hint')}
        </p>
      </div>

      {downloadError ? <Alert variant="error" messages={[downloadError]} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="att-search" className="text-micro font-semibold uppercase tracking-[0.06em]">
            {t('filters.search')}
          </Label>
          <Input
            id="att-search"
            type="search"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="att-source" className="text-micro font-semibold uppercase tracking-[0.06em]">
            {t('attachments.sourceFilter')}
          </Label>
          <Select
            id="att-source"
            value={sourceType}
            onChange={(value) => {
              setPage(1);
              setSourceType(value);
            }}
          >
            <option value="">{t('filters.all')}</option>
            {Object.values(AttachmentSourceType).map((value) => (
              <option key={value} value={value}>
                {t(`sourceType.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isPending ? (
        <SkeletonTable columns={7} rows={5} label={t('states.loading')} />
      ) : query.isError ? (
        <Alert variant="error" title={t('attachments.loadFailed')}>
          <div className="mt-3">
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      ) : items.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <Paperclip
            size={24}
            strokeWidth={1.6}
            aria-hidden="true"
            className="mx-auto text-muted-foreground"
          />
          <p className="mt-3 text-body font-medium text-foreground">
            {filtered ? t('attachments.noMatchTitle') : t('attachments.emptyTitle')}
          </p>
          <p className="mx-auto mt-1 max-w-prose text-body-sm text-muted-foreground">
            {filtered ? t('states.noMatchHint') : t('attachments.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.file')}</TableHead>
                  <TableHead>{t('col.source')}</TableHead>
                  <TableHead>{t('col.reference')}</TableHead>
                  <TableHead>{t('col.context')}</TableHead>
                  <TableHead>{t('col.uploadedBy')}</TableHead>
                  <TableHead>{t('col.uploaded')}</TableHead>
                  <TableHead>{t('col.state')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((attachment) => (
                  <AttachmentRow
                    key={attachment.attachmentId}
                    attachment={attachment}
                    onOpen={() => void openFile(attachment.fileId)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScroll>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-muted-foreground">
              {t('filters.showing', { shown: items.length, total })}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                 
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  {t('actions.previous')}
                </Button>
                <span className="text-body-sm tabular-nums text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                 
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  {t('actions.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  onOpen,
}: {
  attachment: LinkedAttachmentResponse;
  onOpen: () => void;
}) {
  const t = useTranslations('documents');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <TableRow>
      <TableCell className="max-w-[18rem]">
        <button
          type="button"
          onClick={onOpen}
          className="block min-h-11 w-full truncate text-start text-body-sm font-medium text-brand-primary underline underline-offset-2"
        >
          {attachment.fileName}
        </button>
        <span className="text-micro text-muted-foreground">
          {formatBytes(attachment.sizeBytes)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {t(`sourceType.${attachment.sourceType}`)}
      </TableCell>
      <TableCell className="max-w-[12rem]">
        {/* The route was verified to exist. A reference that looks like a link and 404s is worse
            than plain text, so a source with no screen renders as text. */}
        {attachment.sourceHref ? (
          <Link
            href={attachment.sourceHref}
            className="truncate text-body-sm text-brand-primary underline underline-offset-2"
          >
            {attachment.sourceReference}
          </Link>
        ) : (
          <span className="truncate">{attachment.sourceReference}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {attachment.context}
      </TableCell>
      <TableCell className="max-w-[10rem]">
        <span className="truncate">{attachment.uploadedByName ?? attachment.uploadedBy}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {formatDate(attachment.uploadedAt, locale) ?? '—'}
      </TableCell>
      <TableCell>
        {/* Locked is the only state worth a colour: it is the one that explains why the parent
            record will refuse to remove the file. */}
        <Badge tone={attachment.lifecycle === 'IMMUTABLE' ? 'historical' : 'neutral'}>
          {t(`lifecycle.${attachment.lifecycle}`)}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
