'use client';

/**
 * Shared furniture for the four Tier A master-data screens.
 *
 * All four are the same shape — a create action, a create dialog, a table, a deactivate
 * confirmation — so the shape lives here once and each screen supplies its columns and
 * its form. §12.4 describes them together for the same reason.
 *
 * No title: the Procurement module header owns the page's `h1` and its breadcrumb
 * ("Setup / Materials") already names the screen (ADR-035).
 */

import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

interface SetupScreenProps {
  /**
   * One muted line of guidance above the create action, for a screen whose purpose is easy
   * to confuse with another's (spend vs material categories). Omit it otherwise.
   */
  guidance?: string;
  /** Rendered as an informational banner above the table. */
  notice?: string;
  createLabel: string;
  /** Withheld when the user lacks `manage:procurement-config`. */
  canCreate: boolean;
  /**
   * A full create page to link to instead of the dialog — for master data whose create form has
   * outgrown a few short fields (ADR-037's container rule). When set, `createForm` is unused.
   */
  createHref?: string;
  createForm?: (close: () => void) => ReactNode;
  createTitle?: string;
  isPending: boolean;
  isError: boolean;
  children: ReactNode;
}

export function SetupScreen({
  guidance,
  notice,
  createLabel,
  canCreate,
  createHref,
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
      {guidance || canCreate ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {guidance ? (
            <p className="me-auto max-w-prose text-body-sm text-muted-foreground">{guidance}</p>
          ) : null}
          {canCreate && createHref ? (
            <Button asChild>
              <Link href={createHref}>{createLabel}</Link>
            </Button>
          ) : canCreate ? (
            <Button type="button" onClick={() => setOpen(true)}>
              {createLabel}
            </Button>
          ) : null}
        </div>
      ) : null}

      {notice ? <Alert variant="info" messages={[notice]} /> : null}

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        children
      )}

      {/* A dialog, not the side panel this was: these setup forms are three or four short
          fields, and none of them needs the table behind it to stay readable while you type.
          `CreateForm` draws the FormDialog itself (it owns the pending state the guard needs);
          the title reaches it through context. */}
      {createForm && open ? (
        <CreateDialogTitle.Provider value={createTitle ?? createLabel}>
          {createForm(() => setOpen(false))}
        </CreateDialogTitle.Provider>
      ) : null}
    </div>
  );
}

// ─── Create form scaffold ────────────────────────────────────────────────────────

/** The create dialog's title, from `SetupScreen` to the `CreateForm` its render prop returns. */
const CreateDialogTitle = createContext<string | null>(null);

interface CreateFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  error: unknown;
  onCancel: () => void;
  submitLabel?: string;
  /** Dialog title; defaults to the `SetupScreen`'s `createTitle`. */
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Wraps a create form with its submit row and error surface.
 *
 * A `409` gets its own treatment: every one of these endpoints rejects a duplicate code
 * that way, and "Conflict" tells the user nothing. The server's message names the code,
 * so it is shown as-is rather than replaced with something generic.
 *
 * Always shown in a `FormDialog` (ADR-039), size `md`: the fields scroll between a pinned title
 * and a pinned Cancel · Create. The dialog cannot be dismissed while the create is in flight,
 * and asks before discarding unsaved edits. The inputs are uncontrolled, so "unsaved" is worked
 * out from the form itself: its values now against its values when it opened. A field changed
 * and then changed back is not an edit.
 */
export function CreateForm({
  onSubmit,
  isPending,
  error,
  onCancel,
  submitLabel,
  title,
  subtitle,
  children,
}: CreateFormProps) {
  const t = useTranslations('procurement.common');
  const contextTitle = useContext(CreateDialogTitle);
  const [dirty, setDirty] = useState(false);
  // The form's values when it opened, read once from the DOM on mount.
  const initialValues = useRef<string | null>(null);

  const message =
    error instanceof ApiError ? error.message : error ? t('loadFailed') : undefined;

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onCancel()}
      title={title ?? contextTitle ?? ''}
      subtitle={subtitle}
      size="md"
      dirty={dirty}
      busy={isPending}
      onSubmit={onSubmit}
    >
      <FormDialogBody>
        <div
          className="space-y-4"
          ref={(element) => {
            if (element && initialValues.current === null) {
              initialValues.current = formValues(element);
            }
          }}
          onInput={(event) => setDirty(formValues(event.currentTarget) !== initialValues.current)}
          onChange={(event) => setDirty(formValues(event.currentTarget) !== initialValues.current)}
        >
          {children}
        </div>

        {message ? <Alert variant="error" messages={[message]} /> : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={isPending}>
          {submitLabel ?? t('create')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

/** The enclosing form's named values, serialised so two readings compare with `===`. */
function formValues(element: HTMLElement): string {
  const form = element.closest('form');
  if (!form) return '';
  const entries: string[] = [];
  new FormData(form).forEach((value, key) => {
    entries.push(`${key}=${typeof value === 'string' ? value : value.name}`);
  });
  return entries.join('&');
}
