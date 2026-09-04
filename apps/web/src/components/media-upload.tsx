'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@erp/ui';

/**
 * Multi-file photo/video uploader with a drag-drop zone and per-file preview tiles.
 *
 * Built for daily-report evidence (ADR-021 redesign §5.3): a site engineer drops several photos or
 * short clips of the day's work. Each file is validated (type + size) BEFORE any upload starts, so
 * an over-limit video fails immediately with a clear reason rather than after a long transfer. A
 * failed file keeps its tile with a Retry; a succeeded file drops out of the queue (it reappears in
 * the server-backed gallery the caller renders below). The component owns the queue and previews;
 * the caller owns the actual upload (`onUpload`) and how attachments are listed once stored.
 *
 * Reusable — no progress-domain strings are baked in; the caller passes translated `labels`.
 */

const MB = 1024 * 1024;

export interface MediaUploadLabels {
  /** "Drag photos or videos here, or" — precedes the browse link. */
  dropHint: string;
  /** "browse" — the inline file-picker link. */
  browse: string;
  /** Shown when an image exceeds `maxImageBytes` (embed the limit, e.g. "Photos must be under 15 MB"). */
  tooLargeImage: string;
  /** Shown when a video exceeds `maxVideoBytes`. */
  tooLargeVideo: string;
  /** Shown when a non-image/non-video file is dropped. */
  wrongType: string;
  uploading: string;
  failed: string;
  retry: string;
  remove: string;
}

interface QueueItem {
  key: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video';
  status: 'uploading' | 'error';
}

export interface MediaUploadProps {
  /** Uploads one file end-to-end (presign → PUT → confirm → attach). Rejects to mark the tile failed. */
  onUpload: (file: File) => Promise<void>;
  labels: MediaUploadLabels;
  /** Default 15 MB. */
  maxImageBytes?: number;
  /** Default 150 MB. */
  maxVideoBytes?: number;
  disabled?: boolean;
  className?: string;
}

let seq = 0;

export function MediaUpload({
  onUpload,
  labels,
  maxImageBytes = 15 * MB,
  maxVideoBytes = 150 * MB,
  disabled,
  className,
}: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Revoke any still-queued object URLs on unmount so previews don't leak.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)),
    [],
  );

  const startUpload = useCallback(
    (item: QueueItem) => {
      onUpload(item.file)
        .then(() => {
          // Success: the caller refetches and the file appears in the stored gallery; drop the tile.
          URL.revokeObjectURL(item.previewUrl);
          setItems((prev) => prev.filter((it) => it.key !== item.key));
        })
        .catch(() => {
          setItems((prev) =>
            prev.map((it) => (it.key === item.key ? { ...it, status: 'error' } : it)),
          );
        });
    },
    [onUpload],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const accepted: QueueItem[] = [];
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) {
          setError(labels.wrongType);
          continue;
        }
        if (isImage && file.size > maxImageBytes) {
          setError(labels.tooLargeImage);
          continue;
        }
        if (isVideo && file.size > maxVideoBytes) {
          setError(labels.tooLargeVideo);
          continue;
        }
        accepted.push({
          key: `m-${seq++}`,
          file,
          previewUrl: URL.createObjectURL(file),
          kind: isImage ? 'image' : 'video',
          status: 'uploading',
        });
      }
      if (accepted.length === 0) return;
      setItems((prev) => [...prev, ...accepted]);
      accepted.forEach(startUpload);
    },
    [labels, maxImageBytes, maxVideoBytes, startUpload],
  );

  const retry = (item: QueueItem) => {
    setItems((prev) =>
      prev.map((it) => (it.key === item.key ? { ...it, status: 'uploading' } : it)),
    );
    startUpload({ ...item, status: 'uploading' });
  };

  const remove = (item: QueueItem) => {
    URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((it) => it.key !== item.key));
  };

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-panel border border-dashed px-4 py-6 text-center transition-colors duration-(--motion-enter) ease-brand',
          dragging ? 'border-brand-primary bg-brand-accent/40' : 'border-border bg-surface',
          disabled && 'opacity-50',
        )}
      >
        <Upload size={20} className="mx-auto text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          {labels.dropHint}{' '}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand-primary underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
          >
            {labels.browse}
          </button>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error ? <p className="mt-2 text-caption font-medium text-danger">{error}</p> : null}

      {items.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((it) => (
            <li
              key={it.key}
              className="relative aspect-square overflow-hidden rounded-control border border-border bg-muted"
            >
              {it.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- object-URL preview, not a remote asset
                <img src={it.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <video src={it.previewUrl} className="h-full w-full object-cover" muted playsInline />
              )}

              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                {it.status === 'uploading' ? (
                  <span className="flex items-center gap-1.5 text-caption font-medium text-white">
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden="true"
                    />
                    {labels.uploading}
                  </span>
                ) : (
                  <div className="flex flex-col items-center gap-1 px-1 text-center">
                    <span className="text-caption font-medium text-white">{labels.failed}</span>
                    <button
                      type="button"
                      onClick={() => retry(it)}
                      className="rounded-control bg-white/90 px-2 py-0.5 text-micro font-semibold text-foreground hover:bg-white"
                    >
                      {labels.retry}
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => remove(it)}
                aria-label={labels.remove}
                className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-sm leading-none text-white hover:bg-black/80"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
