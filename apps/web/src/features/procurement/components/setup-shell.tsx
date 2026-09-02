'use client';

/**
 * Shared furniture for the four Tier A master-data screens.
 *
 * All four are the same shape — a heading, a create drawer, a table, a deactivate
 * confirmation — so the shape lives here once and each screen supplies its columns and
 * its form. §12.4 describes them together for the same reason.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

interface SetupScreenProps {
  title: string;
  subtitle: string;
  /** Rendered as an informational banner above the table. */
  notice?: string;
  createLabel: string;
  /** Withheld when the user lacks `manage:procurement-config`. */
  canCreate: boolean;
  createForm: (close: () => void) => ReactNode;
  createTitle: string;
  isPending: boolean;
  isError: boolean;
  children: ReactNode;
}

export function SetupScreen({
  title,
  subtitle,
  notice,
  createLabel,
  canCreate,
  createForm,
  createTitle,
  isPending,
  isError,
  children,
}: SetupScreenProps) {
  const t = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {canCreate ? (
          <Button type="button" onClick={() => setOpen(true)}>
            {createLabel}
          </Button>
        ) : null}
      </div>

      {notice ? <Alert variant="info" messages={[notice]} /> : null}

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        children
      )}

      {/* A dialog, not the side panel this was: these setup forms are three or four short
          fields, and none of them needs the table behind it to stay readable while you type. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>
            {createTitle}
          </DialogTitle>
          <div className="mt-5">{createForm(() => setOpen(false))}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Create form scaffold ────────────────────────────────────────────────────────

interface CreateFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  error: unknown;
  onCancel: () => void;
  submitLabel?: string;
  children: ReactNode;
}

/**
 * Wraps a create form with its submit row and error surface.
 *
 * A `409` gets its own treatment: every one of these endpoints rejects a duplicate code
 * that way, and "Conflict" tells the user nothing. The server's message names the code,
 * so it is shown as-is rather than replaced with something generic.
 */
export function CreateForm({
  onSubmit,
  isPending,
  error,
  onCancel,
  submitLabel,
  children,
}: CreateFormProps) {
  const t = useTranslations('procurement.common');

  const message =
    error instanceof ApiError ? error.message : error ? t('loadFailed') : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {children}

      {message ? <Alert variant="error" messages={[message]} /> : null}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {submitLabel ?? t('create')}
        </Button>
      </div>
    </form>
  );
}
