'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DocumentCategory, type ProjectDocumentResponse } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { Download, Trash2, Upload } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { formatDate } from '@/lib/format';

import { useAttachDocument, useProjectDocuments, useRemoveDocument } from '../hooks/use-documents';

const CATEGORIES = Object.values(DocumentCategory);

/** Human-readable file size. Not a financial figure — a plain number for display only. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function DocumentsTab({ projectId }: { projectId: string }) {
  const t = useTranslations('documents');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data, isPending, isError, refetch, isFetching } = useProjectDocuments(projectId);

  const [toRemove, setToRemove] = useState<ProjectDocumentResponse | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const remove = useRemoveDocument(projectId);

  async function onDownload(doc: ProjectDocumentResponse) {
    setDownloadError(null);
    setDownloadingId(doc.id);
    try {
      const { url } = await getFileDownloadUrl(doc.platformFileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDownloadError(t('states.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  }

  function confirmRemove() {
    if (!toRemove) return;
    remove.mutate(toRemove.id, {
      onSuccess: () => {
        setToRemove(null);
      },
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <UploadForm projectId={projectId} />

      {downloadError ? <Alert variant="error" messages={[downloadError]} /> : null}

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-48 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('states.loadFailed')]}>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
              }}
              disabled={isFetching}
            >
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      ) : data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('states.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('states.emptyHint')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.title')}</TableHead>
                <TableHead>{t('col.category')}</TableHead>
                <TableHead numeric>{t('col.size')}</TableHead>
                <TableHead>{t('col.uploadedAt')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('col.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{doc.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {doc.platformFile.originalName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone="neutral">{t(`category.${doc.category}`)}</Badge>
                  </TableCell>
                  <TableCell numeric className="whitespace-nowrap tabular-nums">
                    {formatBytes(doc.platformFile.sizeBytes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(doc.createdAt, locale)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void onDownload(doc);
                        }}
                        disabled={downloadingId === doc.id}
                      >
                        <Download size={16} aria-hidden="true" />
                        <span className="sr-only">{t('actions.download')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setToRemove(doc);
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        <span className="sr-only">{t('actions.remove')}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {toRemove ? (
        <ConfirmActionDialog
          title={t('remove.confirmTitle')}
          description={t('remove.confirmBody', { title: toRemove.title })}
          confirmLabel={t('remove.confirm')}
          isPending={remove.isPending}
          errorMessage={
            remove.isError
              ? remove.error instanceof ApiError
                ? remove.error.message
                : t('states.removeFailed')
              : undefined
          }
          onConfirm={confirmRemove}
          onDismiss={() => {
            if (!remove.isPending) setToRemove(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The add-document form: upload the bytes, then attach as a project document (two mutations). */
function UploadForm({ projectId }: { projectId: string }) {
  const t = useTranslations('documents');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(DocumentCategory.PERMIT);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useFileUpload();
  const attach = useAttachDocument(projectId);
  const submitting = upload.isPending || attach.isPending;

  const titleError = touched && !title.trim() ? t('form.titleRequired') : undefined;
  const fileError = touched && !file ? t('form.fileRequired') : undefined;

  function reset() {
    setFile(null);
    setTitle('');
    setCategory(DocumentCategory.PERMIT);
    setTouched(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!file || !title.trim()) return;

    try {
      const fileId = await upload.mutateAsync(file);
      await attach.mutateAsync({ platformFileId: fileId, category, title: title.trim() });
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('states.uploadFailed'));
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="rounded-panel border border-border bg-surface p-4 sm:p-5"
      aria-label={t('form.title')}
    >
      <h3 className="text-sm font-semibold text-foreground">{t('form.title')}</h3>

      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="doc-file" label={t('form.fileLabel')} error={fileError}>
          <Input
            id="doc-file"
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
            }}
            aria-invalid={Boolean(fileError)}
          />
        </FormField>

        <FormField htmlFor="doc-title" label={t('form.titleLabel')} error={titleError}>
          <Input
            id="doc-title"
            value={title}
            placeholder={t('form.titlePlaceholder')}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            aria-invalid={Boolean(titleError)}
          />
        </FormField>

        <div>
          <Label htmlFor="doc-category">{t('form.categoryLabel')}</Label>
          <Select
            id="doc-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as DocumentCategory);
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={submitting}>
            <Upload size={16} aria-hidden="true" />
            {submitting ? t('states.uploading') : t('form.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}
