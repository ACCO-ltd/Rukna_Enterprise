'use client';

import * as React from 'react';
import { FileSpreadsheet, X } from 'lucide-react';

import { cn } from '../lib/utils';
import { Button } from './button';

/**
 * Choose one file by dropping it or with a button.
 *
 * The drop zone is not itself the control: a real "Choose file" button is (keyboard, screen
 * reader), and dropping is the shortcut. Once a file is chosen the zone is replaced by the file's
 * name and a Remove button, so what will be used is never in doubt.
 *
 * `children` renders under the zone — a template link, typically.
 */
export interface FileDropProps {
  /** The `accept` attribute, e.g. ".xlsx,.xls,.csv". */
  accept: string;
  file: { name: string; size?: number } | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  title: React.ReactNode;
  /** Formats and rules, one or two short lines. */
  hint?: React.ReactNode;
  chooseLabel: string;
  removeLabel: string;
  /** Shown under the zone in the danger tone, e.g. "Choose a spreadsheet to continue." */
  error?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  children?: React.ReactNode;
  className?: string;
}

export function FileDrop({
  accept,
  file,
  onFile,
  onRemove,
  title,
  hint,
  chooseLabel,
  removeLabel,
  error,
  disabled = false,
  id,
  children,
  className,
}: FileDropProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const generatedId = React.useId();
  const inputId = id ?? `${generatedId}-file`;
  const errorId = error ? `${inputId}-error` : undefined;

  const take = (list: FileList | null | undefined) => {
    const next = list?.[0];
    if (next) onFile(next);
  };

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface px-4 py-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <FileSpreadsheet size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-body-sm font-medium text-foreground" title={file.name}>
              {file.name}
            </span>
            {file.size !== undefined ? (
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {formatSize(file.size)}
              </span>
            ) : null}
          </span>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onRemove} disabled={disabled}>
            <X size={14} aria-hidden="true" />
            {removeLabel}
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDragging(false);
            take(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-panel border border-dashed px-4 py-10 text-center transition-colors',
            dragging ? 'border-brand-primary bg-surface-selected' : 'border-border-strong bg-surface-subtle',
            error && 'border-danger',
          )}
        >
          <FileSpreadsheet size={26} strokeWidth={1.6} aria-hidden="true" className="text-muted-foreground" />
          <p className="text-body-sm font-semibold text-foreground">{title}</p>
          {hint ? <p className="max-w-md text-caption text-muted-foreground">{hint}</p> : null}
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={disabled}
            aria-describedby={errorId}
            onClick={() => inputRef.current?.click()}
          >
            {chooseLabel}
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
